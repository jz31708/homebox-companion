from datetime import UTC, datetime
from io import BytesIO

from pypdf import PdfReader

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


def test_notice_pdf_is_complete_multipage_and_readable() -> None:
    document = NoticeDocument(
        cis="123456",
        source_url="https://example.test/notice",
        retrieved_at=datetime.now(UTC),
        title="Notice médicament – sécurité",
        short_purpose="Traitement symptomatique officiel.",
        sections=[
            NoticeSection(
                heading="Indications",
                paragraphs=["É" * 40 + " information officielle. " + "Long texte. " * 240],
                bullet_lists=[["Première information", "Deuxième information"]],
            ),
            NoticeSection(heading="Précautions", paragraphs=["Données importantes. " * 300]),
        ],
    )
    reader = PdfReader(BytesIO(render_notice_pdf(document)))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert len(reader.pages) >= 3
    assert "Indications" in text
    assert "Précautions" in text
    assert "123456" in text
