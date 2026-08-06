import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { items, vision } from '$lib/api';
import * as bulkMissionDb from '$lib/services/bulkMissionDb';
import { planBulkObservationChunks } from '$lib/services/bulkAnalysisPlanner';
import type {
	BulkMissionRecord,
	BulkOutboxOperationRecord,
	BulkPhotoRecord,
	BulkStructuredError,
} from '$lib/types/bulkDomain';
import {
	cloneOutboxRecord,
	deepDeproxy,
	fromAudioRecord,
	fromCandidateRecord,
	fromTranscriptSpanRecord,
	toAudioRecord,
	toCandidateRecord,
	toTranscriptSpanRecord,
} from '$lib/services/bulkRecordMappers';
import { workflowLogger as log } from '$lib/utils/logger';
import type {
	BulkAudioSegment,
	BulkCandidateItem,
	BulkCapturedPhoto,
	BulkDetectResponse,
	BulkSweepState,
	BulkSweepStatus,
	BulkTranscriptSource,
	BulkTranscriptSpan,
	Progress,
} from '$lib/types';

function createId(prefix: string): string {
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeRevoke(url: string): void {
	if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

function resolveServerSpanOffsets(
	segment: BulkAudioSegment,
	response: { start_offset_ms?: number | null; end_offset_ms?: number | null }
): { startOffsetMs: number; endOffsetMs: number } {
	const start = segment.startedAtMs;
	const end = segment.endedAtMs;
	const duration = Math.max(0, end - start);
	const providerStart = response.start_offset_ms;
	const providerEnd = response.end_offset_ms;
	if (
		typeof providerStart !== 'number' ||
		!Number.isFinite(providerStart) ||
		typeof providerEnd !== 'number' ||
		!Number.isFinite(providerEnd) ||
		providerStart < 0 ||
		providerEnd < providerStart
	)
		return { startOffsetMs: start, endOffsetMs: end };
	const boundedStart = Math.min(duration, providerStart);
	const boundedEnd = Math.min(duration, providerEnd);
	if (boundedEnd < boundedStart) return { startOffsetMs: start, endOffsetMs: end };
	return { startOffsetMs: start + boundedStart, endOffsetMs: start + boundedEnd };
}

interface DurableWriteContext {
	missionId: string;
	generation: number;
}

export interface BulkMissionIdentity {
	missionId: string;
	generation: number;
}

class BulkSweepWorkflow {
	getMissionIdentity(): BulkMissionIdentity {
		return { missionId: this.missionId, generation: this.writeGeneration };
	}

	private isCurrentMissionIdentity(identity: BulkMissionIdentity): boolean {
		return identity.missionId === this.missionId && identity.generation === this.writeGeneration;
	}

	private transcriptionError(error: unknown): BulkStructuredError {
		const value = error as { name?: string; status?: number; statusCode?: number };
		if (value?.name === 'AbortError')
			return {
				code: 'TRANSCRIPTION_CANCELLED',
				message: 'Transcription was cancelled. Retry this recording.',
				retryable: true,
			};
		const status = value?.status ?? value?.statusCode;
		if (status === 401 || status === 403)
			return {
				code: 'TRANSCRIPTION_AUTH_FAILED',
				message: 'Authentication failed. Sign in again before retrying.',
				retryable: true,
			};
		if (status === 413)
			return {
				code: 'TRANSCRIPTION_AUDIO_TOO_LARGE',
				message: 'This recording is too large to transcribe.',
				retryable: false,
			};
		if (status === 415)
			return {
				code: 'TRANSCRIPTION_AUDIO_UNSUPPORTED',
				message: 'This recording format is not supported.',
				retryable: false,
			};
		return {
			code: 'TRANSCRIPTION_FAILED',
			message: 'Server transcription failed. Retry this recording.',
			retryable: true,
		};
	}
	private missionId = createId('mission_bulk');
	private _status = $state<BulkSweepStatus>('idle');
	private _locationId = $state<string | null>(null);
	private _locationName = $state<string | null>(null);
	private _locationPath = $state<string | null>(null);
	private _areaLabel = $state<string | null>(null);
	private _parentItemId = $state<string | null>(null);
	private _parentItemName = $state<string | null>(null);
	private _startedAtMs = $state<number | null>(null);
	private _createdAtMs = $state<number | null>(null);
	private _nextCaptureSequence = $state(0);
	private _photos = $state<BulkCapturedPhoto[]>([]);
	private _audioSegments = $state<BulkAudioSegment[]>([]);
	private _transcriptSpans = $state<BulkTranscriptSpan[]>([]);
	private _rawTranscriptText = $state('');
	private _canonicalTranscriptText = $state('');
	private _interimTranscriptText = $state('');
	private _editedTranscriptText = $state('');
	private _transcriptEdited = $state(false);
	private _transcriptSource = $state<BulkTranscriptSource>('none');
	private _candidates = $state<BulkCandidateItem[]>([]);
	private _outboxOperations = $state<BulkOutboxOperationRecord[]>([]);
	private _analysisProgress = $state<Progress | null>(null);
	private _submissionProgress = $state<Progress | null>(null);
	private _error = $state<string | null>(null);
	private _warnings = $state<string[]>([]);
	private _stats = $state<BulkSweepState['stats']>(null);
	private abortController: AbortController | null = null;
	private durableWriteQueue: Promise<void> = Promise.resolve();
	private durableWriteFailure: unknown = null;
	private writeGeneration = 0;
	private initialMissionPersistence: Promise<void> | null = null;
	private transcriptionPromises = new Map<string, Promise<void>>();
	private transcriptionControllers = new Map<string, AbortController>();
	private removingPhotoIds = new Set<string>();

	private _stateProxy: BulkSweepState | null = null;

	get state(): BulkSweepState {
		if (!this._stateProxy) {
			// eslint-disable-next-line @typescript-eslint/no-this-alias -- Required for live getters in Proxy handlers
			const workflow = this;
			this._stateProxy = new Proxy({} as BulkSweepState, {
				get(_target, prop: string | symbol) {
					if (typeof prop === 'symbol') return undefined;
					switch (prop as keyof BulkSweepState) {
						case 'status':
							return workflow._status;
						case 'locationId':
							return workflow._locationId;
						case 'locationName':
							return workflow._locationName;
						case 'locationPath':
							return workflow._locationPath;
						case 'areaLabel':
							return workflow._areaLabel;
						case 'parentItemId':
							return workflow._parentItemId;
						case 'parentItemName':
							return workflow._parentItemName;
						case 'startedAtMs':
							return workflow._startedAtMs;
						case 'photos':
							return workflow._photos;
						case 'audioSegments':
							return workflow._audioSegments;
						case 'transcriptSpans':
							return workflow._transcriptSpans;
						case 'rawTranscriptText':
							return workflow._rawTranscriptText;
						case 'canonicalTranscriptText':
							return workflow._canonicalTranscriptText;
						case 'interimTranscriptText':
							return workflow._interimTranscriptText;
						case 'editedTranscriptText':
							return workflow._editedTranscriptText;
						case 'transcriptEdited':
							return workflow._transcriptEdited;
						case 'transcriptSource':
							return workflow._transcriptSource;
						case 'candidates':
							return workflow._candidates;
						case 'outboxOperations':
							return workflow._outboxOperations;
						case 'analysisProgress':
							return workflow._analysisProgress;
						case 'submissionProgress':
							return workflow._submissionProgress;
						case 'error':
							return workflow._error;
						case 'warnings':
							return workflow._warnings;
						case 'stats':
							return workflow._stats;
						default:
							throw new TypeError(`Unknown Bulk Sweep state property: ${String(prop)}`);
					}
				},
			});
		}
		return this._stateProxy;
	}

	start(locationId: string, locationName: string, locationPath: string): void {
		this.reset();
		this.missionId = createId('mission_bulk');
		this._status = 'capturing';
		this._locationId = locationId;
		this._locationName = locationName;
		this._locationPath = locationPath;
		this._startedAtMs = Date.now();
		this._createdAtMs = this._startedAtMs;
		this._nextCaptureSequence = 0;
		this._areaLabel = null;
		this.initialMissionPersistence = this.observeDurableWrite(
			this.persistMission(),
			'Mission could not be saved. Retry before capturing.'
		);
	}

	transcribeAudioSegment(segmentId: string): Promise<void> {
		const existing = this.transcriptionPromises.get(segmentId);
		if (existing) return existing;
		const promise = this.runAudioTranscription(segmentId).finally(() => {
			if (this.transcriptionPromises.get(segmentId) === promise)
				this.transcriptionPromises.delete(segmentId);
			this.transcriptionControllers.delete(segmentId);
		});
		this.transcriptionPromises.set(segmentId, promise);
		return promise;
	}

	private async runAudioTranscription(segmentId: string): Promise<void> {
		const segment = this._audioSegments.find((entry) => entry.id === segmentId);
		if (!segment) return;
		const context = this.captureWriteContext();
		const attemptId = `${segmentId}:${createId('attempt')}`;
		let retryCount = segment.retryCount ?? 0;
		try {
			const attempt = await bulkMissionDb.beginAudioTranscriptionAttempt(
				context.missionId,
				segmentId,
				attemptId,
				Date.now()
			);
			if (!attempt.acquired) return;
			retryCount = attempt.record.retryCount;
			this._audioSegments = this._audioSegments.map((entry) =>
				entry.id === segmentId
					? {
							...entry,
							status: attempt.record.status,
							transcriptStatus: 'transcribing',
							retryCount,
							activeAttemptId: attemptId,
							activeAttemptStartedAtMs: Date.now(),
						}
					: entry
			);
			const controller = new AbortController();
			this.transcriptionControllers.set(segmentId, controller);
			const result = await vision.transcribeAudio(attempt.record.blob, `${segmentId}.webm`, {
				signal: controller.signal,
			});
			const text = result.text.trim();
			if (!text) throw new Error('Server returned an empty transcript');
			if (!this.isCurrentWriteContext(context)) return;
			const committed = await bulkMissionDb.commitAudioTranscriptionSuccess({
				missionId: context.missionId,
				segmentId,
				attemptId,
				text,
				...resolveServerSpanOffsets(segment, result),
			});
			if (
				!committed.committed ||
				!committed.audio ||
				!committed.span ||
				!committed.mission ||
				!this.isCurrentWriteContext(context)
			)
				return;
			this._audioSegments = this._audioSegments.map((entry) =>
				entry.id === segmentId ? fromAudioRecord(committed.audio!) : entry
			);
			this._transcriptSpans = this._transcriptSpans.filter(
				(entry) => entry.id !== committed.span!.id
			);
			this._transcriptSpans = [...this._transcriptSpans, fromTranscriptSpanRecord(committed.span)];
			this.applyCommittedMissionTranscript(committed.mission);
			if (!this.isCurrentWriteContext(context)) return;
		} catch (error) {
			if (!this.isCurrentWriteContext(context)) return;
			const structuredError = this.transcriptionError(error);
			try {
				const failure = await bulkMissionDb.commitAudioTranscriptionFailure(
					context.missionId,
					segmentId,
					attemptId,
					structuredError
				);
				if (
					failure.committed &&
					failure.audio &&
					failure.mission &&
					this.isCurrentWriteContext(context)
				) {
					this._audioSegments = this._audioSegments.map((entry) =>
						entry.id === segmentId ? fromAudioRecord(failure.audio!) : entry
					);
					this._error = 'Transcription failed for this recording. Retry transcription.';
					this._interimTranscriptText = this._error;
				}
			} catch (persistenceError) {
				void persistenceError;
				log.error('Bulk transcription failure could not be persisted safely');
			}
			void error;
			log.warn('Bulk server transcription unavailable; audio remains persisted safely');
		}
	}

	async retryAudioTranscription(segmentId: string): Promise<void> {
		const segment = this._audioSegments.find((entry) => entry.id === segmentId);
		if (!segment || segment.status !== 'failed') return;
		await this.transcribeAudioSegment(segmentId);
	}

	cancelActiveTranscriptions(): void {
		for (const controller of this.transcriptionControllers.values()) controller.abort();
	}

	setParentItem(id: string | null, name: string | null): void {
		this._parentItemId = id;
		this._parentItemName = name;
		this.observeDurableWrite(this.persistMission(), 'Location context could not be saved. Retry.');
	}

	setAreaLabel(label: string): void {
		this._areaLabel = label.trim() || null;
		this.observeDurableWrite(this.persistMission(), 'Area label could not be saved. Retry.');
	}

	getTargetParentId(): string | null {
		return this._parentItemId ?? this._locationId;
	}

	private captureWriteContext(): DurableWriteContext {
		return { missionId: this.missionId, generation: this.writeGeneration };
	}

	private isCurrentWriteContext(context: DurableWriteContext): boolean {
		return context.missionId === this.missionId && context.generation === this.writeGeneration;
	}

	private invalidateQueuedWrites(): void {
		this.writeGeneration += 1;
		this.durableWriteFailure = null;
	}

	private enqueueDurableWrite<T>(
		operation: (context: DurableWriteContext) => Promise<T>
	): Promise<T> {
		const context = this.captureWriteContext();
		const run = async (): Promise<T> => {
			if (!this.isCurrentWriteContext(context)) return undefined as T;
			return operation(context);
		};
		const next = this.durableWriteQueue.then(run, run);
		this.durableWriteQueue = next.then(
			() => {
				if (this.isCurrentWriteContext(context)) this.durableWriteFailure = null;
			},
			(error) => {
				if (!this.isCurrentWriteContext(context)) return;
				this.durableWriteFailure = error;
				this._error = error instanceof Error ? error.message : 'Durable save failed. Retry.';
			}
		);
		return next;
	}

	private observeDurableWrite<T>(promise: Promise<T>, message: string): Promise<T> {
		const context = this.captureWriteContext();
		const observed = promise.catch((error) => {
			if (!this.isCurrentWriteContext(context)) throw error;
			this._error = message;
			this._interimTranscriptText = message;
			log.error(message, error);
			throw error;
		});
		// Keep intentionally scheduled writes handled while preserving an
		// awaitable rejection for callers that need to block on durability.
		observed.catch(() => undefined);
		return observed;
	}

	/** Await all mission/audio/transcript writes before analysis, navigation, or reload-sensitive work. */
	async flushPersistence(): Promise<void> {
		await this.durableWriteQueue;
		if (this.durableWriteFailure) {
			const failure = this.durableWriteFailure;
			this.durableWriteFailure = null;
			throw failure;
		}
	}

	async flushTranscriptPersistence(): Promise<void> {
		await this.flushPersistence();
	}

	async recover(): Promise<boolean> {
		const active = await bulkMissionDb.loadActiveMission();
		if (!active) return false;
		await bulkMissionDb.recoverInterruptedAudioAttempts(active.id);
		const bundle = await bulkMissionDb.loadMissionBundle(active.id);
		if (!bundle) return false;
		const mission = bundle.mission;
		this.reset();
		this.missionId = mission.id;
		this._status = mission.status === 'complete' ? 'idle' : (mission.status as BulkSweepStatus);
		this._locationId = mission.locationId;
		this._locationName = mission.locationName ?? mission.areaLabel;
		this._locationPath = mission.locationPath ?? mission.areaLabel;
		this._areaLabel = mission.areaLabel;
		this._parentItemId = mission.parentItemId;
		this._parentItemName = mission.parentItemName ?? null;
		this._startedAtMs = mission.startedAtMs ?? mission.updatedAtMs;
		this._createdAtMs = mission.createdAtMs ?? mission.startedAtMs ?? mission.updatedAtMs;
		this._nextCaptureSequence = mission.nextCaptureSequence ?? mission.photoIds.length;
		this._rawTranscriptText = mission.rawTranscript ?? '';
		this._canonicalTranscriptText = mission.canonicalTranscript ?? this._rawTranscriptText;
		this._editedTranscriptText =
			mission.editedTranscript ?? mission.canonicalTranscript ?? this._rawTranscriptText;
		this._transcriptEdited = mission.transcriptEdited ?? false;
		this._transcriptSource = mission.transcriptSource ?? 'none';
		this._photos = bundle.photos.map((photo) => ({
			id: photo.id,
			file: new File([photo.blob], photo.filename, { type: photo.mimeType }),
			previewUrl: URL.createObjectURL(photo.blob),
			takenAtMs: photo.takenAtMs,
			sessionOffsetMs: photo.sessionOffsetMs,
			note: photo.note,
			groupLabel: photo.groupLabel,
			ignored: photo.ignored,
		}));
		this._audioSegments = bundle.audio.map(fromAudioRecord);
		this._transcriptSpans = bundle.spans.map(fromTranscriptSpanRecord);
		this._candidates = bundle.candidates.map((candidate) =>
			fromCandidateRecord(candidate, this._photos, this._transcriptSpans)
		);
		this._outboxOperations = bundle.outbox.map(cloneOutboxRecord);
		this._status = this._status === 'analyzing' ? 'transcript_review' : this._status;
		this._error = mission.lastError?.message ?? null;
		return true;
	}

	async discardPersistedMission(): Promise<void> {
		const missionId = this.missionId;
		bulkMissionDb.markMissionDiscarded(missionId);
		this.invalidateQueuedWrites();
		await this.durableWriteQueue;
		await bulkMissionDb.discardMission(missionId);
		this.reset();
	}

	async continueSameArea(): Promise<void> {
		const locationId = this._locationId;
		const locationName = this._locationName;
		const locationPath = this._locationPath;
		const parentId = this._parentItemId;
		const parentName = this._parentItemName;
		const missionId = this.missionId;
		bulkMissionDb.markMissionDiscarded(missionId);
		this.invalidateQueuedWrites();
		await this.durableWriteQueue;
		await bulkMissionDb.discardMission(missionId);
		this.reset();
		if (locationId && locationName && locationPath) {
			this.start(locationId, locationName, locationPath);
			this.setParentItem(parentId, parentName);
		}
		goto(resolve('/bulk-capture'));
	}

	async finishLocation(): Promise<void> {
		const missionId = this.missionId;
		bulkMissionDb.markMissionDiscarded(missionId);
		this.invalidateQueuedWrites();
		await this.durableWriteQueue;
		await bulkMissionDb.discardMission(missionId);
		this.reset();
		goto(resolve('/location'));
	}

	async addPhotos(files: File[]): Promise<void> {
		const context = this.captureWriteContext();
		const initialMissionPersistence = this.initialMissionPersistence;
		const now = Date.now();
		const startedAtMs = this._startedAtMs ?? now;
		const createdAtMs = this._createdAtMs ?? startedAtMs;
		const missionSnapshot: BulkMissionRecord = {
			schemaVersion: 2,
			id: context.missionId,
			status: this._status,
			locationId: this._locationId ?? '',
			locationName: this._locationName ?? '',
			locationPath: this._locationPath ?? '',
			parentItemId: this._parentItemId,
			parentItemName: this._parentItemName,
			areaLabel: this._areaLabel ?? '',
			createdAtMs,
			startedAtMs,
			updatedAtMs: now,
			photoIds: this._photos.map((photo) => photo.id),
			audioSegmentIds: this._audioSegments.map((audio) => audio.id),
			transcriptSpanIds: this._transcriptSpans.map((span) => span.id),
			observationChunkIds: [],
			candidateIds: this._candidates.map((candidate) => candidate.id),
			outboxOperationIds: this._outboxOperations.map((operation) => operation.id),
			chunkSize: 6,
			lastError: this._error ? { code: 'WORKFLOW', message: this._error, retryable: true } : null,
			rawTranscript: this._rawTranscriptText,
			canonicalTranscript: this._canonicalTranscriptText || this._rawTranscriptText,
			editedTranscript: this._editedTranscriptText,
			transcriptEdited: this._transcriptEdited,
			transcriptSource: this._transcriptSource,
			nextCaptureSequence: this._nextCaptureSequence,
		};
		const added = files.map((file) => ({
			id: createId('p'),
			file,
			previewUrl: URL.createObjectURL(file),
			takenAtMs: now,
			sessionOffsetMs: now - startedAtMs,
			note: '',
			groupLabel: '',
			ignored: false,
		}));
		const revokeTemporaryPreviews = () => {
			for (const photo of added) safeRevoke(photo.previewUrl);
		};
		const firstSequence = this._nextCaptureSequence;
		const records: BulkPhotoRecord[] = added.map((photo, index) => ({
			schemaVersion: 2,
			missionId: context.missionId,
			id: photo.id,
			status: 'ready',
			blob: photo.file,
			filename: photo.file.name,
			mimeType: photo.file.type || 'image/jpeg',
			byteSize: photo.file.size,
			takenAtMs: photo.takenAtMs,
			sessionOffsetMs: photo.sessionOffsetMs,
			note: photo.note,
			groupLabel: photo.groupLabel,
			ignored: photo.ignored,
			captureSequence: firstSequence + index,
		}));
		try {
			if (initialMissionPersistence) await initialMissionPersistence;
			if (!this.isCurrentWriteContext(context)) {
				revokeTemporaryPreviews();
				return;
			}
			const appendResult = await bulkMissionDb.appendPhotosAndUpdateMission(
				missionSnapshot,
				records
			);
			if (!this.isCurrentWriteContext(context)) {
				revokeTemporaryPreviews();
				return;
			}
			const committedPhotos = appendResult.photos;
			const committedMission = appendResult.mission;
			this._photos = [
				...this._photos,
				...committedPhotos.map((photo) => ({
					id: photo.id,
					file: new File([photo.blob], photo.filename, { type: photo.mimeType }),
					previewUrl: URL.createObjectURL(photo.blob),
					takenAtMs: photo.takenAtMs,
					sessionOffsetMs: photo.sessionOffsetMs,
					note: photo.note,
					groupLabel: photo.groupLabel,
					ignored: photo.ignored,
				})),
			];
			this._nextCaptureSequence =
				committedMission.nextCaptureSequence ??
				Math.max(0, ...committedPhotos.map((photo) => photo.captureSequence + 1));
			revokeTemporaryPreviews();
		} catch (error) {
			revokeTemporaryPreviews();
			if (!this.isCurrentWriteContext(context)) return;
			throw new Error('Photo could not be saved. Earlier evidence was preserved.', {
				cause: error,
			});
		}
	}

	async updatePhoto(
		id: string,
		patch: Partial<Pick<BulkCapturedPhoto, 'note' | 'groupLabel' | 'ignored'>>
	): Promise<void> {
		const photo = this._photos.find((entry) => entry.id === id);
		if (!photo) return;
		const captureSequence = await this.captureSequenceFor(photo.id);
		const proposed = { ...photo, ...patch };
		const dbWithAtomicPhotoPatch = bulkMissionDb as typeof bulkMissionDb & {
			updatePhoto?: (
				missionId: string,
				photoId: string,
				patch: Partial<Pick<BulkPhotoRecord, 'note' | 'groupLabel' | 'ignored' | 'status'>>
			) => Promise<BulkPhotoRecord | void>;
		};
		const persisted = dbWithAtomicPhotoPatch.updatePhoto
			? await dbWithAtomicPhotoPatch.updatePhoto(this.missionId, id, {
					...patch,
					status: proposed.ignored ? 'ignored' : 'ready',
				})
			: await bulkMissionDb.addOrUpdatePhoto({
					schemaVersion: 2,
					missionId: this.missionId,
					id: proposed.id,
					status: proposed.ignored ? 'ignored' : 'ready',
					blob: proposed.file,
					filename: proposed.file.name,
					mimeType: proposed.file.type || 'image/jpeg',
					byteSize: proposed.file.size,
					takenAtMs: proposed.takenAtMs,
					sessionOffsetMs: proposed.sessionOffsetMs,
					note: proposed.note,
					groupLabel: proposed.groupLabel,
					ignored: proposed.ignored,
					captureSequence,
				});
		const committed = persisted && 'blob' in persisted ? persisted : null;
		this._photos = this._photos.map((entry) =>
			entry.id === id
				? {
						...entry,
						...patch,
						...(committed
							? {
									file: new File([committed.blob], committed.filename, {
										type: committed.mimeType,
									}),
								}
							: {}),
					}
				: entry
		);
	}

	private async captureSequenceFor(id: string): Promise<number> {
		const bundle = await bulkMissionDb.loadMissionBundle(this.missionId);
		return bundle?.photos.find((photo) => photo.id === id)?.captureSequence ?? 0;
	}

	async removePhoto(id: string): Promise<void> {
		if (this.removingPhotoIds.has(id)) return;
		const removed = this._photos.find((photo) => photo.id === id);
		if (!removed) return;
		this.removingPhotoIds.add(id);
		try {
			await bulkMissionDb.removePhoto(this.missionId, id);
			if (removed) safeRevoke(removed.previewUrl);
			this._photos = this._photos.filter((photo) => photo.id !== id);
			this._candidates = this._candidates.filter(
				(candidate) => !candidate.sourcePhotoIds.includes(id)
			);
			this._outboxOperations = this._outboxOperations.filter(
				(operation) => !operation.evidencePhotoIds.includes(id)
			);
		} catch (error) {
			this._error = 'Photo could not be removed. Earlier evidence remains safe; retry.';
			throw error;
		} finally {
			this.removingPhotoIds.delete(id);
		}
	}

	async addAudioSegment(
		blob: Blob,
		mimeType: string,
		startedAtMs: number,
		endedAtMs: number,
		expectedIdentity?: BulkMissionIdentity
	): Promise<string> {
		if (expectedIdentity && !this.isCurrentMissionIdentity(expectedIdentity))
			return Promise.resolve('');
		if (
			blob.size <= 0 ||
			!Number.isFinite(startedAtMs) ||
			!Number.isFinite(endedAtMs) ||
			startedAtMs < 0 ||
			endedAtMs < startedAtMs
		)
			return Promise.resolve('');
		if (this.initialMissionPersistence) await this.initialMissionPersistence;
		if (expectedIdentity && !this.isCurrentMissionIdentity(expectedIdentity))
			return Promise.resolve('');
		const context = this.captureWriteContext();
		const segment: BulkAudioSegment = {
			id: createId('a'),
			file: blob,
			mimeType,
			startedAtMs,
			endedAtMs,
			transcriptStatus: 'pending',
			status: 'persisted',
			rawTranscript: '',
		};
		if (!this.isCurrentWriteContext(context)) return Promise.resolve('');
		const committed = await this.enqueueDurableWrite((queuedContext) =>
			bulkMissionDb.insertAudioSegment(
				queuedContext.missionId,
				toAudioRecord(segment, queuedContext.missionId)
			)
		);
		if (!this.isCurrentWriteContext(context)) return Promise.resolve('');
		this._audioSegments = [...this._audioSegments, fromAudioRecord(committed)];
		return segment.id;
	}

	appendLiveTranscript(
		text: string,
		final = false,
		source: 'server' | 'live_preview' | 'manual' = 'live_preview',
		expectedMissionId?: string,
		sourceAudioSegmentId?: string
	): Promise<void> {
		if (source === 'live_preview') {
			this._interimTranscriptText = text;
			return Promise.resolve();
		}
		if (expectedMissionId && expectedMissionId !== this.missionId) return Promise.resolve();
		if (!text.trim()) return Promise.resolve();
		const context = this.captureWriteContext();
		if (!this.isCurrentWriteContext(context)) return Promise.resolve();
		this._transcriptSource =
			this._transcriptSource === 'manual'
				? 'mixed'
				: source === 'server'
					? 'server'
					: source === 'manual'
						? 'manual'
						: 'live';
		if (final) {
			this._rawTranscriptText = [this._rawTranscriptText, text].filter(Boolean).join(' ').trim();
			if (!this._transcriptEdited) {
				this._editedTranscriptText = this._rawTranscriptText;
				this._canonicalTranscriptText = this._rawTranscriptText;
			}
			this._interimTranscriptText = '';
			const sourceSegment = sourceAudioSegmentId
				? this._audioSegments.find((entry) => entry.id === sourceAudioSegmentId)
				: undefined;
			const span: BulkTranscriptSpan = {
				id: createId('t'),
				text,
				startMs: sourceSegment?.startedAtMs,
				endMs: sourceSegment?.endedAtMs,
				startOffsetMs: sourceSegment?.startedAtMs ?? 0,
				endOffsetMs: sourceSegment?.endedAtMs ?? null,
				sourceAudioSegmentId: sourceAudioSegmentId ?? sourceSegment?.id,
				source,
				canonical: !this._transcriptEdited,
			};
			this._transcriptSpans = [...this._transcriptSpans, span];
			const missionSnapshot = this.buildMissionSnapshot(context);
			return this.enqueueDurableWrite(async (queuedContext) => {
				await bulkMissionDb.saveSpan(toTranscriptSpanRecord(span, queuedContext.missionId));
				if (missionSnapshot) await this.persistMissionNow(missionSnapshot, queuedContext);
			});
		} else {
			this._interimTranscriptText = text;
			return Promise.resolve();
		}
	}

	updateBrowserTranscriptPreview(
		text: string,
		_final: boolean,
		expectedIdentity: BulkMissionIdentity
	): void {
		if (!text.trim() || !this.isCurrentMissionIdentity(expectedIdentity)) return;
		this._interimTranscriptText = text;
	}

	editTranscript(text: string): Promise<void> {
		this._editedTranscriptText = text;
		this._transcriptEdited = text !== this._rawTranscriptText;
		this._transcriptSource =
			this._transcriptSource === 'none' || this._transcriptSource === 'manual' ? 'manual' : 'mixed';
		const identity = this.getMissionIdentity();
		return bulkMissionDb
			.updateMissionTranscriptEdit(identity.missionId, text)
			.then((mission) => {
				if (this.isCurrentMissionIdentity(identity)) this.applyCommittedMissionTranscript(mission);
			})
			.catch((error) => {
				if (this.isCurrentMissionIdentity(identity)) {
					this._error = 'Transcript could not be saved. Retry before analysis.';
					this.durableWriteFailure = error;
				}
				throw error;
			});
	}

	private applyCommittedMissionTranscript(mission: BulkMissionRecord): void {
		this._rawTranscriptText = mission.rawTranscript ?? '';
		this._canonicalTranscriptText = mission.canonicalTranscript ?? this._rawTranscriptText;
		this._editedTranscriptText = mission.editedTranscript ?? this._canonicalTranscriptText;
		this._transcriptEdited = mission.transcriptEdited ?? false;
		this._transcriptSource = mission.transcriptSource ?? 'none';
	}

	enterTranscriptReview(): void {
		this._status = 'transcript_review';
		if (!this._editedTranscriptText && this._rawTranscriptText) {
			this._editedTranscriptText = this._rawTranscriptText;
		}
		this.observeDurableWrite(
			this.persistMission(),
			'Transcript review state could not be saved. Retry.'
		);
	}

	async analyze(): Promise<BulkDetectResponse | null> {
		const activePhotos = this._photos.filter((photo) => !photo.ignored);
		if (activePhotos.length === 0) {
			this._error = 'Add at least one non-ignored photo before analysis.';
			return null;
		}
		await this.flushPersistence();
		this.abortController = new AbortController();
		this._status = 'analyzing';
		this._analysisProgress = {
			current: 0,
			total: activePhotos.length,
			message: 'Preparing resumable photo chunks...',
		};
		this._error = null;
		try {
			const plans = planBulkObservationChunks(this.missionId, this._photos, this._transcriptSpans);
			const bundle = await bulkMissionDb.loadMissionBundle(this.missionId);
			const completed = new Set(
				(bundle?.chunks ?? [])
					.filter((chunk) => chunk.status === 'complete')
					.map((chunk) => chunk.id)
			);
			const observations: any[] = [];
			const warnings: string[] = [];
			let hasFailedChunks = false;
			for (const plan of plans) {
				if (completed.has(plan.id)) continue;
				await bulkMissionDb.saveChunk({
					schemaVersion: 2,
					missionId: this.missionId,
					id: plan.id,
					status: 'analyzing',
					photoIds: plan.photoIds,
					transcriptSpanIds: plan.transcriptSpanIds,
					requestHash: plan.requestHash,
					observations: [],
					error: null,
				});
				try {
					const result = await vision.bulkObserve(
						{
							photos: activePhotos.filter((photo) => plan.photoIds.includes(photo.id)),
							photoIds: plan.photoIds,
							chunkId: plan.id,
							editedTranscript: this._editedTranscriptText,
							transcriptSpans: this._transcriptSpans,
						},
						{ signal: this.abortController.signal }
					);
					warnings.push(...result.warnings);
					observations.push(...result.observations);
					await bulkMissionDb.saveChunk({
						schemaVersion: 2,
						missionId: this.missionId,
						id: plan.id,
						status: 'complete',
						photoIds: plan.photoIds,
						transcriptSpanIds: plan.transcriptSpanIds,
						requestHash: plan.requestHash,
						observations: result.observations.map((observation) => ({
							schemaVersion: 2,
							missionId: this.missionId,
							id: `${plan.id}:${observation.id}`,
							photoIds: observation.photoIds,
							transcriptSpanIds: observation.transcriptSpanIds,
							name: observation.name,
							evidence: observation.evidence,
						})),
						error: null,
					});
				} catch (error) {
					hasFailedChunks = true;
					await bulkMissionDb.saveChunk({
						schemaVersion: 2,
						missionId: this.missionId,
						id: plan.id,
						status: 'failed',
						photoIds: plan.photoIds,
						transcriptSpanIds: plan.transcriptSpanIds,
						requestHash: plan.requestHash,
						observations: [],
						error: {
							code: 'OBSERVATION_CHUNK_FAILED',
							message: error instanceof Error ? error.message : 'Observation failed',
							retryable: true,
						},
					});
					warnings.push(`Chunk ${plan.id} failed; retry it independently.`);
				}
				this._analysisProgress = {
					current: Math.min(
						activePhotos.length,
						this._analysisProgress.current + plan.photoIds.length
					),
					total: activePhotos.length,
					message: `Analyzed ${Math.min(activePhotos.length, this._analysisProgress.current + plan.photoIds.length)} of ${activePhotos.length} photos`,
				};
			}
			const stored = await bulkMissionDb.loadMissionBundle(this.missionId);
			const allObservations = (stored?.chunks ?? [])
				.filter((chunk) => chunk.status === 'complete')
				.flatMap((chunk) => chunk.observations);
			const candidates = await vision.bulkFuse({
				missionId: this.missionId,
				observations: allObservations.map((observation) => ({
					...observation,
					photo_ids: observation.photoIds,
					transcript_span_ids: observation.transcriptSpanIds,
					evidence: observation.evidence.map(
						(ref: { photoId?: string; transcriptSpanId?: string }) => ({
							...ref,
							photo_id: ref.photoId,
							transcript_span_id: ref.transcriptSpanId,
						})
					),
				})),
				transcript: this._editedTranscriptText,
			});
			const result = {
				candidates,
				warnings,
				stats: {
					photo_count: activePhotos.length,
					ignored_photo_count: this._photos.length - activePhotos.length,
					candidate_count: candidates.length,
					low_confidence_count: 0,
				},
			} as BulkDetectResponse;
			this._candidates = this.attachLocalFiles(candidates);
			this._warnings = warnings;
			this._stats = result.stats;
			await bulkMissionDb.replaceCandidates(
				this.missionId,
				candidates.map((candidate) => toCandidateRecord(candidate, this.missionId))
			);
			await this.persistMission();
			this._status = hasFailedChunks ? 'transcript_review' : 'reviewing';
			return result;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				this._error = 'Analysis cancelled';
			} else {
				this._error = error instanceof Error ? error.message : 'Bulk analysis failed';
			}
			this._status = 'transcript_review';
			await this.persistMission();
			return null;
		} finally {
			this.abortController = null;
			this._analysisProgress = null;
		}
	}

	cancelAnalysis(): void {
		this.abortController?.abort();
	}

	private attachLocalFiles(candidates: BulkCandidateItem[]): BulkCandidateItem[] {
		return candidates.map((candidate) => {
			const files = candidate.sourcePhotoIds
				.map((id) => this._photos.find((photo) => photo.id === id)?.file)
				.filter((file): file is File => Boolean(file));
			return { ...candidate, originalFiles: files };
		});
	}

	updateCandidate(id: string, patch: Partial<BulkCandidateItem>): void {
		this._candidates = this._candidates.map((candidate) =>
			candidate.id === id ? { ...candidate, ...patch } : candidate
		);
		this.observeDurableWrite(
			this.persistCandidateRecords(),
			'Candidate changes could not be saved. Retry.'
		);
	}

	setCandidateStatus(id: string, status: BulkCandidateItem['status']): void {
		if (status === 'accepted') {
			const candidate = this._candidates.find((entry) => entry.id === id);
			if (!candidate || !this.isCandidateSubmittable(candidate)) {
				this._error =
					'Resolve evidence, quantity, and duplicate warnings before accepting this candidate.';
				return;
			}
		}
		this.updateCandidate(id, { status });
	}

	private isCandidateSubmittable(candidate: BulkCandidateItem): boolean {
		return (
			Boolean(candidate.name.trim()) &&
			candidate.sourcePhotoIds.length > 0 &&
			candidate.uncertaintyReasons.length === 0 &&
			candidate.quantity >= 1
		);
	}

	acceptReadyCandidates(): void {
		this._candidates = this._candidates.map((candidate) =>
			this.isCandidateSubmittable(candidate) ? { ...candidate, status: 'accepted' } : candidate
		);
		this.observeDurableWrite(
			this.persistCandidateRecords(),
			'Candidate changes could not be saved. Retry.'
		);
	}

	private async persistCandidateRecords(): Promise<void> {
		const context = this.captureWriteContext();
		const candidates = this._candidates.map((candidate) =>
			toCandidateRecord(candidate, context.missionId)
		);
		await this.enqueueDurableWrite((queuedContext) =>
			bulkMissionDb.replaceCandidates(queuedContext.missionId, candidates)
		);
	}

	async persistCandidates(): Promise<void> {
		await this.persistCandidateRecords();
	}

	addManualCandidate(name: string): string {
		const id = createId('manual');
		this._candidates = [
			...this._candidates,
			{
				id,
				name,
				quantity: 1,
				description: null,
				tag_ids: [],
				manufacturer: null,
				model_number: null,
				serial_number: null,
				purchase_price: null,
				purchase_from: null,
				notes: null,
				custom_fields: {},
				status: 'needs_review',
				evidence: [],
				sourcePhotoIds: [],
				uncertaintyReasons: ['manual_candidate_needs_evidence'],
				duplicateCandidateIds: [],
				duplicateExistingItemId: null,
				suggestedAction: 'review',
				originalFiles: [],
			},
		];
		this.observeDurableWrite(
			this.persistCandidateRecords(),
			'Candidate changes could not be saved. Retry.'
		);
		return id;
	}

	mergeCandidates(
		ids: string[],
		quantity: number,
		quantityBasis: 'explicit_count' | 'user_confirmed'
	): void {
		if (quantity < 1 || ids.length < 2) return;
		const selected = this._candidates.filter((candidate) => ids.includes(candidate.id));
		if (selected.length < 2) return;
		const first = selected[0];
		const merged = {
			...first,
			id: createId('merged'),
			quantity,
			status: 'needs_review' as const,
			sourcePhotoIds: [...new Set(selected.flatMap((candidate) => candidate.sourcePhotoIds))],
			evidence: selected.flatMap((candidate) => candidate.evidence),
			entityMode: 'grouped' as const,
			quantityBasis,
			sourceObservationIds: [
				...new Set(selected.flatMap((candidate) => candidate.sourceObservationIds ?? [])),
			],
			evidenceTranscriptSpanIds: [
				...new Set(selected.flatMap((candidate) => candidate.evidenceTranscriptSpanIds ?? [])),
			],
			blockerCodes: [...new Set(selected.flatMap((candidate) => candidate.blockerCodes ?? []))],
			warningCodes: [...new Set(selected.flatMap((candidate) => candidate.warningCodes ?? []))],
			duplicateMatches: selected.flatMap((candidate) => candidate.duplicateMatches ?? []),
			uncertaintyReasons: [
				...new Set(
					selected
						.flatMap((candidate) => candidate.uncertaintyReasons)
						.concat(`quantity_basis:${quantityBasis}`)
				),
			],
		};
		this._candidates = [
			...this._candidates.filter((candidate) => !ids.includes(candidate.id)),
			merged,
		];
		this.observeDurableWrite(
			this.persistCandidateRecords(),
			'Candidate changes could not be saved. Retry.'
		);
	}

	splitCandidate(id: string, firstQuantity: number, secondQuantity: number): void {
		const candidate = this._candidates.find((entry) => entry.id === id);
		if (!candidate || firstQuantity < 1 || secondQuantity < 1) return;
		const split = [
			{
				...candidate,
				id: createId('split'),
				quantity: firstQuantity,
				status: 'needs_review' as const,
			},
			{
				...candidate,
				id: createId('split'),
				quantity: secondQuantity,
				status: 'needs_review' as const,
			},
		];
		this._candidates = [...this._candidates.filter((entry) => entry.id !== id), ...split];
		this.observeDurableWrite(
			this.persistCandidateRecords(),
			'Candidate changes could not be saved. Retry.'
		);
	}

	resolveDuplicate(id: string, action: 'keep_new' | 'use_existing' | 'review'): void {
		this._candidates = this._candidates.map((candidate) =>
			candidate.id === id
				? {
						...candidate,
						duplicateExistingItemId:
							action === 'use_existing' ? candidate.duplicateExistingItemId : null,
						duplicateResolution: {
							action,
							existingItemId: action === 'use_existing' ? candidate.duplicateExistingItemId : null,
							atMs: Date.now(),
						},
						suggestedAction: action === 'use_existing' ? 'merge' : candidate.suggestedAction,
						status: action === 'use_existing' ? 'accepted' : candidate.status,
						uncertaintyReasons:
							action === 'review'
								? [...new Set([...candidate.uncertaintyReasons, 'duplicate_unresolved'])]
								: candidate.uncertaintyReasons.filter(
										(reason) => reason !== 'duplicate_unresolved'
									),
					}
				: candidate
		);
		this.observeDurableWrite(
			this.persistCandidateRecords(),
			'Candidate changes could not be saved. Retry.'
		);
	}

	acceptHighConfidence(): void {
		this.acceptReadyCandidates();
	}

	private async saveOutbox(operation: BulkOutboxOperationRecord): Promise<void> {
		const durableOperation = cloneOutboxRecord(operation);
		await this.enqueueDurableWrite(async (context) => {
			const boundOperation = { ...durableOperation, missionId: context.missionId };
			await bulkMissionDb.saveOutbox(boundOperation);
			if (!this.isCurrentWriteContext(context)) return;
			this._outboxOperations = [
				...this._outboxOperations.filter((entry) => entry.id !== boundOperation.id),
				boundOperation,
			];
		});
	}

	get acceptedCandidates(): BulkCandidateItem[] {
		return this._candidates.filter((candidate) => candidate.status === 'accepted');
	}

	async submitAccepted(): Promise<boolean> {
		const accepted = this.acceptedCandidates;
		if (accepted.length === 0) {
			this._error = 'Accept at least one candidate before submitting.';
			return false;
		}
		this._status = 'submitting';
		this._submissionProgress = { current: 0, total: accepted.length, message: 'Creating items...' };
		let hasPartial = false;
		try {
			for (let i = 0; i < accepted.length; i++) {
				const candidate = accepted[i];
				if (!this.isCandidateSubmittable(candidate)) {
					this._error = `Candidate ${candidate.name || candidate.id} is blocked until review is complete.`;
					this._status = 'reviewing';
					return false;
				}
				const payload = deepDeproxy({
					name: candidate.name,
					quantity: candidate.quantity,
					description: candidate.description,
					tag_ids: candidate.tag_ids,
					parent_id: this.getTargetParentId(),
					manufacturer: candidate.manufacturer,
					model_number: candidate.model_number,
					serial_number: candidate.serial_number,
					purchase_price: candidate.purchase_price,
					purchase_from: candidate.purchase_from,
					notes: candidate.notes,
					custom_fields: candidate.custom_fields,
					evidence_photo_ids: candidate.sourcePhotoIds,
					existing_item_id:
						candidate.suggestedAction === 'merge' ? candidate.duplicateExistingItemId : null,
					existing_item_action: candidate.suggestedAction === 'merge' ? 'increase_quantity' : null,
				});
				const requestHash = JSON.stringify(payload);
				await this.saveOutbox({
					schemaVersion: 2,
					missionId: this.missionId,
					id: `${this.missionId}:${candidate.id}`,
					candidateId: candidate.id,
					requestHash,
					status: 'sending',
					evidencePhotoIds: candidate.sourcePhotoIds,
					homeboxItemId: null,
					lastError: null,
					payloadSnapshot: payload,
					expectedAttachmentManifest: candidate.sourcePhotoIds,
					attachmentResults: Object.fromEntries(
						candidate.sourcePhotoIds.map((id) => [id, 'pending'])
					),
					stepState: 'reserved',
					attemptCount: 1,
				});
				const attachments = candidate.sourcePhotoIds
					.map((photoId) => ({
						photoId,
						file: this._photos.find((photo) => photo.id === photoId)?.file,
					}))
					.filter((entry): entry is { photoId: string; file: File } => Boolean(entry.file));
				try {
					const response = await items.submitBulkCandidate(
						this.missionId,
						candidate.id,
						payload,
						attachments,
						requestHash,
						{ signal: this.abortController?.signal }
					);
					const candidateState =
						response.status === 'complete' ? 'submitted' : 'attachments_partial';
					hasPartial ||= response.status !== 'complete';
					await this.saveOutbox({
						schemaVersion: 2,
						missionId: this.missionId,
						id: `${this.missionId}:${candidate.id}`,
						candidateId: candidate.id,
						requestHash,
						status: response.status === 'complete' ? 'complete' : 'partial',
						evidencePhotoIds: candidate.sourcePhotoIds,
						homeboxItemId: response.homeboxItemId ?? null,
						lastError:
							response.status === 'complete'
								? null
								: {
										code: 'ATTACHMENTS_PARTIAL',
										message: 'Some attachments need retry',
										retryable: true,
									},
						payloadSnapshot: payload,
						expectedAttachmentManifest: candidate.sourcePhotoIds,
						attachmentResults: Object.fromEntries(
							candidate.sourcePhotoIds.map((id) => [
								id,
								response.attachments?.find((attachment) => attachment.photoId === id)?.status ===
								'complete'
									? 'complete'
									: 'failed',
							])
						),
						stepState: response.status === 'complete' ? 'complete' : 'partial',
						attemptCount: 1,
					});
					this._candidates = this._candidates.map((entry) =>
						entry.id === candidate.id
							? {
									...entry,
									status: candidateState,
									createdHomeboxItemId: response.homeboxItemId ?? null,
									payloadSnapshot: deepDeproxy(payload),
								}
							: entry
					);
					await this.persistCandidateRecords();
				} catch (error) {
					hasPartial = true;
					this._candidates = this._candidates.map((entry) =>
						entry.id === candidate.id
							? {
									...entry,
									status: 'failed',
									createdHomeboxItemId: null,
									payloadSnapshot: deepDeproxy(payload),
								}
							: entry
					);
					this._error = `Submission for ${candidate.name} failed; other candidates continued.`;
					await this.saveOutbox({
						schemaVersion: 2,
						missionId: this.missionId,
						id: `${this.missionId}:${candidate.id}`,
						candidateId: candidate.id,
						requestHash,
						status: 'failed',
						evidencePhotoIds: candidate.sourcePhotoIds,
						homeboxItemId: null,
						lastError: {
							code: 'SUBMISSION_FAILED',
							message: error instanceof Error ? error.message : 'Submission failed',
							retryable: true,
						},
						payloadSnapshot: payload,
						expectedAttachmentManifest: candidate.sourcePhotoIds,
						attachmentResults: Object.fromEntries(
							candidate.sourcePhotoIds.map((id) => [id, 'failed'])
						),
						stepState: 'failed',
						attemptCount: 1,
					});
					await this.persistCandidateRecords();
				}
				this._submissionProgress = {
					current: i + 1,
					total: accepted.length,
					message: `Submitted ${i + 1} of ${accepted.length}...`,
				};
			}
			this._status = hasPartial ? 'reviewing' : 'complete';
			if (hasPartial) {
				await this.persistMission();
			} else {
				// Keep the completed candidates recoverable after a forced reload.
				// The explicit completion route remains the local success surface.
				this._status = 'reviewing';
				await this.persistMission();
				this._status = 'complete';
			}
			if (!hasPartial) goto(resolve('/bulk-complete'));
			return !hasPartial;
		} catch (error) {
			log.error('Bulk submission failed', error);
			this._error = error instanceof Error ? error.message : 'Bulk submission failed';
			this._status = 'reviewing';
			return false;
		} finally {
			this._submissionProgress = null;
		}
	}

	reset(): void {
		this.cancelActiveTranscriptions();
		this.invalidateQueuedWrites();
		for (const photo of this._photos) safeRevoke(photo.previewUrl);
		this._status = 'idle';
		this._locationId = null;
		this._locationName = null;
		this._locationPath = null;
		this._areaLabel = null;
		this._parentItemId = null;
		this._parentItemName = null;
		this._startedAtMs = null;
		this._createdAtMs = null;
		this._nextCaptureSequence = 0;
		this._photos = [];
		this._audioSegments = [];
		this._transcriptSpans = [];
		this._rawTranscriptText = '';
		this._canonicalTranscriptText = '';
		this._interimTranscriptText = '';
		this._editedTranscriptText = '';
		this._transcriptEdited = false;
		this._transcriptSource = 'none';
		this._candidates = [];
		this._outboxOperations = [];
		this.initialMissionPersistence = null;
		this.removingPhotoIds.clear();
		this._analysisProgress = null;
		this._submissionProgress = null;
		this._error = null;
		this._warnings = [];
		this._stats = null;
	}

	private buildMissionSnapshot(context: DurableWriteContext): BulkMissionRecord | null {
		if (!this._locationId) return null;
		return {
			schemaVersion: 2,
			id: context.missionId,
			status: this._status,
			locationId: this._locationId,
			parentItemId: this._parentItemId,
			parentItemName: this._parentItemName,
			locationName: this._locationName ?? '',
			areaLabel: this._areaLabel ?? '',
			locationPath: this._locationPath ?? this._locationName ?? '',
			createdAtMs: this._createdAtMs ?? Date.now(),
			startedAtMs: this._startedAtMs ?? Date.now(),
			updatedAtMs: Date.now(),
			photoIds: this._photos.map((photo) => photo.id),
			audioSegmentIds: this._audioSegments.map((audio) => audio.id),
			transcriptSpanIds: this._transcriptSpans.map((span) => span.id),
			observationChunkIds: [],
			candidateIds: this._candidates.map((candidate) => candidate.id),
			outboxOperationIds: this._outboxOperations.map((operation) => operation.id),
			chunkSize: 6,
			lastError: this._error ? { code: 'WORKFLOW', message: this._error, retryable: true } : null,
			rawTranscript: this._rawTranscriptText,
			canonicalTranscript: this._canonicalTranscriptText || this._rawTranscriptText,
			editedTranscript: this._editedTranscriptText,
			transcriptEdited: this._transcriptEdited,
			transcriptSource: this._transcriptSource,
			nextCaptureSequence: this._nextCaptureSequence,
		};
	}

	private async persistMissionNow(
		snapshot: BulkMissionRecord,
		context: DurableWriteContext
	): Promise<void> {
		if (!this.isCurrentWriteContext(context)) return;
		const durable = await bulkMissionDb.loadMissionBundle(snapshot.id);
		if (!this.isCurrentWriteContext(context)) return;
		const durableMission = durable?.mission;
		const ids = (durableIds: string[] | undefined, localIds: string[]): string[] =>
			durableMission ? [...(durableIds ?? [])] : [...localIds];
		await bulkMissionDb.saveMission({
			...snapshot,
			createdAtMs: snapshot.createdAtMs ?? durableMission?.createdAtMs ?? Date.now(),
			startedAtMs: snapshot.startedAtMs ?? durableMission?.startedAtMs ?? Date.now(),
			updatedAtMs: Date.now(),
			photoIds: ids(durableMission?.photoIds, snapshot.photoIds),
			audioSegmentIds: ids(durableMission?.audioSegmentIds, snapshot.audioSegmentIds),
			transcriptSpanIds: ids(durableMission?.transcriptSpanIds, snapshot.transcriptSpanIds),
			observationChunkIds: ids(
				durableMission?.observationChunkIds,
				durable?.chunks.map((chunk) => chunk.id) ?? []
			),
			candidateIds: ids(
				durableMission?.candidateIds,
				durable?.candidates.map((candidate) => candidate.id) ?? snapshot.candidateIds
			),
			outboxOperationIds: ids(
				durableMission?.outboxOperationIds,
				durable?.outbox.map((operation) => operation.id) ?? snapshot.outboxOperationIds
			),
			chunkSize: durableMission?.chunkSize ?? snapshot.chunkSize,
			lastError: this._error
				? { code: 'WORKFLOW', message: this._error, retryable: true }
				: (durableMission?.lastError ?? snapshot.lastError),
			nextCaptureSequence: Math.max(
				snapshot.nextCaptureSequence ?? 0,
				durableMission?.nextCaptureSequence ?? 0
			),
		});
	}

	private persistMission(): Promise<void> {
		const context = this.captureWriteContext();
		const snapshot = this.buildMissionSnapshot(context);
		if (!snapshot) return Promise.resolve();
		return this.enqueueDurableWrite((queuedContext) =>
			this.persistMissionNow(snapshot, queuedContext)
		);
	}
}

export const bulkSweepWorkflow = new BulkSweepWorkflow();
