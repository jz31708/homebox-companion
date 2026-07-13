from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from html.parser import HTMLParser
from io import BytesIO

import httpx
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

from .lookup import OFFICIAL_BASE
from .models import NoticeDocument, NoticeSection


class _NoticeParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.title = "Official medicine notice"
        self._skip = 0

    def handle_starttag(self, tag, _attrs):
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
    url = f"{OFFICIAL_BASE}/medicament/{cis}/extrait"
    async with httpx.AsyncClient(timeout=httpx.Timeout(20), follow_redirects=True) as client:
        response = await client.get(url, headers={"User-Agent": "Homebox-Companion-Medicine/1.0"})
        response.raise_for_status()
    parser = _NoticeParser()
    parser.feed(response.text)
    text = "\n".join(parser.parts)
    indications = re.search(r"(?:indications|dans quel cas).*?([^.]{20,240}\.)", text, re.IGNORECASE)
    sections = [NoticeSection(heading="Notice", paragraphs=parser.parts)]
    short_purpose = indications.group(1).strip() if indications else None
    if indications:
        sections.insert(0, NoticeSection(heading="From official notice", paragraphs=[short_purpose]))
    return NoticeDocument(
        cis=cis,
        source_url=str(response.url),
        retrieved_at=datetime.now(UTC),
        title=parser.title,
        sections=sections,
        short_purpose=short_purpose[:220] if short_purpose else None,
        sha256=hashlib.sha256(response.content).hexdigest(),
    )


def render_notice_pdf(document: NoticeDocument) -> bytes:
    """Render the complete notice with wrapping, Unicode text, and pagination."""
    output = BytesIO()
    styles = getSampleStyleSheet()
    title = ParagraphStyle('NoticeTitle', parent=styles['Title'], alignment=TA_CENTER, spaceAfter=8)
    heading = ParagraphStyle('NoticeHeading', parent=styles['Heading2'], spaceBefore=10, spaceAfter=5)
    body = ParagraphStyle('NoticeBody', parent=styles['BodyText'], leading=14, spaceAfter=6)
    small = ParagraphStyle('NoticeSmall', parent=styles['BodyText'], fontSize=8, leading=10, textColor='#555555')
    story = [Paragraph(document.title, title), Paragraph(f'CIS: {document.cis}', small),
             Paragraph(f'Source: {document.source_url}', small),
             Paragraph(f'Retrieved: {document.retrieved_at.isoformat()}', small),
             Paragraph('This document reproduces information from the live official source.', small), Spacer(1, 8)]
    if document.short_purpose:
        story += [Paragraph('Purpose', heading), Paragraph(document.short_purpose, body)]
    for section in document.sections:
        story.append(Paragraph(section.heading, heading))
        story.extend(Paragraph(p, body) for p in section.paragraphs)
        for bullets in section.bullet_lists:
            story.append(ListFlowable([ListItem(Paragraph(item, body)) for item in bullets], bulletType='bullet'))
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica', 8)
        canvas.drawString(20 * mm, 12 * mm, f'CIS {document.cis} · Official notice')
        canvas.drawRightString(190 * mm, 12 * mm, f'Page {doc.page}')
        canvas.restoreState()
    document_template = SimpleDocTemplate(
        output, pagesize=A4, rightMargin=20 * mm, leftMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=20 * mm,
        title=document.title, author='Homebox Companion',
    )
    document_template.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()
