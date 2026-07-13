from __future__ import annotations

import re

from .models import MedicineReference

OFFICIAL_BASE = "https://base-donnees-publique.medicaments.gouv.fr"


def normalize_barcode(payload: str) -> list[str]:
    """Return unique 13-digit candidates while retaining no raw payload."""
    candidates = re.findall(r"(?<!\d)\d{13}(?!\d)", payload or "")
    return list(dict.fromkeys(candidates))


def reference_from_rows(cip: dict, speciality: dict, compositions: list[dict]) -> MedicineReference:
    substances = list(dict.fromkeys(c["substance_name"].strip() for c in compositions if c.get("substance_name")))
    cip13 = cip["cip13"]
    cis = cip["cis"]
    return MedicineReference(
        cip13=cip13,
        cip7=cip.get("cip7"),
        cis=cis,
        name=speciality["name"],
        pharmaceutical_form=speciality.get("pharmaceutical_form"),
        presentation=cip.get("label"),
        active_substances=substances,
        authorization_holder=speciality.get("authorization_holder"),
        official_page_url=f"{OFFICIAL_BASE}/extrait.php?specid={cis}",
        notice_url=f"{OFFICIAL_BASE}/extrait.php?specid={cis}",
        rcp_url=f"{OFFICIAL_BASE}/extrait.php?specid={cis}",
    )
