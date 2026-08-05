import re
from pathlib import Path

support = Path("frontend/e2e/support/phase2Narration.ts")
support_text = support.read_text()
support_text = support_text.replace(
    "const record = value as { id?: string; lastError?: { code?: string } | null };",
    "const record = value as { id?: string; status?: string; lastError?: { code?: string } | null };",
)
support_text = re.sub(
    r"\(failureKind === 'failure-mission-put' &&\s*this\.name === 'missions' &&\s*record\.lastError\?\.code\?\.startsWith\('TRANSCRIPTION_'\)\)",
    "(failureKind === 'failure-mission-put' &&\n\t\t\t\t\t\tthis.name === 'audio' &&\n\t\t\t\t\t\t\trecord.status === 'failed')",
    support_text,
)
support.write_text(support_text)

spec = Path("frontend/e2e/phase2-narration.spec.ts")
spec_text = spec.read_text()
old_locator = "page.getByText(/Microphone unavailable/i)"
new_locator = (
    "page.getByText('Microphone unavailable. You can type notes instead.', "
    "{ exact: true })"
)
if old_locator in spec_text:
    spec.write_text(spec_text.replace(old_locator, new_locator))

base = Path("frontend/src/lib/workflows/bulkSweepBase.svelte.ts")
base_text = base.read_text()
base_text = base_text.replace(
    "log.error('Bulk transcription failure could not be persisted', persistenceError);",
    "void persistenceError;\n\t\t\t\tlog.error('Bulk transcription failure could not be persisted safely');",
).replace(
    "log.warn('Bulk server transcription unavailable; audio remains persisted', error);",
    "void error;\n\t\t\tlog.warn('Bulk server transcription unavailable; audio remains persisted safely');",
)
base.write_text(base_text)
