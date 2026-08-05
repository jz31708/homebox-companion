from pathlib import Path

path = Path("frontend/src/routes/bulk-capture/+page.svelte")
text = path.read_text()

text = text.replace(
    "\tlet retryingFilePicker = $state(false);\n",
    "\tlet retryingFilePicker = $state(false);\n\tlet discardingSweep = $state(false);\n",
)

anchor = "\tasync function retryTranscription(segmentId: string): Promise<void> {\n"
handler = """\tasync function discardSweep(): Promise<void> {
\t\tif (discardingSweep) return;
\t\tdiscardingSweep = true;
\t\ttry {
\t\t\tawait workflow.discardPersistedMission();
\t\t\tawait goto(resolve('/location'));
\t\t} finally {
\t\t\tdiscardingSweep = false;
\t\t}
\t}

"""
if handler not in text:
    text = text.replace(anchor, handler + anchor)

text = text.replace(
    '<Button variant="secondary" full onclick={() => workflow.discardPersistedMission()}>',
    '<Button variant="secondary" full disabled={discardingSweep} onclick={discardSweep}>',
)
text = text.replace(
    "{#if segment.status === 'failed' || segment.status === 'transcribing'}",
    "{#if segment.status === 'failed'}",
)

path.write_text(text)
