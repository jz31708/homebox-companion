from pathlib import Path

TYPES = Path('frontend/src/lib/types/index.ts')
BASE = Path('frontend/src/lib/workflows/bulkSweepBase.svelte.ts')
PAGE = Path('frontend/src/routes/bulk-capture/+page.svelte')

# ---------------------------------------------------------------------------
# Durable photo type and workflow metadata
# ---------------------------------------------------------------------------
text = TYPES.read_text()
old = "\ttakenAtMs: number;\n\tsessionOffsetMs: number;\n\tnote: string;"
new = "\ttakenAtMs: number;\n\tsessionOffsetMs: number;\n\tcaptureSequence: number;\n\tnote: string;"
if old not in text:
    raise SystemExit('BulkCapturedPhoto anchor not found')
TYPES.write_text(text.replace(old, new, 1))

text = BASE.read_text()
text = text.replace(
    "\t\t\tsessionOffsetMs: photo.sessionOffsetMs,\n\t\t\tnote: photo.note,",
    "\t\t\tsessionOffsetMs: photo.sessionOffsetMs,\n\t\t\tcaptureSequence: photo.captureSequence,\n\t\t\tnote: photo.note,",
    1,
)
text = text.replace(
    "\tasync addPhotos(files: File[]): Promise<void> {",
    "\tasync addPhotos(\n\t\tfiles: File[],\n\t\tcaptureMetadata: Array<{\n\t\t\tid?: string;\n\t\t\ttakenAtMs?: number;\n\t\t\tsessionOffsetMs?: number;\n\t\t\tcaptureSequence?: number;\n\t\t}> = []\n\t): Promise<void> {",
    1,
)
old_added = """\t\tconst added = files.map((file) => ({
\t\t\tid: createId('p'),
\t\t\tfile,
\t\t\tpreviewUrl: URL.createObjectURL(file),
\t\t\ttakenAtMs: now,
\t\t\tsessionOffsetMs: now - startedAtMs,
\t\t\tnote: '',
\t\t\tgroupLabel: '',
\t\t\tignored: false,
\t\t}));
"""
new_added = """\t\tconst firstSequence = this._nextCaptureSequence;
\t\tconst added = files.map((file, index) => {
\t\t\tconst metadata = captureMetadata[index];
\t\t\tconst takenAtMs = metadata?.takenAtMs ?? now;
\t\t\treturn {
\t\t\t\tid: metadata?.id ?? createId('p'),
\t\t\t\tfile,
\t\t\t\tpreviewUrl: URL.createObjectURL(file),
\t\t\t\ttakenAtMs,
\t\t\t\tsessionOffsetMs: metadata?.sessionOffsetMs ?? Math.max(0, takenAtMs - startedAtMs),
\t\t\t\tcaptureSequence: metadata?.captureSequence ?? firstSequence + index,
\t\t\t\tnote: '',
\t\t\t\tgroupLabel: '',
\t\t\t\tignored: false,
\t\t\t};
\t\t});
"""
if old_added not in text:
    raise SystemExit('addPhotos added block not found')
text = text.replace(old_added, new_added, 1)
text = text.replace("\t\tconst firstSequence = this._nextCaptureSequence;\n\t\tconst records", "\t\tconst records", 1)
text = text.replace(
    "\t\t\tcaptureSequence: firstSequence + index,",
    "\t\t\tcaptureSequence: photo.captureSequence,",
    1,
)
text = text.replace(
    "\t\t\t\t\tsessionOffsetMs: photo.sessionOffsetMs,\n\t\t\t\t\tnote: photo.note,",
    "\t\t\t\t\tsessionOffsetMs: photo.sessionOffsetMs,\n\t\t\t\t\tcaptureSequence: photo.captureSequence,\n\t\t\t\t\tnote: photo.note,",
    1,
)
BASE.write_text(text)

# ---------------------------------------------------------------------------
# Route: unified camera+audio studio, native picker secondary only
# ---------------------------------------------------------------------------
text = PAGE.read_text()
text = text.replace(
    "import BulkCameraCapture from '$lib/components/BulkCameraCapture.svelte';",
    "import BulkContinuousCapture from '$lib/components/BulkContinuousCapture.svelte';\n\timport type { CaptureAudioResult, CapturedFrame } from '$lib/shared/ingestionCaptureCore';",
)
text = text.replace(
    "import { Camera, Mic, MicOff, Trash2, ImagePlus, FileText, Sparkles } from 'lucide-svelte';",
    "import { Trash2, ImagePlus, FileText, Sparkles } from 'lucide-svelte';",
)

start = text.index('\tlet mediaRecorder: MediaRecorder | null = null;')
end = text.index('\n\tfunction setPhotoDraft(', start)
replacement = """\tlet captureStudio: { finishSweep(): Promise<void> } | null = null;
\tlet speechRecognition: any = null;
\tlet routeActive = true;
\tlet isRecording = $state(false);
\tlet liveSupported = $state(false);
\tlet sweepIdentity: BulkMissionIdentity | null = null;
\tconst removingPhotoIds = new SvelteSet<string>();
\tconst retryingAudioIds = new SvelteSet<string>();
\tlet audioActionErrors = $state<Record<string, string>>({});
\tlet photoDrafts = $state<Record<string, { note: string; groupLabel: string; ignored: boolean }>>(
\t\t{}
\t);
\tlet photoActionErrors = $state<Record<string, string>>({});
\tlet photoRetryKinds = $state<Record<string, 'edit' | 'remove'>>({});
\tlet transcriptPersistenceError = $state('');
\tlet transcriptPreviewNotice = $state('');
\tlet filePickerError = $state('');
\tlet failedFilePickerFiles = $state<File[]>([]);
\tlet retryingFilePicker = $state(false);
\tlet discardingSweep = $state(false);
\tlet photoRetryPatches = $state<
\t\tRecord<string, Partial<{ note: string; groupLabel: string; ignored: boolean }>>
\t>({});

\tfunction isCurrentSweepIdentity(identity: BulkMissionIdentity | null): boolean {
\t\tif (!identity || !routeActive) return false;
\t\tconst current = workflow.getMissionIdentity();
\t\treturn current.missionId === identity.missionId && current.generation === identity.generation;
\t}

\tfunction stopSpeechPreview(): void {
\t\tif (!speechRecognition) return;
\t\ttry {
\t\t\tspeechRecognition.stop();
\t\t} catch {
\t\t\t// Recognition may already have ended.
\t\t}
\t\tspeechRecognition = null;
\t}

\tfunction startSpeechPreview(): void {
\t\tstopSpeechPreview();
\t\tconst SpeechRecognition =
\t\t\t(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
\t\tif (!SpeechRecognition || !sweepIdentity) return;
\t\ttry {
\t\t\tconst recognition = new SpeechRecognition();
\t\t\trecognition.continuous = true;
\t\t\trecognition.interimResults = true;
\t\t\trecognition.onresult = (event: any) => {
\t\t\t\tif (!isCurrentSweepIdentity(sweepIdentity)) return;
\t\t\t\tfor (let index = event.resultIndex; index < event.results.length; index += 1) {
\t\t\t\t\tconst result = event.results[index];
\t\t\t\t\tworkflow.updateBrowserTranscriptPreview(
\t\t\t\t\t\tresult[0]?.transcript ?? '',
\t\t\t\t\t\tBoolean(result.isFinal),
\t\t\t\t\t\tsweepIdentity
\t\t\t\t\t);
\t\t\t\t}
\t\t\t};
\t\t\trecognition.onerror = () => {
\t\t\t\tliveSupported = false;
\t\t\t\tif (speechRecognition === recognition) speechRecognition = null;
\t\t\t};
\t\t\trecognition.onend = () => {
\t\t\t\tif (isRecording && speechRecognition === recognition) {
\t\t\t\t\ttry {
\t\t\t\t\t\trecognition.start();
\t\t\t\t\t} catch {
\t\t\t\t\t\t// Browser may still be finalizing the previous recognition session.
\t\t\t\t\t}
\t\t\t\t}
\t\t\t};
\t\t\tspeechRecognition = recognition;
\t\t\trecognition.start();
\t\t} catch {
\t\t\tliveSupported = false;
\t\t\tspeechRecognition = null;
\t\t}
\t}

\tasync function addCapturedPhoto(frame: CapturedFrame): Promise<void> {
\t\tconst file = new File([frame.blob], `capture-${frame.captureSequence}-${frame.takenAtMs}.jpg`, {
\t\t\ttype: frame.mimeType || 'image/jpeg',
\t\t});
\t\tawait workflow.addPhotos([file], [
\t\t\t{
\t\t\t\tid: frame.id,
\t\t\t\ttakenAtMs: frame.takenAtMs,
\t\t\t\tsessionOffsetMs: frame.sessionOffsetMs,
\t\t\t\tcaptureSequence: frame.captureSequence,
\t\t\t},
\t\t]);
\t}

\tasync function handleStudioStart(detail: { microphoneAvailable: boolean }): Promise<void> {
\t\tsweepIdentity = workflow.getMissionIdentity();
\t\tisRecording = detail.microphoneAvailable;
\t\ttranscriptPreviewNotice = detail.microphoneAvailable
\t\t\t? 'Camera and narration are recording together. Browser text is preview-only; server transcription is canonical.'
\t\t\t: 'Microphone unavailable. Photos remain usable and typed notes are saved.';
\t\tif (detail.microphoneAvailable) startSpeechPreview();
\t}

\tasync function handleStudioAudio(audio: CaptureAudioResult): Promise<void> {
\t\tconst identity = sweepIdentity;
\t\tif (!isCurrentSweepIdentity(identity)) return;
\t\tconst missionStartedAt = workflow.state.startedAtMs;
\t\tif (missionStartedAt == null) throw new Error('Mission timing is unavailable');
\t\tconst startedAt = Math.max(0, audio.startedAtMs - missionStartedAt);
\t\tconst endedAt = Math.max(startedAt, audio.endedAtMs - missionStartedAt);
\t\tconst segmentId = await workflow.addAudioSegment(
\t\t\taudio.blob,
\t\t\taudio.mimeType,
\t\t\tstartedAt,
\t\t\tendedAt,
\t\t\tidentity
\t\t);
\t\tif (segmentId && isCurrentSweepIdentity(identity)) {
\t\t\tawait workflow.transcribeAudioSegment(segmentId);
\t\t}
\t}

\tasync function handleStudioStop(): Promise<void> {
\t\tstopSpeechPreview();
\t\tisRecording = false;
\t\tsweepIdentity = null;
\t}

\tasync function finishActiveSweep(): Promise<boolean> {
\t\tif (!captureStudio) return true;
\t\ttry {
\t\t\tawait captureStudio.finishSweep();
\t\t\treturn true;
\t\t} catch (error) {
\t\t\tshowToast(error instanceof Error ? error.message : 'Sweep could not finish safely.', 'error');
\t\t\treturn false;
\t\t}
\t}

\tonMount(async () => {
\t\tawait bulkMissionDb.cleanupStaleMissions();
\t\tif (!workflow.state.locationId) await workflow.recover();
\t\tif (!workflow.state.locationId) goto(resolve('/location'));
\t\tconst SpeechRecognition =
\t\t\t(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
\t\tliveSupported = Boolean(SpeechRecognition);
\t});

\tonDestroy(() => {
\t\trouteActive = false;
\t\tstopSpeechPreview();
\t\tworkflow.cancelActiveTranscriptions();
\t});
"""
text = text[:start] + replacement + text[end:]

text = text.replace(
    "\tasync function reviewTranscript(): Promise<void> {\n\t\tif (!(await flushTranscriptPersistence())) return;",
    "\tasync function reviewTranscript(): Promise<void> {\n\t\tif (!(await finishActiveSweep())) return;\n\t\tif (!(await flushTranscriptPersistence())) return;",
)
text = text.replace(
    "\tasync function analyze() {\n\t\tif (!(await flushTranscriptPersistence())) return;",
    "\tasync function analyze() {\n\t\tif (!(await finishActiveSweep())) return;\n\t\tif (!(await flushTranscriptPersistence())) return;",
)
text = text.replace(
    "\tasync function discardSweep(): Promise<void> {\n\t\tif (discardingSweep) return;",
    "\tasync function discardSweep(): Promise<void> {\n\t\tif (discardingSweep) return;\n\t\tif (!(await finishActiveSweep())) return;",
)

old_markup_start = text.index('\t<BulkCameraCapture')
old_markup_end = text.index('\n\t{#if workflow.state.photos.length > 0}', old_markup_start)
new_markup = """\t<BulkContinuousCapture
\t\tbind:this={captureStudio}
\t\toncapture={addCapturedPhoto}
\t\tonaudio={handleStudioAudio}
\t\tonstart={handleStudioStart}
\t\tonstop={handleStudioStop}
\t/>

\t<div class="mb-4">
\t\t<Button variant="secondary" full onclick={() => fileInput.click()}>
\t\t\t<ImagePlus size={18} strokeWidth={1.5} />
\t\t\t<span>Import existing photos</span>
\t\t</Button>
\t</div>
"""
text = text[:old_markup_start] + new_markup + text[old_markup_end:]
text = text.replace('\n\t\tcapture="environment"', '')
PAGE.write_text(text)
