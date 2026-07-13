from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterable


def _repair_mojibake(text: str) -> str:
    """Repair a UTF-8 payload that was incorrectly decoded as Latin-1."""
    markers = ("Ã", "Â", "â€", "�")
    before = sum(text.count(marker) for marker in markers)
    if not before:
        return text
    try:
        candidate = text.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text
    after = sum(candidate.count(marker) for marker in markers)
    return candidate if after < before else text


def decode_official(data: bytes) -> str:
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    for encoding in ("utf-8", "cp1252", "iso-8859-1"):
        try:
            return _repair_mojibake(data.decode(encoding))
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("unknown", data, 0, len(data), "BDPM file is not decodable")


def parse_tsv(data: bytes, *, expected_width: int | None = None) -> tuple[list[list[str]], int]:
    rows = list(csv.reader(io.StringIO(decode_official(data)), delimiter="\t"))
    malformed = sum(1 for row in rows if expected_width and len(row) != expected_width)
    if rows and expected_width and malformed / len(rows) > 0.05:
        raise ValueError(f"too many malformed BDPM rows: {malformed}/{len(rows)}")
    return rows, malformed


def raw_json(row: Iterable[str]) -> str:
    return json.dumps(list(row), ensure_ascii=False, separators=(",", ":"))
