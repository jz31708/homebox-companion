from __future__ import annotations

import hashlib
from datetime import UTC, datetime

import httpx

from .reference_parser import parse_tsv

BDPM_DOWNLOADS = {
    "specialities": "https://base-donnees-publique.medicaments.gouv.fr/download/CIS_bdpm.txt",
    "presentations": "https://base-donnees-publique.medicaments.gouv.fr/download/CIS_CIP_bdpm.txt",
    "compositions": "https://base-donnees-publique.medicaments.gouv.fr/download/CIS_COMPO_bdpm.txt",
}


async def download_official_files() -> dict[str, tuple[bytes, str]]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(30), follow_redirects=True) as client:
        result = {}
        for name, url in BDPM_DOWNLOADS.items():
            response = await client.get(url, headers={"User-Agent": "Homebox-Companion-Medicine/1.0"})
            response.raise_for_status()
            if response.headers.get("content-type", "").startswith("text/html"):
                raise ValueError(f"BDPM returned HTML instead of {name}")
            parse_tsv(response.content)
            result[name] = response.content, hashlib.sha256(response.content).hexdigest()
    return result


def metadata_for_downloads(files: dict[str, tuple[bytes, str]]) -> dict[str, str]:
    checksums = {f"{name}_sha256": checksum for name, (_, checksum) in files.items()}
    return {"downloaded_at": datetime.now(UTC).isoformat(), **checksums}
