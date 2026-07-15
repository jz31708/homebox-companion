"""Vision tool API routes."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from loguru import logger

from homebox_companion import (
    analyze_item_details_from_images,
    detect_items_from_bytes,
    encode_compressed_image_to_base64,
    encode_image_bytes_to_data_uri,
    settings,
)
from homebox_companion import (
    correct_item as llm_correct_item,
)
from homebox_companion.tools.vision.bulk_contracts import Candidate
from homebox_companion.tools.vision.bulk_detector import detect_bulk_sweep
from homebox_companion.tools.vision.bulk_fusion import fuse_observations
from homebox_companion.tools.vision.bulk_models import (
    BulkDetectResponse,
    BulkObservation,
    BulkObservationResponse,
    BulkPhotoMeta,
    BulkStats,
    BulkTranscriptSpan,
)
from homebox_companion.tools.vision.bulk_observation import validate_observation_evidence
from homebox_companion.tools.vision.medicine_detector import detect_medicine, lookup_medicine_barcode
from homebox_companion.tools.vision.medicine_models import (
    MedicineDetectResponse,
    MedicineLookupRequest,
    MedicinePhotoMeta,
    MedicineUserContext,
)
from homebox_companion.tools.vision.models import get_custom_fields_dict

from ...dependencies import (
    VisionContext,
    get_client,
    get_vision_context,
    require_auth,
    require_llm_configured,
    validate_file_size,
    validate_files_size,
)
from ...schemas.vision import (
    AdvancedItemDetails,
    CompressedImage,
    CorrectedItemResponse,
    CorrectionResponse,
    DetectedItemResponse,
    DetectionResponse,
    DuplicateMatchResponse,
)
from ...services.duplicate_checker import DuplicateChecker

router = APIRouter()


@router.post("/bulk-fuse", response_model=list[Candidate])
async def bulk_fuse(payload: dict[str, object]) -> list[Candidate]:
    """Fuse persisted observations using conservative, evidence-first rules."""
    mission_id = str(payload.get("missionId") or "mission")
    observations = payload.get("observations")
    if not isinstance(observations, list) or not observations:
        raise HTTPException(status_code=400, detail="At least one observation is required")
    transcript = str(payload.get("transcript") or "")
    existing = payload.get("existingItems")
    existing_items = existing if isinstance(existing, list) else []
    allowed = payload.get("allowedTagIds")
    allowed_tag_ids = {str(tag) for tag in allowed} if isinstance(allowed, list) else None
    return fuse_observations(mission_id, observations, transcript, existing_items, allowed_tag_ids)


# Limit concurrent CPU-intensive compression to available cores.
# This prevents 100+ parallel requests from overwhelming the CPU.
# We track both the semaphore and the event loop it was created for,
# so we can recreate it if the loop changes (e.g., during tests or reloads).
_COMPRESSION_SEMAPHORE: asyncio.Semaphore | None = None
_COMPRESSION_SEMAPHORE_LOOP: asyncio.AbstractEventLoop | None = None


def _get_compression_semaphore() -> asyncio.Semaphore:
    """Get or create the compression semaphore for the current event loop.

    The semaphore is bound to the event loop it was created on.
    If the loop changes (tests, reloads), we create a new semaphore.

    Note: This function is safe from race conditions in async code because:
    - There's no `await` between the check and the assignment
    - Asyncio is cooperative, so this runs atomically within a single event loop
    """
    global _COMPRESSION_SEMAPHORE, _COMPRESSION_SEMAPHORE_LOOP

    try:
        current_loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running loop - this shouldn't happen in normal request handling
        # but can occur in tests. Create semaphore anyway; it will be
        # recreated when a proper loop is running.
        current_loop = None

    # Recreate semaphore if loop changed or doesn't exist
    if (
        _COMPRESSION_SEMAPHORE is None
        or _COMPRESSION_SEMAPHORE_LOOP is None
        or (current_loop is not None and _COMPRESSION_SEMAPHORE_LOOP is not current_loop)
    ):
        _COMPRESSION_SEMAPHORE = asyncio.Semaphore(os.cpu_count() or 4)
        _COMPRESSION_SEMAPHORE_LOOP = current_loop

    return _COMPRESSION_SEMAPHORE


def filter_default_tag(tag_ids: list[str] | None, default_tag_id: str | None) -> list[str]:
    """Filter out the default tag from AI-suggested tags.

    The frontend auto-adds the default tag, so we remove it from AI suggestions
    to avoid the AI duplicating what the frontend will add anyway.

    Args:
        tag_ids: List of tag IDs suggested by the AI.
        default_tag_id: The default tag ID to filter out.

    Returns:
        Filtered list of tag IDs.
    """
    if not tag_ids:
        return []
    if not default_tag_id:
        return tag_ids
    return [tid for tid in tag_ids if tid != default_tag_id]


@router.post("/detect", response_model=DetectionResponse)
async def detect_items(
    image: Annotated[UploadFile, File(description="Primary image file to analyze")],
    ctx: Annotated[VisionContext, Depends(get_vision_context)],
    api_key: Annotated[str, Depends(require_llm_configured)],
    single_item: Annotated[bool, Form()] = False,
    extra_instructions: Annotated[str | None, Form()] = None,
    extract_extended_fields: Annotated[bool, Form()] = True,
    additional_images: Annotated[
        list[UploadFile] | None, File(description="Additional images for the same item")
    ] = None,
) -> DetectionResponse:
    """Analyze an uploaded image and detect items using LLM vision.

    Args:
        image: The primary image file to analyze.
        ctx: Vision context with auth token, tags, and preferences.
        api_key: LLM API key (validated by dependency).
        single_item: If True, treat everything as a single item.
        extra_instructions: Optional user hint about what's in the image.
        extract_extended_fields: If True, also extract extended fields.
        additional_images: Optional additional images for the same item(s).
    """
    additional_count = len(additional_images) if additional_images else 0
    logger.info(f"Detecting items from image: {image.filename} (+ {additional_count} additional)")
    logger.info(f"Single item mode: {single_item}, Extra instructions: {extra_instructions}")
    logger.info(f"Extract extended fields: {extract_extended_fields}")

    # Read and validate primary image
    image_bytes = await validate_file_size(image)
    logger.debug(f"Primary image size: {len(image_bytes)} bytes")
    content_type = image.content_type or "image/jpeg"

    # Read additional images if provided (with size validation)
    additional_image_data: list[tuple[bytes, str]] = []
    if additional_images:
        for add_img in additional_images:
            add_bytes = await validate_file_size(add_img)
            add_mime = add_img.content_type or "image/jpeg"
            additional_image_data.append((add_bytes, add_mime))
            logger.debug(f"Additional image: {add_img.filename}, size: {len(add_bytes)} bytes")

    logger.debug(f"Loaded {len(ctx.tags)} tags for context")

    # Get image quality settings
    max_dimension, jpeg_quality = settings.image_quality_params

    # Run AI detection and image compression in parallel
    async def compress_all_images() -> list[CompressedImage]:
        """Compress all images (primary + additional) for Homebox upload in parallel."""
        all_images_to_compress = [(image_bytes, content_type)] + additional_image_data

        async def compress_one(img_bytes: bytes, _mime: str) -> CompressedImage:
            """Compress a single image with concurrency limiting."""
            # Limit concurrent compressions to prevent CPU overload
            async with _get_compression_semaphore():
                base64_data, mime = await asyncio.to_thread(
                    encode_compressed_image_to_base64, img_bytes, max_dimension, jpeg_quality
                )
                return CompressedImage(data=base64_data, mime_type=mime)

        # Compress all images in parallel
        return await asyncio.gather(*[compress_one(img_bytes, mime) for img_bytes, mime in all_images_to_compress])

    # Detect items
    logger.info("Starting LLM vision detection and image compression...")

    # Run detection and compression in parallel
    detection_task = detect_items_from_bytes(
        image_bytes=image_bytes,
        mime_type=content_type,
        tags=ctx.tags,
        single_item=single_item,
        extra_instructions=extra_instructions,
        extract_extended_fields=extract_extended_fields,
        additional_images=additional_image_data,
        field_preferences=ctx.field_preferences,
        output_language=ctx.output_language,
        custom_fields=ctx.custom_fields,
    )
    compression_task = compress_all_images()

    detected, compressed_images = await asyncio.gather(detection_task, compression_task)

    logger.info(f"Detected {len(detected)} items, compressed {len(compressed_images)} images")

    # Build response items first
    response_items = [
        DetectedItemResponse(
            name=item.name,
            quantity=item.quantity,
            description=item.description,
            tag_ids=filter_default_tag(item.tag_ids, ctx.default_tag_id),
            manufacturer=item.manufacturer,
            model_number=item.model_number,
            serial_number=item.serial_number,
            purchase_price=item.purchase_price,
            purchase_from=item.purchase_from,
            notes=item.notes,
            custom_fields=get_custom_fields_dict(item, ctx.custom_fields),
        )
        for item in detected
    ]

    # ==========================================================================
    # DUPLICATE DETECTION: Check items with serial numbers for existing matches
    # ==========================================================================
    items_with_serials = [item for item in response_items if item.serial_number]
    if items_with_serials:
        logger.info(f"Checking {len(items_with_serials)} item(s) with serial numbers for duplicates")
        client = get_client()
        checker = DuplicateChecker(client)

        async def check_one(item: DetectedItemResponse) -> None:
            """Check a single item for duplicates and attach match if found."""
            try:
                assert item.serial_number is not None
                match = await checker.check_serial_number(ctx.token, item.serial_number)
                if match:
                    item.duplicate_match = DuplicateMatchResponse(
                        item_id=match.item_id,
                        item_name=match.item_name,
                        serial_number=match.serial_number,
                        location_name=match.location_name,
                    )
                    logger.info(
                        f"Duplicate found for '{item.name}': matches '{match.item_name}' "
                        f"(serial: {match.serial_number})"
                    )
            except Exception as e:
                logger.warning(f"Duplicate check failed for serial '{item.serial_number}': {e}")

        await asyncio.gather(*[check_one(item) for item in items_with_serials])

    return DetectionResponse(
        items=response_items,
        compressed_images=compressed_images,
    )


@router.post("/analyze", response_model=AdvancedItemDetails)
async def analyze_item_advanced(
    images: Annotated[list[UploadFile], File(description="Images to analyze")],
    item_name: Annotated[str, Form()],
    ctx: Annotated[VisionContext, Depends(get_vision_context)],
    api_key: Annotated[str, Depends(require_llm_configured)],
    item_description: Annotated[str | None, Form()] = None,
) -> AdvancedItemDetails:
    """Analyze multiple images to extract detailed item information."""
    logger.info(f"Advanced analysis for item: {item_name}")
    logger.debug(f"Description: {item_description}")
    logger.debug(f"Number of images: {len(images) if images else 0}")

    if not images:
        logger.warning("No images provided for analysis")
        raise HTTPException(status_code=400, detail="At least one image is required")

    # Validate and convert images to data URIs
    validated_images = await validate_files_size(images)
    image_data_uris = [
        encode_image_bytes_to_data_uri(img_bytes, mime_type) for img_bytes, mime_type in validated_images
    ]

    # Analyze images
    logger.info(f"Analyzing {len(image_data_uris)} images with LLM...")
    details = await analyze_item_details_from_images(
        image_data_uris=image_data_uris,
        item_name=item_name,
        item_description=item_description,
        tags=ctx.tags,
        field_preferences=ctx.field_preferences,
        output_language=ctx.output_language,
        custom_fields=ctx.custom_fields,
    )
    logger.info("Analysis complete")

    # Filter out default tag from AI suggestions (frontend will auto-add it)
    return AdvancedItemDetails(
        name=details.name,
        description=details.description,
        serial_number=details.serial_number,
        model_number=details.model_number,
        manufacturer=details.manufacturer,
        purchase_price=details.purchase_price,
        notes=details.notes,
        tag_ids=filter_default_tag(details.tag_ids, ctx.default_tag_id),
        custom_fields=get_custom_fields_dict(details, ctx.custom_fields),
    )


# Maximum length for correction instructions to prevent abuse
MAX_CORRECTION_INSTRUCTIONS_LENGTH = 2000


@router.post("/bulk-detect", response_model=BulkDetectResponse)
async def bulk_detect(
    images: Annotated[list[UploadFile], File(description="Bulk Sweep photos")],
    session_meta: Annotated[str, Form(description="JSON session metadata")],
    transcript_spans: Annotated[str, Form(description="JSON transcript spans")] = "[]",
    edited_transcript: Annotated[str, Form(description="User-edited canonical transcript")] = "",
    options: Annotated[str, Form(description="JSON analysis options")] = "{}",
    ctx: Annotated[VisionContext, Depends(get_vision_context)] = None,  # type: ignore[assignment]
    api_key: Annotated[str, Depends(require_llm_configured)] = "",  # noqa: ARG001
) -> BulkDetectResponse:
    """Analyze a Bulk Sweep into evidence-backed candidate items."""
    if not images:
        raise HTTPException(status_code=400, detail="At least one image is required")

    try:
        meta = json.loads(session_meta)
        options_data = json.loads(options or "{}")
        span_data = json.loads(transcript_spans or "[]")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail="Invalid Bulk Sweep JSON metadata") from e

    photo_meta_all = [BulkPhotoMeta.model_validate(photo) for photo in meta.get("photos", [])]
    requested_photo_ids = {str(photo_id) for photo_id in meta.get("photoIds", [])}
    active_meta = [
        photo
        for photo in photo_meta_all
        if not photo.ignored and (not requested_photo_ids or photo.id in requested_photo_ids)
    ]
    spans = [BulkTranscriptSpan.model_validate(span) for span in span_data]

    if len(images) != len(active_meta):
        # The frontend sends only non-ignored photos. Keep the request strict so evidence IDs stay aligned.
        raise HTTPException(status_code=400, detail="Image count does not match non-ignored photo metadata")

    validated_images = await validate_files_size(images)
    image_data = [
        (photo, image_bytes, mime_type)
        for photo, (image_bytes, mime_type) in zip(active_meta, validated_images, strict=True)
    ]

    chunk_size = int(options_data.get("chunkSize") or settings.bulk_vision_chunk_size)
    logger.info(
        "Bulk Sweep detection: photos={}, ignored={}, transcript_chars={}",
        len(active_meta),
        len(photo_meta_all) - len(active_meta),
        len(edited_transcript or ""),
    )

    candidates = await detect_bulk_sweep(
        image_data,
        transcript_spans=spans,
        edited_transcript=(edited_transcript or "")[: settings.bulk_max_transcript_chars],
        tags=ctx.tags,
        field_preferences=ctx.field_preferences,
        output_language=ctx.output_language,
        custom_fields=ctx.custom_fields,
        chunk_size=chunk_size,
    )
    low_confidence = sum(1 for candidate in candidates if candidate.confidence < settings.bulk_low_confidence_threshold)
    return BulkDetectResponse(
        candidates=candidates,
        warnings=[],
        stats=BulkStats(
            photo_count=len(active_meta),
            ignored_photo_count=len(photo_meta_all) - len(active_meta),
            candidate_count=len(candidates),
            low_confidence_count=low_confidence,
        ),
    )


@router.post("/bulk-observe", response_model=BulkObservationResponse)
async def bulk_observe(
    images: Annotated[list[UploadFile], File(description="One resumable Bulk Sweep photo chunk")],
    session_meta: Annotated[str, Form(description="Chunk metadata with explicit photo IDs")],
    transcript_spans: Annotated[str, Form(description="JSON transcript spans")] = "[]",
    edited_transcript: Annotated[str, Form(description="User-edited transcript")] = "",
    ctx: Annotated[VisionContext, Depends(get_vision_context)] = None,  # type: ignore[assignment]
    api_key: Annotated[str, Depends(require_llm_configured)] = "",  # noqa: ARG001
) -> BulkObservationResponse:
    """Observe one explicit photo chunk; callers persist and retry it independently."""
    try:
        meta = json.loads(session_meta)
        span_data = json.loads(transcript_spans or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid observation metadata") from exc
    requested_ids = [str(photo_id) for photo_id in meta.get("photoIds", [])]
    if not requested_ids or len(images) != len(requested_ids):
        raise HTTPException(status_code=400, detail="Observation images must match explicit photo IDs")
    photos = [
        BulkPhotoMeta(id=photo_id, index=index, sessionOffsetMs=None) for index, photo_id in enumerate(requested_ids)
    ]
    validated_images = await validate_files_size(images)
    image_data = [(photo, raw, mime) for photo, (raw, mime) in zip(photos, validated_images, strict=True)]
    candidates = await detect_bulk_sweep(
        image_data,
        transcript_spans=[BulkTranscriptSpan.model_validate(span) for span in span_data],
        edited_transcript=(edited_transcript or "")[: settings.bulk_max_transcript_chars],
        tags=ctx.tags,
        field_preferences=ctx.field_preferences,
        output_language=ctx.output_language,
        custom_fields=ctx.custom_fields,
        chunk_size=max(6, min(8, len(images))),
    )
    observations_data = [
        {
            "id": candidate.id,
            "name": candidate.name,
            "photoIds": candidate.sourcePhotoIds,
            "transcriptSpanIds": [ref.transcriptSpanId for ref in candidate.evidence if ref.transcriptSpanId],
            "evidence": [ref.model_dump() for ref in candidate.evidence],
        }
        for candidate in candidates
    ]
    warnings = validate_observation_evidence(
        observations_data, set(requested_ids), {str(span.get("id")) for span in span_data}
    )
    return BulkObservationResponse(
        chunkId=str(meta.get("chunkId") or "unknown"),
        photoIds=requested_ids,
        observations=[BulkObservation.model_validate(observation) for observation in observations_data],
        warnings=warnings,
    )


@router.post("/medicine-detect", response_model=MedicineDetectResponse)
async def medicine_detect(
    images: Annotated[list[UploadFile], File(description="Medicine photos")],
    session_meta: Annotated[str, Form(description="JSON session metadata")],
    user_context: Annotated[str, Form(description="JSON medicine hints")] = "{}",
    ctx: Annotated[VisionContext, Depends(get_vision_context)] = None,  # type: ignore[assignment]
    api_key: Annotated[str, Depends(require_llm_configured)] = "",  # noqa: ARG001
) -> MedicineDetectResponse:
    """Analyze several photos of one medicine into a reviewable Homebox item."""
    if not images:
        raise HTTPException(status_code=400, detail="At least one image is required")

    try:
        meta = json.loads(session_meta)
        context_data = json.loads(user_context or "{}")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail="Invalid medicine intake JSON metadata") from e

    photo_meta_all = [MedicinePhotoMeta.model_validate(photo) for photo in meta.get("photos", [])]
    active_meta = [photo for photo in photo_meta_all if not photo.ignored]
    if len(images) != len(active_meta):
        raise HTTPException(status_code=400, detail="Image count does not match non-ignored photo metadata")

    context = MedicineUserContext.model_validate(context_data)
    validated_images = await validate_files_size(images)
    image_data = [
        (photo, image_bytes, mime_type)
        for photo, (image_bytes, mime_type) in zip(active_meta, validated_images, strict=True)
    ]
    logger.info(
        "Medicine detection: photos={}, ignored={}, code_present={}",
        len(active_meta),
        len(photo_meta_all) - len(active_meta),
        bool(context.barcodeText),
    )

    candidate = await detect_medicine(
        image_data,
        context=context,
        output_language=ctx.output_language,
    )
    return MedicineDetectResponse(candidate=candidate, warnings=[])


@router.post("/medicine-lookup", response_model=MedicineDetectResponse)
async def medicine_lookup(
    request: MedicineLookupRequest,
    _auth: Annotated[None, Depends(require_auth)] = None,  # noqa: ARG001
) -> MedicineDetectResponse:
    """Resolve a scanned medicine barcode into a reviewable candidate without requiring photos."""
    context = MedicineUserContext(
        note=request.note,
        barcodeText=request.barcodeText,
        expiryDate=request.expiryDate,
        openedDate=request.openedDate,
        remainingDoses=request.remainingDoses,
        remainingDoseLabel=request.remainingDoseLabel,
    )
    candidate = await lookup_medicine_barcode(
        context=context,
        output_language=None,
    )
    return MedicineDetectResponse(candidate=candidate, warnings=[])


@router.post("/correct", response_model=CorrectionResponse)
async def correct_item(
    image: Annotated[UploadFile, File(description="Original image of the item")],
    current_item: Annotated[str, Form(description="JSON string of current item")],
    correction_instructions: Annotated[str, Form(description="User's correction feedback")],
    ctx: Annotated[VisionContext, Depends(get_vision_context)],
    api_key: Annotated[str, Depends(require_llm_configured)],
) -> CorrectionResponse:
    """Correct an item based on user feedback.

    This endpoint allows users to provide feedback about a detected item,
    and the AI will re-analyze with the feedback.
    """
    logger.info("Item correction request received")

    # Validate correction instructions
    if not correction_instructions or not correction_instructions.strip():
        raise HTTPException(status_code=400, detail="Correction instructions are required")

    if len(correction_instructions) > MAX_CORRECTION_INSTRUCTIONS_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Correction instructions too long. Maximum {MAX_CORRECTION_INSTRUCTIONS_LENGTH} characters allowed."
            ),
        )

    # Sanitize - strip and truncate for safety
    correction_instructions = correction_instructions.strip()[:MAX_CORRECTION_INSTRUCTIONS_LENGTH]
    preview = correction_instructions[:100]
    logger.debug(f"Correction instructions ({len(correction_instructions)} chars): {preview}...")

    # Parse current item from JSON string
    try:
        current_item_dict = json.loads(current_item)
    except json.JSONDecodeError as e:
        logger.exception("Invalid JSON for current_item")
        raise HTTPException(status_code=400, detail="Invalid current_item JSON") from e

    logger.debug(f"Current item: {current_item_dict}")

    # Read and validate image size
    image_bytes = await validate_file_size(image)
    content_type = image.content_type or "image/jpeg"
    image_data_uri = encode_image_bytes_to_data_uri(image_bytes, content_type)

    logger.debug(f"Loaded {len(ctx.tags)} tags for context")

    # Call the correction function
    logger.info("Starting LLM item correction...")
    corrected_items = await llm_correct_item(
        image_data_uri=image_data_uri,
        current_item=current_item_dict,
        correction_instructions=correction_instructions,
        tags=ctx.tags,
        field_preferences=ctx.field_preferences,
        output_language=ctx.output_language,
        custom_fields=ctx.custom_fields,
    )
    logger.info(f"Correction resulted in {len(corrected_items)} item(s)")

    # Filter out default tag from AI suggestions (frontend will auto-add it)
    return CorrectionResponse(
        items=[
            CorrectedItemResponse(
                name=item.name,
                quantity=item.quantity,
                description=item.description,
                tag_ids=filter_default_tag(item.tag_ids, ctx.default_tag_id),
                manufacturer=item.manufacturer,
                model_number=item.model_number,
                serial_number=item.serial_number,
                purchase_price=item.purchase_price,
                purchase_from=item.purchase_from,
                notes=item.notes,
                custom_fields=get_custom_fields_dict(item, ctx.custom_fields),
            )
            for item in corrected_items
        ],
        message=f"Corrected to {len(corrected_items)} item(s)",
    )
