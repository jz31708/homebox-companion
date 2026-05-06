"""Medicine intake detection pipeline."""

from __future__ import annotations

import re
from html import unescape
from urllib.parse import quote_plus

import httpx
from loguru import logger

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
MEDICAMENTS_API_BASE_URL = "https://medicaments-api.giygas.dev/v1"
MEDICAMENTS_API_TIMEOUT_S = 8.0
OFFICIAL_PAGE_TIMEOUT_S = 10.0
GENERAL_USE_PREFIX = "Not medical advice; verify in the official notice: "


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "medicine"


def _extract_cip13(text: str | None) -> str | None:
    if not text:
        return None
    for match in re.findall(r"\b\d{13}\b", text):
        if match.startswith(("3400", "34009")):
            return match
    return None


def _is_placeholder_name(name: str | None, cip13: str | None) -> bool:
    if not name:
        return True
    cleaned = re.sub(r"\s+", " ", name.strip()).lower()
    if not cleaned:
        return True
    if cleaned in {"medicine", "medicament", "medicament inconnu", "unknown medicine"}:
        return True
    if cip13 and cleaned in {f"medicine {cip13}", f"medicament {cip13}"}:
        return True
    return False


def _build_reference_query(candidate: MedicineCandidate, context: MedicineUserContext) -> tuple[str, str | None]:
    cip13 = candidate.cip13 or _extract_cip13(context.barcodeText)
    if cip13:
        return cip13, cip13

    parts: list[str] = []
    if not _is_placeholder_name(candidate.name, None):
        parts.append(candidate.name)
    if candidate.activeIngredient:
        parts.append(candidate.activeIngredient)
    if candidate.strength:
        parts.append(candidate.strength)
    if context.barcodeText:
        parts.append(context.barcodeText)

    unique_parts: list[str] = []
    seen: set[str] = set()
    for part in parts:
        normalized = re.sub(r"\s+", " ", part.strip())
        if not normalized:
            continue
        key = normalized.casefold()
        if key in seen:
            continue
        seen.add(key)
        unique_parts.append(normalized)
    return " ".join(unique_parts).strip(), cip13


def _build_public_reference(candidate: MedicineCandidate, context: MedicineUserContext) -> MedicineDatabaseMatch:
    query, cip13 = _build_reference_query(candidate, context)
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


def _build_bdpm_search_url(query: str | None, cip13: str | None) -> str:
    term = (query or cip13 or "").strip()
    if not term:
        return BDPM_SEARCH_URL
    return f"{BDPM_SEARCH_URL}&txtCaracteres={quote_plus(term)}"


def _build_bdpm_official_page_url(cis: str | None) -> str | None:
    if not cis:
        return None
    return f"https://base-donnees-publique.medicaments.gouv.fr/medicament/{quote_plus(cis)}/extrait"


def _build_bdpm_notice_url(cis: str | None, fallback_query: str | None, cip13: str | None) -> str:
    official_page = _build_bdpm_official_page_url(cis)
    if official_page:
        return f"{official_page}#tab-notice"
    return _build_bdpm_search_url(fallback_query, cip13)


def _build_bdpm_rcp_url(cis: str | None) -> str | None:
    official_page = _build_bdpm_official_page_url(cis)
    if not official_page:
        return None
    return f"{official_page}#tab-rcp"


def _html_to_text(fragment: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", fragment)
    text = re.sub(r"(?i)<br\s*/?>", " ", text)
    text = re.sub(r"(?i)</p\s*>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = text.replace("\u2011", "-").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def _clean_general_use_sentence(text: str) -> str | None:
    cleaned = _html_to_text(text)
    if not cleaned:
        return None
    sentence_matches = re.findall(r"[^.!?]+[.!?]", cleaned)
    candidates = sentence_matches or [cleaned]
    preferred: list[str] = []
    for pattern in (r"\bsoulage\b", r"\butilis[eé]\b", r"\bindiqu[eé]\b", r"\baide\b", r"\bcontre\b"):
        preferred = [
            sentence.strip()
            for sentence in candidates
            if re.search(pattern, sentence, re.IGNORECASE)
        ]
        if preferred:
            break
    sentence = (preferred[0] if preferred else candidates[0]).strip()
    sentence = re.sub(r"^(Indications thérapeutiques\s*)+", "", sentence, flags=re.IGNORECASE).strip()
    sentence = re.sub(r"\s*\([^)]{20,180}\)", "", sentence).strip()
    if not sentence:
        return None
    if len(sentence) > 180:
        sentence = sentence[:177].rsplit(" ", 1)[0].rstrip(" ,;:") + "..."
    return f"{GENERAL_USE_PREFIX}{sentence}"


def _extract_general_use_from_official_html(html: str) -> str | None:
    match = re.search(
        r'id=["\']heading-indications-therapeutiques["\'][\s\S]*?(?=<h5\b|id=["\']heading-groupe-generique["\'])',
        html,
        re.IGNORECASE,
    )
    if match:
        return _clean_general_use_sentence(match.group(0))

    fallback_match = re.search(
        r"((?:[^<]|<[^/]|</(?!h5))*?(?:soulage|utilis[eé]|indiqu[eé]).{80,900})",
        html,
        re.IGNORECASE,
    )
    if fallback_match:
        return _clean_general_use_sentence(fallback_match.group(1))
    return None


def _normalize_general_use(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return None
    if cleaned.casefold().startswith(GENERAL_USE_PREFIX.casefold()):
        return cleaned
    return f"{GENERAL_USE_PREFIX}{cleaned}"


async def _lookup_official_general_use(cis: str | None) -> str | None:
    official_page = _build_bdpm_official_page_url(cis)
    if not official_page:
        return None
    try:
        async with httpx.AsyncClient(timeout=OFFICIAL_PAGE_TIMEOUT_S, follow_redirects=True) as client:
            response = await client.get(official_page)
    except (httpx.TimeoutException, httpx.NetworkError) as exc:
        logger.debug("Official medicine page lookup failed for CIS {}: {}", cis, exc)
        return None
    if response.status_code != 200:
        logger.debug("Official medicine page returned {} for CIS {}", response.status_code, cis)
        return None
    return _extract_general_use_from_official_html(response.text)


def _extract_active_substances(payload: dict) -> list[str]:
    substances: list[str] = []
    for entry in payload.get("composition", []) or []:
        if not isinstance(entry, dict):
            continue
        value = (entry.get("denominationSubstance") or "").strip()
        if value:
            substances.append(value)
    unique: list[str] = []
    seen: set[str] = set()
    for item in substances:
        key = item.casefold()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


async def _lookup_medicine_api_by_cip13(
    cip13: str,
) -> tuple[MedicineDatabaseMatch | None, dict[str, str | None]]:
    endpoint = f"{MEDICAMENTS_API_BASE_URL}/medicaments"
    try:
        async with httpx.AsyncClient(timeout=MEDICAMENTS_API_TIMEOUT_S) as client:
            response = await client.get(endpoint, params={"cip": cip13})
    except (httpx.TimeoutException, httpx.NetworkError) as exc:
        logger.debug("Medicine API lookup failed for CIP {}: {}", cip13, exc)
        return None, {}

    if response.status_code != 200:
        logger.debug("Medicine API lookup returned {} for CIP {}", response.status_code, cip13)
        return None, {}

    try:
        payload = response.json()
    except ValueError:
        logger.debug("Medicine API lookup returned invalid JSON for CIP {}", cip13)
        return None, {}

    data: dict | None = None
    if isinstance(payload, dict):
        if payload.get("code") == 404:
            return None, {}
        data = payload
    elif isinstance(payload, list):
        first = payload[0] if payload else None
        if isinstance(first, dict):
            data = first

    if not data:
        return None, {}

    cis = str(data.get("cis")) if data.get("cis") is not None else None
    denomination = (data.get("elementPharmaceutique") or "").strip() or None
    form = (data.get("formePharmaceutique") or "").strip() or None
    titulaire = (data.get("titulaire") or "").strip() or None
    active_substances = _extract_active_substances(data)
    official_page_url = _build_bdpm_official_page_url(cis)
    notice_url = _build_bdpm_notice_url(cis, cis or denomination, cip13)
    rcp_url = _build_bdpm_rcp_url(cis)
    general_use = await _lookup_official_general_use(cis)

    match = MedicineDatabaseMatch(
        source="api-medicaments-fr",
        query=cip13,
        cis=cis,
        cip13=cip13,
        denomination=denomination,
        form=form,
        activeSubstances=active_substances,
        generalUse=general_use,
        officialPageUrl=official_page_url,
        noticeUrl=notice_url,
        rcpUrl=rcp_url,
        confidence=0.9,
        raw=data,
    )
    enrichment = {
        "name": denomination,
        "manufacturer": titulaire,
        "activeIngredient": active_substances[0] if active_substances else None,
        "form": form,
        "cis": cis,
        "generalUse": general_use,
        "officialPageUrl": official_page_url,
        "noticeUrl": notice_url,
        "rcpUrl": rcp_url,
    }
    return match, enrichment


def _build_system_prompt(output_language: str | None) -> str:
    language = output_language or "the user's language"
    return (
        "You are extracting a medicine inventory item for Homebox. "
        "This is inventory metadata only, not medical advice. Do not infer whether the user should take a medicine. "
        f"Write user-facing text in {language}. "
        "Return strict JSON matching the requested schema. "
        "Use visible package text, expiry-side photos, dose/blister photos, optional code text, and user notes. "
        "Never invent dosage instructions, medical warnings, or an exact expiry if it is not visible or provided. "
        "If you include generalUse, keep it to one short sentence, prefix it as non-medical-advice text, "
        "and base it only on visible notice/package text or provided official data. "
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
        "- If a photo kind is barcode, read any visible barcode, DataMatrix, QR, CIP, "
        "or printed code and use it as an identification hint.\n"
        "- storage should only mention visible or user-provided storage constraints, such as refrigerator.\n"
        "- generalUse is optional: one short non-trusted sentence about what the medicine is generally for, "
        "only when visible text or official context supports it.\n"
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
    candidate.generalUse = _normalize_general_use(candidate.generalUse)
    return candidate


def _apply_database_enrichment(
    candidate: MedicineCandidate,
    match: MedicineDatabaseMatch,
    enrichment: dict[str, str | None],
) -> MedicineCandidate:
    cip13 = candidate.cip13 or match.cip13
    if _is_placeholder_name(candidate.name, cip13) and enrichment.get("name"):
        candidate.name = enrichment["name"] or candidate.name
    if enrichment.get("manufacturer") and not candidate.manufacturer:
        candidate.manufacturer = enrichment["manufacturer"]
    if enrichment.get("activeIngredient") and not candidate.activeIngredient:
        candidate.activeIngredient = enrichment["activeIngredient"]
    if enrichment.get("form") and not candidate.form:
        candidate.form = enrichment["form"]
    if enrichment.get("cis") and not candidate.cis:
        candidate.cis = enrichment["cis"]
    if enrichment.get("generalUse") and not candidate.generalUse:
        candidate.generalUse = enrichment["generalUse"]
    if enrichment.get("officialPageUrl") and not candidate.officialPageUrl:
        candidate.officialPageUrl = enrichment["officialPageUrl"]
    if enrichment.get("noticeUrl") and not candidate.noticeUrl:
        candidate.noticeUrl = enrichment["noticeUrl"]
    if enrichment.get("rcpUrl") and not candidate.rcpUrl:
        candidate.rcpUrl = enrichment["rcpUrl"]
    candidate.confidence = max(candidate.confidence, match.confidence)
    return candidate


async def lookup_medicine_barcode(
    *,
    context: MedicineUserContext,
    output_language: str | None,
) -> MedicineCandidate:
    """Build a reviewable medicine candidate from a scanned code without requiring photos."""
    code = (context.barcodeText or "").strip()
    cip13 = _extract_cip13(code)
    name = f"Medicine {cip13 or code}"
    candidate = MedicineCandidate(
        id=f"med_{_slug(cip13 or code)}",
        name=name,
        quantity=1,
        description="Medicine identified from a scanned package code. Review the fields before saving.",
        notes=context.note,
        cip13=cip13,
        confidence=0.58 if cip13 else 0.35,
        sourcePhotoIds=[],
        uncertaintyReasons=[
            "Scanned code was used without label photos; verify the medicine name before saving.",
        ],
    )
    candidate = _apply_user_overrides(candidate, context)
    match: MedicineDatabaseMatch
    if cip13:
        api_match, enrichment = await _lookup_medicine_api_by_cip13(cip13)
        if api_match:
            match = api_match
            candidate = _apply_database_enrichment(candidate, api_match, enrichment)
        else:
            match = _build_public_reference(candidate, context)
    else:
        match = _build_public_reference(candidate, context)
    candidate.databaseMatch = match
    candidate.generalUse = candidate.generalUse or match.generalUse
    candidate.officialPageUrl = candidate.officialPageUrl or match.officialPageUrl
    candidate.noticeUrl = candidate.noticeUrl or match.noticeUrl
    candidate.rcpUrl = candidate.rcpUrl or match.rcpUrl
    candidate.cip13 = candidate.cip13 or match.cip13
    candidate.cis = candidate.cis or match.cis
    if not cip13:
        candidate.uncertaintyReasons.append(
            "The scanned code did not look like a French CIP13 medicine code."
        )
    if output_language and output_language.lower().startswith("fr"):
        candidate.description = (
            "Medicament identifie depuis un code scanne. Verifiez les champs avant l'enregistrement."
        )
        candidate.uncertaintyReasons = [
            "Le code scanne a ete utilise sans photos de l'etiquette ; verifiez le nom avant l'enregistrement.",
            *(
                ["Le code scanne ne ressemble pas a un code medicament francais CIP13."]
                if not cip13
                else []
            ),
        ]
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
    cip13 = candidate.cip13 or _extract_cip13(context.barcodeText)
    if cip13:
        api_match, enrichment = await _lookup_medicine_api_by_cip13(cip13)
        if api_match:
            match = api_match
            candidate = _apply_database_enrichment(candidate, api_match, enrichment)
        else:
            match = _build_public_reference(candidate, context)
    else:
        match = _build_public_reference(candidate, context)
    candidate.databaseMatch = match
    candidate.generalUse = candidate.generalUse or match.generalUse
    candidate.officialPageUrl = candidate.officialPageUrl or match.officialPageUrl
    candidate.noticeUrl = candidate.noticeUrl or match.noticeUrl
    candidate.rcpUrl = candidate.rcpUrl or match.rcpUrl
    candidate.cip13 = candidate.cip13 or match.cip13
    candidate.cis = candidate.cis or match.cis
    if match.confidence < 0.6:
        uncertainty = "Public medicine match is a best-effort search; verify notice manually."
        candidate.uncertaintyReasons = sorted(
            set(candidate.uncertaintyReasons + [uncertainty])
        )
    return candidate
