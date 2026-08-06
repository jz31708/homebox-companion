/**
 * Framework-agnostic browser capture and multimodal timeline core.
 *
 * Canonical source: jz31708/homebox-ingestion/shared/browser/ingestionCaptureCore.ts
 * Vendored so Homebox Companion has no runtime dependency on another homelab service.
 */

export const INGESTION_CAPTURE_CORE_VERSION = '1.0.0';

export type CaptureSource = 'image-capture' | 'canvas';
export type ContextRole = 'primary' | 'previous_context' | 'next_context';

export interface CapturedFrame {
  id: string;
  captureSequence: number;
  takenAtMs: number;
  sessionOffsetMs: number;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  source: CaptureSource;
}

export interface CaptureAudioResult {
  blob: Blob;
  mimeType: string;
  startedAtMs: number;
  endedAtMs: number;
  sessionStartOffsetMs: number;
  sessionEndOffsetMs: number;
}

export interface CaptureSessionSnapshot {
  active: boolean;
  starting: boolean;
  microphoneAvailable: boolean;
  microphoneMuted: boolean;
  torchEnabled: boolean;
  elapsedMs: number;
  capturedCount: number;
  error: string | null;
}

export interface CaptureSessionOptions {
  idFactory?: () => string;
  now?: () => number;
  targetLongEdge?: number;
  jpegQuality?: number;
  videoConstraints?: MediaTrackConstraints;
  onSnapshot?: (snapshot: CaptureSessionSnapshot) => void;
}

export interface CaptureStartResult {
  stream: MediaStream;
  microphoneAvailable: boolean;
}

export interface DurableQueueSnapshot {
  pending: number;
  completed: number;
  failed: number;
  saturated: boolean;
  lastError: Error | null;
}

export interface DurableQueueOptions<T, R> {
  persist: (value: T) => Promise<R>;
  maxPending?: number;
  onSnapshot?: (snapshot: DurableQueueSnapshot) => void;
}

export interface TimelinePhoto {
  id: string;
  index: number;
  captureSequence: number;
  takenAtMs: number | null;
  sessionOffsetMs: number;
  note?: string | null;
  groupLabel?: string | null;
  ignored?: boolean;
}

export interface TimelineSpan {
  id: string;
  text: string;
  startMs: number | null;
  endMs: number | null;
  sourceAudioSegmentId?: string | null;
}

export interface PlannedPhoto extends TimelinePhoto {
  contextRole: ContextRole;
  localTranscriptSpanIds: string[];
}

export interface PlannedTimelineChunk {
  id: string;
  primaryPhotoIds: string[];
  photoIds: string[];
  transcriptSpanIds: string[];
  photos: PlannedPhoto[];
  timeline: string;
  requestHash: string;
}

const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 2560 },
  height: { ideal: 1440 },
};

const RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
];

function defaultIdFactory(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(fallback);
}

function chooseRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return RECORDER_MIME_TYPES.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? '';
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size === 0) reject(new Error('Camera returned an empty photo'));
        else resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

async function normalizePhotoBlob(
  input: Blob,
  targetLongEdge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  if (typeof createImageBitmap !== 'function') {
    return { blob: input, width: 0, height: 0 };
  }
  const bitmap = await createImageBitmap(input);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= targetLongEdge && input.type === 'image/jpeg') {
      return { blob: input, width: bitmap.width, height: bitmap.height };
    }
    const scale = Math.min(1, targetLongEdge / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas capture is unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    return { blob: await canvasToBlob(canvas, quality), width, height };
  } finally {
    bitmap.close();
  }
}

export class ContinuousCaptureSession {
  private readonly video: HTMLVideoElement;
  private readonly options: Required<
    Pick<CaptureSessionOptions, 'idFactory' | 'now' | 'targetLongEdge' | 'jpegQuality'>
  > &
    Pick<CaptureSessionOptions, 'videoConstraints' | 'onSnapshot'>;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private recorderChunks: Blob[] = [];
  private recorderStartedAtMs: number | null = null;
  private sessionStartedAtMs: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private captureSequence = 0;
  private microphoneAvailable = false;
  private microphoneMuted = false;
  private torchEnabled = false;
  private starting = false;
  private active = false;
  private error: string | null = null;

  constructor(video: HTMLVideoElement, options: CaptureSessionOptions = {}) {
    this.video = video;
    this.options = {
      idFactory: options.idFactory ?? defaultIdFactory,
      now: options.now ?? (() => Date.now()),
      targetLongEdge: options.targetLongEdge ?? 3072,
      jpegQuality: options.jpegQuality ?? 0.9,
      videoConstraints: options.videoConstraints,
      onSnapshot: options.onSnapshot,
    };
  }

  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  get snapshot(): CaptureSessionSnapshot {
    const now = this.options.now();
    return {
      active: this.active,
      starting: this.starting,
      microphoneAvailable: this.microphoneAvailable,
      microphoneMuted: this.microphoneMuted,
      torchEnabled: this.torchEnabled,
      elapsedMs: this.sessionStartedAtMs == null ? 0 : Math.max(0, now - this.sessionStartedAtMs),
      capturedCount: this.captureSequence,
      error: this.error,
    };
  }

  private emit(): void {
    this.options.onSnapshot?.(this.snapshot);
  }

  private stopTracks(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Track cleanup is best-effort.
      }
    });
  }

  private async attachPreview(stream: MediaStream): Promise<void> {
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    if (this.video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve, reject) => {
        const onLoaded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('Camera metadata unavailable'));
        };
        const cleanup = () => {
          this.video.removeEventListener('loadedmetadata', onLoaded);
          this.video.removeEventListener('error', onError);
        };
        this.video.addEventListener('loadedmetadata', onLoaded, { once: true });
        this.video.addEventListener('error', onError, { once: true });
      });
    }
    await this.video.play();
  }

  private startRecorder(stream: MediaStream): void {
    const audioTracks = stream.getAudioTracks();
    this.microphoneAvailable = audioTracks.length > 0;
    if (!this.microphoneAvailable || typeof MediaRecorder === 'undefined') return;
    const audioOnly = new MediaStream(audioTracks);
    const mimeType = chooseRecorderMimeType();
    const recorder = new MediaRecorder(audioOnly, mimeType ? { mimeType } : undefined);
    this.recorderChunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.recorderChunks.push(event.data);
    };
    recorder.start(1000);
    this.recorder = recorder;
    this.recorderStartedAtMs = this.options.now();
  }

  async start(): Promise<CaptureStartResult> {
    if (this.active && this.stream) {
      return { stream: this.stream, microphoneAvailable: this.microphoneAvailable };
    }
    this.starting = true;
    this.error = null;
    this.emit();
    await this.stop();
    this.starting = true;
    this.emit();
    const video = this.options.videoConstraints ?? DEFAULT_VIDEO_CONSTRAINTS;
    let stream: MediaStream | null = null;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
      } catch (combinedError) {
        const candidate = combinedError as DOMException;
        if (candidate?.name !== 'NotAllowedError' && candidate?.name !== 'NotFoundError') {
          throw combinedError;
        }
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      }
      this.stream = stream;
      await this.attachPreview(stream);
      this.sessionStartedAtMs = this.options.now();
      this.captureSequence = 0;
      this.microphoneMuted = false;
      this.torchEnabled = false;
      this.startRecorder(stream);
      this.active = true;
      this.starting = false;
      this.timer = setInterval(() => this.emit(), 250);
      this.emit();
      return { stream, microphoneAvailable: this.microphoneAvailable };
    } catch (error) {
      this.stopTracks(stream);
      this.stream = null;
      this.video.srcObject = null;
      this.starting = false;
      this.active = false;
      this.error = normalizeError(error, 'Camera unavailable').message;
      this.emit();
      throw error;
    }
  }

  async capture(): Promise<CapturedFrame> {
    if (!this.active || !this.stream || this.video.videoWidth <= 0 || this.video.videoHeight <= 0) {
      throw new Error('Camera preview is not ready');
    }
    const takenAtMs = this.options.now();
    const sessionOffsetMs = Math.max(0, takenAtMs - (this.sessionStartedAtMs ?? takenAtMs));
    const track = this.stream.getVideoTracks()[0];
    let output: { blob: Blob; width: number; height: number };
    let source: CaptureSource = 'canvas';
    const ImageCaptureCtor = (globalThis as unknown as {
      ImageCapture?: new (track: MediaStreamTrack) => { takePhoto(): Promise<Blob> };
    }).ImageCapture;
    if (track && ImageCaptureCtor) {
      try {
        const raw = await new ImageCaptureCtor(track).takePhoto();
        output = await normalizePhotoBlob(raw, this.options.targetLongEdge, this.options.jpegQuality);
        source = 'image-capture';
      } catch {
        output = await this.captureFromCanvas();
      }
    } else {
      output = await this.captureFromCanvas();
    }
    if (output.blob.size === 0) throw new Error('Camera returned an empty photo');
    const captureSequence = this.captureSequence;
    this.captureSequence += 1;
    this.emit();
    try {
      navigator.vibrate?.(35);
    } catch {
      // Vibration feedback is optional.
    }
    return {
      id: this.options.idFactory(),
      captureSequence,
      takenAtMs,
      sessionOffsetMs,
      blob: output.blob,
      mimeType: output.blob.type || 'image/jpeg',
      width: output.width,
      height: output.height,
      source,
    };
  }

  private async captureFromCanvas(): Promise<{ blob: Blob; width: number; height: number }> {
    const longest = Math.max(this.video.videoWidth, this.video.videoHeight);
    const scale = Math.min(1, this.options.targetLongEdge / longest);
    const width = Math.max(1, Math.round(this.video.videoWidth * scale));
    const height = Math.max(1, Math.round(this.video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas capture is unavailable');
    context.drawImage(this.video, 0, 0, width, height);
    return { blob: await canvasToBlob(canvas, this.options.jpegQuality), width, height };
  }

  setMicrophoneMuted(muted: boolean): void {
    this.microphoneMuted = muted;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.emit();
  }

  async setTorch(enabled: boolean): Promise<boolean> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: enabled }] } as unknown as MediaTrackConstraints);
      this.torchEnabled = enabled;
      this.emit();
      return true;
    } catch {
      this.torchEnabled = false;
      this.emit();
      return false;
    }
  }

  async stop(): Promise<CaptureAudioResult | null> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const recorder = this.recorder;
    const recorderStartedAtMs = this.recorderStartedAtMs;
    let audio: CaptureAudioResult | null = null;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        const previous = recorder.onstop;
        recorder.onstop = (event) => {
          previous?.call(recorder, event);
          resolve();
        };
        recorder.stop();
      });
    }
    const endedAtMs = this.options.now();
    if (recorderStartedAtMs != null && this.recorderChunks.length > 0) {
      const mimeType = recorder?.mimeType || this.recorderChunks[0]?.type || 'audio/webm';
      const blob = new Blob(this.recorderChunks, { type: mimeType });
      if (blob.size > 0) {
        const sessionStart = this.sessionStartedAtMs ?? recorderStartedAtMs;
        audio = {
          blob,
          mimeType,
          startedAtMs: recorderStartedAtMs,
          endedAtMs,
          sessionStartOffsetMs: Math.max(0, recorderStartedAtMs - sessionStart),
          sessionEndOffsetMs: Math.max(0, endedAtMs - sessionStart),
        };
      }
    }
    this.recorder = null;
    this.recorderChunks = [];
    this.recorderStartedAtMs = null;
    this.stopTracks(this.stream);
    this.stream = null;
    this.video.srcObject = null;
    this.active = false;
    this.starting = false;
    this.microphoneAvailable = false;
    this.microphoneMuted = false;
    this.torchEnabled = false;
    this.emit();
    return audio;
  }
}

export class DurableCaptureQueue<T, R> {
  private readonly persist: (value: T) => Promise<R>;
  private readonly maxPending: number;
  private readonly onSnapshot?: (snapshot: DurableQueueSnapshot) => void;
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private completed = 0;
  private failed = 0;
  private lastError: Error | null = null;

  constructor(options: DurableQueueOptions<T, R>) {
    this.persist = options.persist;
    this.maxPending = Math.max(1, options.maxPending ?? 16);
    this.onSnapshot = options.onSnapshot;
  }

  get snapshot(): DurableQueueSnapshot {
    return {
      pending: this.pending,
      completed: this.completed,
      failed: this.failed,
      saturated: this.pending >= this.maxPending,
      lastError: this.lastError,
    };
  }

  private emit(): void {
    this.onSnapshot?.(this.snapshot);
  }

  enqueue(value: T): Promise<R> {
    if (this.pending >= this.maxPending) {
      const error = new Error('Capture queue is full; wait for photos to finish saving');
      this.lastError = error;
      this.emit();
      return Promise.reject(error);
    }
    this.pending += 1;
    this.emit();
    let resolveResult!: (result: R) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<R>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const run = async () => {
      try {
        const persisted = await this.persist(value);
        this.completed += 1;
        this.lastError = null;
        resolveResult(persisted);
      } catch (error) {
        const normalized = normalizeError(error, 'Capture could not be saved');
        this.failed += 1;
        this.lastError = normalized;
        rejectResult(normalized);
      } finally {
        this.pending = Math.max(0, this.pending - 1);
        this.emit();
      }
    };
    this.tail = this.tail.then(run, run).then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.lastError) throw this.lastError;
  }
}

function overlaps(span: TimelineSpan, start: number, end: number): boolean {
  if (span.startMs == null && span.endMs == null) return true;
  const spanStart = span.startMs ?? span.endMs ?? 0;
  const spanEnd = span.endMs ?? span.startMs ?? spanStart;
  return spanEnd >= start && spanStart <= end;
}

export function selectLocalTranscriptSpanIds(
  photoOffsetMs: number,
  spans: TimelineSpan[],
  windowBeforeMs = 12_000,
  windowAfterMs = 12_000,
): string[] {
  const ordered = [...spans].sort(
    (a, b) => (a.startMs ?? Number.MAX_SAFE_INTEGER) - (b.startMs ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
  );
  const selected = new Set(
    ordered
      .filter((span) => overlaps(span, photoOffsetMs - windowBeforeMs, photoOffsetMs + windowAfterMs))
      .map((span) => span.id),
  );
  const preceding = [...ordered]
    .filter((span) => (span.endMs ?? span.startMs ?? Number.NEGATIVE_INFINITY) <= photoOffsetMs)
    .at(-1);
  const following = ordered.find((span) => (span.startMs ?? span.endMs ?? Number.POSITIVE_INFINITY) >= photoOffsetMs);
  if (preceding) selected.add(preceding.id);
  if (following) selected.add(following.id);
  return ordered.filter((span) => selected.has(span.id)).map((span) => span.id);
}

function formatOffset(offsetMs: number): string {
  const safe = Math.max(0, Math.round(offsetMs));
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function buildTimelineDocument(photos: PlannedPhoto[], spans: TimelineSpan[]): string {
  const allowedSpans = new Set(photos.flatMap((photo) => photo.localTranscriptSpanIds));
  const events: Array<{ offsetMs: number; order: number; line: string }> = [];
  for (const photo of photos) {
    const context = [
      `role=${photo.contextRole}`,
      `capture=P${String(photo.captureSequence).padStart(3, '0')}`,
      photo.groupLabel ? `group=${JSON.stringify(photo.groupLabel)}` : '',
      photo.note ? `note=${JSON.stringify(photo.note)}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    events.push({
      offsetMs: photo.sessionOffsetMs,
      order: 1,
      line: `[${formatOffset(photo.sessionOffsetMs)}] PHOTO ${photo.id} ${context}`,
    });
  }
  for (const span of spans) {
    if (!allowedSpans.has(span.id)) continue;
    const offsetMs = span.startMs ?? span.endMs ?? 0;
    events.push({
      offsetMs,
      order: 0,
      line: `[${formatOffset(offsetMs)}] SPEECH ${span.id}: ${span.text.trim()}`,
    });
  }
  return events
    .sort((a, b) => a.offsetMs - b.offsetMs || a.order - b.order || a.line.localeCompare(b.line))
    .map((event) => event.line)
    .join('\n');
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function planTimelineChunks(
  missionId: string,
  photos: TimelinePhoto[],
  spans: TimelineSpan[],
  primaryChunkSize = 6,
): PlannedTimelineChunk[] {
  if (primaryChunkSize < 1 || primaryChunkSize > 6) {
    throw new Error('Primary timeline chunk size must be between 1 and 6');
  }
  const active = photos
    .filter((photo) => !photo.ignored)
    .sort((a, b) => a.captureSequence - b.captureSequence || a.index - b.index || a.id.localeCompare(b.id));
  const chunks: PlannedTimelineChunk[] = [];
  for (let offset = 0; offset < active.length; offset += primaryChunkSize) {
    const primary = active.slice(offset, offset + primaryChunkSize);
    const previous = offset > 0 ? active[offset - 1] : null;
    const following = offset + primaryChunkSize < active.length ? active[offset + primaryChunkSize] : null;
    const selected: PlannedPhoto[] = [
      ...(previous ? [{ ...previous, contextRole: 'previous_context' as const }] : []),
      ...primary.map((photo) => ({ ...photo, contextRole: 'primary' as const })),
      ...(following ? [{ ...following, contextRole: 'next_context' as const }] : []),
    ].map((photo) => ({
      ...photo,
      localTranscriptSpanIds: selectLocalTranscriptSpanIds(photo.sessionOffsetMs, spans),
    }));
    const transcriptSpanIds = [...new Set(selected.flatMap((photo) => photo.localTranscriptSpanIds))];
    const photoIds = selected.map((photo) => photo.id);
    const primaryPhotoIds = primary.map((photo) => photo.id);
    const timeline = buildTimelineDocument(selected, spans);
    const canonical = JSON.stringify({ missionId, primaryPhotoIds, photoIds, transcriptSpanIds, timeline });
    chunks.push({
      id: `${missionId}:chunk:${Math.floor(offset / primaryChunkSize)}`,
      primaryPhotoIds,
      photoIds,
      transcriptSpanIds,
      photos: selected,
      timeline,
      requestHash: stableHash(canonical),
    });
  }
  return chunks;
}
