"""Medicine intake detection pipeline."""

from __future__ import annotations

import re
from urllib.parse import quote_plus

from ...ai.images import encode_image_bytes_to_data_uri
from ...ai.llm import vision_completion
from .medicine_models import (
    MedicineCandidate,
    MedicineCompletionResponse,
    MedicineDatabaseMatch,
    MedicinePhotoMeta,
    MedicineUserContext,
)

BDPM_SEARCH_URL = "https://base-donnees-publique.medicaments.gouv.fr/index.php?choixRecherche=medicament"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "medicine"


def _extract_cip13(text: str | None) -> str | None:
    if not text:
        return None
    for match in re.findall(r"\b\d{13}\b", text):
        if match.startswith(("3400", "34009")):
            return match
    return None


def _build_public_reference(candidate: MedicineCandidate, context: MedicineUserContext) -> MedicineDatabaseMatch:
    query = " ".join(
        part
        for part in [
            candidate.name,
            candidate.activeIngredient,
            candidate.strength,
            context.barcodeText,
        ]
        if part
    ).strip()
    cip13 = candidate.cip13 or _extract_cip13(context.barcodeText)
    confidence = 0.55 if cip13 else 0.35 if query else 0.0
    notice_url = (
        f"{BDPM_SEARCH_URL}&txtCaracteres={quote_plus(query or cip13 or '')}"
        if query or cip13
        else BDPM_SEARCH_URL
    )
    return MedicineDatabaseMatch(
        source="bdpm" if query or cip13 else "none",
        query=query or None,
        cip13=cip13,
        denomination=candidate.name,
        form=candidate.form,
        activeSubstances=[candidate.activeIngredient] if candidate.activeIngredient else [],
        noticeUrl=notice_url,
        confidence=confidence,
    )


def _build_system_prompt(output_language: str | None) -> str:
    language = output_language or "the user's language"
    return (
        "You are extracting a medicine inventory item for Homebox. "
        "This is inventory metadata only, not medical advice. Do not infer whether the user should take a medicine. "
        f"Write user-facing text in {language}. "
        "Return strict JSON matching the requested schema. "
        "Use visible package text, expiry-side photos, dose/blister photos, optional code text, and user notes. "
        "Never invent dosage instructions, medical warnings, or an exact expiry if it is not visible or provided. "
        "If a value is uncertain, leave it null and add a short uncertainty reason."
    )


def _build_user_prompt(photos: list[MedicinePhotoMeta], context: MedicineUserContext) -> str:
    photo_lines = []
    for photo in photos:
        details: list[str] = [f"kind={photo.kind}"]
        if photo.note:
            details.append(f"note={photo.note}")
        photo_lines.append(f"P{photo.index:03d} id={photo.id}: " + "; ".join(details))

    return (
        "Create exactly one Homebox candidate for this medicine.\n"
        "Important fields:\n"
        "- name: commercial name visible on the package.\n"
        "- activeIngredient, strength, form, packageSize when visible.\n"
        "- expiryDate should be YYYY-MM if only month/year is visible, or YYYY-MM-DD if exact date is clear.\n"
        "- remainingDoses and remainingDoseLabel should prioritize user input, then visible blister/bottle contents.\n"
        "- storage should only mention visible or user-provided storage constraints, such as refrigerator.\n"
        "- notes can include concise inventory notes and official-reference caveats.\n"
        "- sourcePhotoIds must cite the relevant photo IDs.\n\n"
        f"User note: {context.note or ''}\n"
        f"Optional code/barcode/CIP text: {context.barcodeText or ''}\n"
        f"User expiry override: {context.expiryDate or ''}\n"
        f"Opened date: {context.openedDate or ''}\n"
        f"Remaining doses: {context.remainingDoses if context.remainingDoses is not None else ''}\n"
        f"Remaining level: {context.remainingDoseLabel}\n\n"
        "Photo metadata:\n" + "\n".join(photo_lines)
    )


def _apply_user_overrides(candidate: MedicineCandidate, context: MedicineUserContext) -> MedicineCandidate:
    if context.expiryDate:
        candidate.expiryDate = context.expiryDate
    if context.openedDate:
        candidate.openedDate = context.openedDate
    if context.remainingDoses is not None:
        candidate.remainingDoses = context.remainingDoses
    if context.remainingDoseLabel != "unknown":
        candidate.remainingDoseLabel = context.remainingDoseLabel
    if context.barcodeText and not candidate.cip13:
        candidate.cip13 = _extract_cip13(context.barcodeText)
    return candidate


async def detect_medicine(
    image_data: list[tuple[MedicinePhotoMeta, bytes, str]],
    *,
    context: MedicineUserContext,
    output_language: str | None,
) -> MedicineCandidate:
    """Detect one medicine candidate from multiple item photos."""
    photos = [entry[0] for entry in image_data]
    image_data_uris = [encode_image_bytes_to_data_uri(raw, mime) for _, raw, mime in image_data]
    parsed = await vision_completion(
        system_prompt=_build_system_prompt(output_language),
        user_prompt=_build_user_prompt(photos, context),
        image_data_uris=image_data_uris,
        expected_keys=["medicine"],
        response_model=MedicineCompletionResponse,
    )
    candidate = MedicineCompletionResponse.model_validate(parsed).medicine
    if not candidate.id:
        candidate.id = f"med_{_slug(candidate.name)}"
    candidate = _apply_user_overrides(candidate, context)
    if not candidate.sourcePhotoIds:
        candidate.sourcePhotoIds = [photo.id for photo in photos]
    match = _build_public_reference(candidate, context)
    candidate.databaseMatch = match
    candidate.noticeUrl = candidate.noticeUrl or match.noticeUrl
    candidate.cip13 = candidate.cip13 or match.cip13
    if match.confidence < 0.6:
        uncertainty = "Public medicine match is a best-effort search; verify notice manually."
        candidate.uncertaintyReasons = sorted(
            set(candidate.uncertaintyReasons + [uncertainty])
        )
    return candidate
