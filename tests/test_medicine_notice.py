from datetime import UTC, datetime

from homebox_companion.medicine.models import NoticeDocument, NoticeSection
from homebox_companion.medicine.notice import render_notice_pdf, sanitize_notice_html


def test_notice_sanitization_and_pdf():
    text = sanitize_notice_html(
        "<script>x</script><h1>Notice</h1><p>Indications: relief of pain.</p>", "https://example"
    )
    assert "<script>" not in text and "Notice" in text
    document = NoticeDocument(
        cis="1",
        source_url="https://example",
        retrieved_at=datetime.now(UTC),
        title="Notice",
        sections=[NoticeSection(heading="Notice", paragraphs=[text])],
    )
    assert render_notice_pdf(document).startswith(b"%PDF-1.4")
