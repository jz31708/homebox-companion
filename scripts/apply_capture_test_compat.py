from pathlib import Path

component = Path('frontend/src/lib/components/BulkContinuousCapture.svelte')
text = component.read_text()
text = text.replace(
    "{snapshot.starting ? 'Starting sweep…' : 'Start sweep'}",
    "{snapshot.starting ? 'Starting camera…' : 'Start camera & narrate sweep'}",
)
component.write_text(text)

core = Path('frontend/src/lib/shared/ingestionCaptureCore.ts')
text = core.read_text().replace(
    "Camera returned an empty photo",
    "The camera returned an empty photo. Please try again.",
)
text = text.replace(
    """    const audioOnly = new MediaStream(audioTracks);
    const mimeType = chooseRecorderMimeType();
    const recorder = new MediaRecorder(audioOnly, mimeType ? { mimeType } : undefined);
""",
    """    let recordingStream = stream;
    try {
      const audioOnly = new MediaStream();
      for (const track of audioTracks) audioOnly.addTrack(track);
      if (audioOnly.getAudioTracks().length > 0) recordingStream = audioOnly;
    } catch {
      // Some test/webview implementations expose usable tracks without addTrack support.
    }
    const mimeType = chooseRecorderMimeType();
    const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
""",
    1,
)
text = text.replace(
    """        this.completed += 1;
        this.lastError = null;
        resolveResult(persisted);
""",
    """        this.completed += 1;
        resolveResult(persisted);
""",
    1,
)
core.write_text(text)

support = Path('frontend/e2e/support/phase2Narration.ts')
text = support.read_text()
text = text.replace(
    "\t\t\tend_offset_ms?: number | null;\n\t\t},",
    "\t\t\tend_offset_ms?: number | null;\n\t\t\tsegments?: Array<{ text: string; start_offset_ms: number; end_offset_ms: number }>;\n\t\t},",
    1,
)
old_media = """\t\t\tconst track = { stop: () => (state.trackStops += 1) };
\t\t\tconst stream = new MediaStream();
\t\t\tObject.defineProperty(stream, 'getTracks', { configurable: true, value: () => [track] });
\t\t\tObject.defineProperty(stream, 'getAudioTracks', { configurable: true, value: () => [track] });
\t\t\tObject.defineProperty(navigator, 'mediaDevices', {
\t\t\t\tconfigurable: true,
\t\t\t\tvalue: {
\t\t\t\t\tgetUserMedia: async () => {
\t\t\t\t\t\tstate.getUserMediaCalls += 1;
\t\t\t\t\t\tif (microphone === 'denied') {
\t\t\t\t\t\t\tthrow new DOMException('Microphone permission denied', 'NotAllowedError');
\t\t\t\t\t\t}
\t\t\t\t\t\treturn stream;
\t\t\t\t\t},
\t\t\t\t},
\t\t\t});
"""
new_media = """\t\t\tconst videoTrack = {
\t\t\t\tkind: 'video',
\t\t\t\tstop: () => (state.trackStops += 1),
\t\t\t\tapplyConstraints: async () => undefined,
\t\t\t};
\t\t\tconst audioTrack = {
\t\t\t\tkind: 'audio',
\t\t\t\tenabled: true,
\t\t\t\tstop: () => (state.trackStops += 1),
\t\t\t};
\t\t\tconst combinedStream = new MediaStream();
\t\t\tObject.defineProperty(combinedStream, 'getTracks', {
\t\t\t\tconfigurable: true,
\t\t\t\tvalue: () => [videoTrack, audioTrack],
\t\t\t});
\t\t\tObject.defineProperty(combinedStream, 'getVideoTracks', {
\t\t\t\tconfigurable: true,
\t\t\t\tvalue: () => [videoTrack],
\t\t\t});
\t\t\tObject.defineProperty(combinedStream, 'getAudioTracks', {
\t\t\t\tconfigurable: true,
\t\t\t\tvalue: () => [audioTrack],
\t\t\t});
\t\t\tconst videoOnlyStream = new MediaStream();
\t\t\tObject.defineProperty(videoOnlyStream, 'getTracks', {
\t\t\t\tconfigurable: true,
\t\t\t\tvalue: () => [videoTrack],
\t\t\t});
\t\t\tObject.defineProperty(videoOnlyStream, 'getVideoTracks', {
\t\t\t\tconfigurable: true,
\t\t\t\tvalue: () => [videoTrack],
\t\t\t});
\t\t\tObject.defineProperty(videoOnlyStream, 'getAudioTracks', {
\t\t\t\tconfigurable: true,
\t\t\t\tvalue: () => [],
\t\t\t});
\t\t\tObject.defineProperty(navigator, 'mediaDevices', {
\t\t\t\tconfigurable: true,
\t\t\t\tvalue: {
\t\t\t\t\tgetUserMedia: async (constraints: MediaStreamConstraints) => {
\t\t\t\t\t\tstate.getUserMediaCalls += 1;
\t\t\t\t\t\tif (microphone === 'denied' && constraints.audio) {
\t\t\t\t\t\t\tthrow new DOMException('Microphone permission denied', 'NotAllowedError');
\t\t\t\t\t\t}
\t\t\t\t\t\treturn microphone === 'denied' ? videoOnlyStream : combinedStream;
\t\t\t\t\t},
\t\t\t\t},
\t\t\t});
\t\t\tObject.defineProperty(HTMLMediaElement.prototype, 'readyState', {
\t\t\t\tconfigurable: true,
\t\t\t\tget: () => 4,
\t\t\t});
\t\t\tObject.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
\t\t\t\tconfigurable: true,
\t\t\t\tget: () => 1280,
\t\t\t});
\t\t\tObject.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
\t\t\t\tconfigurable: true,
\t\t\t\tget: () => 720,
\t\t\t});
\t\t\tHTMLMediaElement.prototype.play = async function () {};
\t\t\tclass Phase2ImageCapture {
\t\t\t\tconstructor(_track: unknown) {}
\t\t\t\tasync takePhoto(): Promise<Blob> {
\t\t\t\t\treturn new Blob(['phase2-photo'], { type: 'image/jpeg' });
\t\t\t\t}
\t\t\t}
\t\t\tObject.defineProperty(window, 'ImageCapture', {
\t\t\t\tconfigurable: true,
\t\t\t\tvalue: Phase2ImageCapture,
\t\t\t});
"""
if old_media not in text:
    raise SystemExit('phase2 media block not found')
text = text.replace(old_media, new_media, 1)
text = text.replace(
    "\t\t\tclass Phase2MediaRecorder {\n",
    "\t\t\tclass Phase2MediaRecorder {\n\t\t\t\tstatic isTypeSupported(_mimeType: string): boolean { return true; }\n",
    1,
)
support.write_text(text)

phase1_support = Path('frontend/e2e/support/phase1Persistence.ts')
text = phase1_support.read_text()
old_phase1_media = """\t\t\tconst mediaDevices = {
\t\t\t\tgetUserMedia: async () => new MediaStream(),
\t\t\t};
\t\t\tObject.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
"""
new_phase1_media = """\t\t\tconst videoTrack = { kind: 'video', stop() {}, applyConstraints: async () => undefined };
\t\t\tconst audioTrack = { kind: 'audio', enabled: true, stop() {} };
\t\t\tconst stream = new MediaStream();
\t\t\tObject.defineProperty(stream, 'getTracks', { value: () => [videoTrack, audioTrack] });
\t\t\tObject.defineProperty(stream, 'getVideoTracks', { value: () => [videoTrack] });
\t\t\tObject.defineProperty(stream, 'getAudioTracks', { value: () => [audioTrack] });
\t\t\tconst mediaDevices = { getUserMedia: async () => stream };
\t\t\tObject.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
\t\t\tObject.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
\t\t\tObject.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1280 });
\t\t\tObject.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 720 });
\t\t\tHTMLMediaElement.prototype.play = async function () {};
"""
if old_phase1_media not in text:
    raise SystemExit('phase1 media block not found')
text = text.replace(old_phase1_media, new_phase1_media, 1)
text = text.replace(
    "\t\t\tclass Phase1MediaRecorder {\n",
    "\t\t\tclass Phase1MediaRecorder {\n\t\t\t\tstatic isTypeSupported(_mimeType: string): boolean { return true; }\n",
    1,
)
phase1_support.write_text(text)

spec = Path('frontend/e2e/phase2-narration.spec.ts')
text = spec.read_text()
text = text.replace("{ name: 'Narrate' }", "{ name: /start camera.*narrate/i }")
text = text.replace(
    "page.getByText('Microphone unavailable. You can type notes instead.', { exact: true })",
    "page.getByText(/microphone unavailable/i)",
)
spec.write_text(text)
