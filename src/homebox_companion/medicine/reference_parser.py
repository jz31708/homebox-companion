from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterable


def decode_official(data: bytes) -> str:
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    for encoding in ("utf-8", "cp1252", "iso-8859-1"):
        try:
            return data.decode(encoding)
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
