from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from html.parser import HTMLParser

import httpx

from .lookup import OFFICIAL_BASE
from .models import NoticeDocument, NoticeSection


class _NoticeParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.title = "Official medicine notice"
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "nav", "header", "footer"}:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style", "nav", "header", "footer"} and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        text = " ".join(data.split())
        if text and not self._skip:
            self.parts.append(text)


def sanitize_notice_html(html: str, source_url: str) -> str:
    parser = _NoticeParser()
    parser.feed(html)
    title = parser.parts[0] if parser.parts else "Official medicine notice"
    paragraphs = "\n".join(parser.parts)
    return f"{title}\nSource: {source_url}\n\n{paragraphs}"


async def fetch_official_notice(cis: str) -> NoticeDocument:
    url = f"{OFFICIAL_BASE}/extrait.php?specid={cis}"
    async with httpx.AsyncClient(timeout=httpx.Timeout(20), follow_redirects=True) as client:
        response = await client.get(url, headers={"User-Agent": "Homebox-Companion-Medicine/1.0"})
        response.raise_for_status()
    parser = _NoticeParser()
    parser.feed(response.text)
    text = "\n".join(parser.parts)
    indications = re.search(r"(?:indications|dans quel cas).*?([^.]{20,240}\.)", text, re.IGNORECASE)
    sections = [NoticeSection(heading="Notice", paragraphs=parser.parts)]
    if indications:
        sections.insert(0, NoticeSection(heading="From official notice", paragraphs=[indications.group(1).strip()]))
    return NoticeDocument(
        cis=cis,
        source_url=str(response.url),
        retrieved_at=datetime.now(UTC),
        title=parser.title,
        sections=sections,
        sha256=hashlib.sha256(response.content).hexdigest(),
    )


def render_notice_pdf(document: NoticeDocument) -> bytes:
    """Render a tiny deterministic, readable PDF without a heavyweight renderer."""
    lines = [
        document.title,
        f"CIS: {document.cis}",
        f"Source: {document.source_url}",
        f"Retrieved: {document.retrieved_at.isoformat()}",
    ]
    for section in document.sections:
        lines.append(section.heading)
        lines.extend(section.paragraphs)
    escaped = " ".join(lines).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 9 Tf 36 760 Td ({escaped[:5000]}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
    ]
    pdf = b"%PDF-1.4\n"
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    pdf += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return pdf
