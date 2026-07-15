import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { items, vision } from '$lib/api';
import * as bulkMissionDb from '$lib/services/bulkMissionDb';
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
	BatchCreateRequest,
	Progress,
} from '$lib/types';

function createId(prefix: string): string {
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeRevoke(url: string): void {
	if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

class BulkSweepWorkflow {
	private missionId = createId('mission_bulk');
	private _status = $state<BulkSweepStatus>('idle');
	private _locationId = $state<string | null>(null);
	private _locationName = $state<string | null>(null);
	private _locationPath = $state<string | null>(null);
	private _parentItemId = $state<string | null>(null);
	private _parentItemName = $state<string | null>(null);
	private _startedAtMs = $state<number | null>(null);
	private _photos = $state<BulkCapturedPhoto[]>([]);
	private _audioSegments = $state<BulkAudioSegment[]>([]);
	private _transcriptSpans = $state<BulkTranscriptSpan[]>([]);
	private _rawTranscriptText = $state('');
	private _interimTranscriptText = $state('');
	private _editedTranscriptText = $state('');
	private _transcriptEdited = $state(false);
	private _transcriptSource = $state<BulkTranscriptSource>('none');
	private _candidates = $state<BulkCandidateItem[]>([]);
	private _analysisProgress = $state<Progress | null>(null);
	private _submissionProgress = $state<Progress | null>(null);
	private _error = $state<string | null>(null);
	private _warnings = $state<string[]>([]);
	private _stats = $state<BulkSweepState['stats']>(null);
	private abortController: AbortController | null = null;

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
		void this.persistMission();
	}

	setParentItem(id: string | null, name: string | null): void {
		this._parentItemId = id;
		this._parentItemName = name;
		void this.persistMission();
	}

	async recover(): Promise<boolean> {
		const mission = await bulkMissionDb.loadActiveMission();
		if (!mission) return false;
		const bundle = await bulkMissionDb.loadMissionBundle(mission.id);
		if (!bundle) return false;
		this.reset();
		this.missionId = mission.id;
		this._status = mission.status === 'complete' ? 'idle' : (mission.status as BulkSweepStatus);
		this._locationId = mission.locationId;
		this._locationName = mission.areaLabel;
		this._parentItemId = mission.parentItemId;
		this._startedAtMs = Date.now();
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
		this._audioSegments = bundle.audio.map((audio) => ({
			id: audio.id,
			file: audio.blob,
			mimeType: audio.mimeType,
			startedAtMs: audio.startedAtMs,
			endedAtMs: audio.endedAtMs,
			transcriptStatus:
				audio.status === 'done' ? 'done' : audio.status === 'failed' ? 'failed' : 'pending',
			rawTranscript: audio.rawTranscript,
		}));
		this._transcriptSpans = bundle.spans.map((span) => ({
			id: span.id,
			text: span.text,
			startMs: span.startOffsetMs ?? undefined,
			endMs: span.endOffsetMs ?? undefined,
		}));
		this._status = this._status === 'analyzing' ? 'transcript_review' : this._status;
		this._error = mission.lastError?.message ?? null;
		return true;
	}

	async discardPersistedMission(): Promise<void> {
		await bulkMissionDb.discardMission(this.missionId);
		this.reset();
	}

	async addPhotos(files: File[]): Promise<void> {
		if (!this._startedAtMs) this._startedAtMs = Date.now();
		const now = Date.now();
		const added = files.map((file) => ({
			id: createId('p'),
			file,
			previewUrl: URL.createObjectURL(file),
			takenAtMs: now,
			sessionOffsetMs: now - (this._startedAtMs ?? now),
			note: '',
			groupLabel: '',
			ignored: false,
		}));
		this._photos = [...this._photos, ...added];
		const writes = added.map((photo) =>
			bulkMissionDb.addOrUpdatePhoto({
				schemaVersion: 1,
				missionId: this.missionId,
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
				captureSequence: this._photos.length,
			})
		);
		await Promise.all(writes);
		await this.persistMission();
	}

	updatePhoto(
		id: string,
		patch: Partial<Pick<BulkCapturedPhoto, 'note' | 'groupLabel' | 'ignored'>>
	): void {
		this._photos = this._photos.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo));
		const photo = this._photos.find((entry) => entry.id === id);
		if (photo)
			void bulkMissionDb.addOrUpdatePhoto({
				schemaVersion: 1,
				missionId: this.missionId,
				id: photo.id,
				status: photo.ignored ? 'ignored' : 'ready',
				blob: photo.file,
				filename: photo.file.name,
				mimeType: photo.file.type || 'image/jpeg',
				byteSize: photo.file.size,
				takenAtMs: photo.takenAtMs,
				sessionOffsetMs: photo.sessionOffsetMs,
				note: photo.note,
				groupLabel: photo.groupLabel,
				ignored: photo.ignored,
				captureSequence: this._photos.indexOf(photo),
			});
	}

	removePhoto(id: string): void {
		const removed = this._photos.find((photo) => photo.id === id);
		if (removed) safeRevoke(removed.previewUrl);
		this._photos = this._photos.filter((photo) => photo.id !== id);
		void bulkMissionDb.removePhoto(this.missionId, id);
		void this.persistMission();
	}

	addAudioSegment(blob: Blob, mimeType: string, startedAtMs: number, endedAtMs: number): void {
		this._audioSegments = [
			...this._audioSegments,
			{
				id: createId('a'),
				file: blob,
				mimeType,
				startedAtMs,
				endedAtMs,
				transcriptStatus: 'pending',
			},
		];
		const segment = this._audioSegments.at(-1);
		if (segment)
			void bulkMissionDb.addOrUpdateAudio({
				schemaVersion: 1,
				missionId: this.missionId,
				id: segment.id,
				status: 'persisted',
				blob: segment.file,
				mimeType: segment.mimeType,
				byteSize: segment.file.size,
				startedAtMs,
				endedAtMs,
				rawTranscript: '',
				error: null,
				retryCount: 0,
			});
		void this.persistMission();
	}

	appendLiveTranscript(text: string, final = false): void {
		if (!text.trim()) return;
		this._transcriptSource = this._transcriptSource === 'manual' ? 'mixed' : 'live';
		if (final) {
			this._rawTranscriptText = [this._rawTranscriptText, text].filter(Boolean).join(' ').trim();
			if (!this._transcriptEdited) this._editedTranscriptText = this._rawTranscriptText;
			this._interimTranscriptText = '';
			this._transcriptSpans = [
				...this._transcriptSpans,
				{ id: createId('t'), text, startMs: 0, endMs: undefined },
			];
		} else {
			this._interimTranscriptText = text;
		}
	}

	editTranscript(text: string): void {
		this._editedTranscriptText = text;
		this._transcriptEdited = text !== this._rawTranscriptText;
		this._transcriptSource =
			this._transcriptSource === 'none' || this._transcriptSource === 'manual' ? 'manual' : 'mixed';
	}

	enterTranscriptReview(): void {
		this._status = 'transcript_review';
		if (!this._editedTranscriptText && this._rawTranscriptText) {
			this._editedTranscriptText = this._rawTranscriptText;
		}
	}

	async analyze(): Promise<BulkDetectResponse | null> {
		const activePhotos = this._photos.filter((photo) => !photo.ignored);
		if (activePhotos.length === 0) {
			this._error = 'Add at least one non-ignored photo before analysis.';
			return null;
		}
		this.abortController = new AbortController();
		this._status = 'analyzing';
		this._analysisProgress = { current: 1, total: 4, message: 'Preparing sweep...' };
		this._error = null;
		try {
			const result = await vision.bulkDetect(
				{
					photos: activePhotos,
					allPhotos: this._photos,
					locationId: this._locationId,
					locationName: this._locationName,
					locationPath: this._locationPath,
					parentItemId: this._parentItemId,
					editedTranscript: this._editedTranscriptText,
					transcriptSpans: this._transcriptSpans,
				},
				{ signal: this.abortController.signal }
			);
			this._analysisProgress = { current: 4, total: 4, message: 'Preparing review...' };
			this._candidates = this.attachLocalFiles(result.candidates);
			this._warnings = result.warnings;
			this._stats = result.stats;
			this._status = 'reviewing';
			return result;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				this._error = 'Analysis cancelled';
			} else {
				this._error = error instanceof Error ? error.message : 'Bulk analysis failed';
			}
			this._status = 'transcript_review';
			return null;
		} finally {
			this.abortController = null;
			this._analysisProgress = null;
		}
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
	}

	setCandidateStatus(id: string, status: BulkCandidateItem['status']): void {
		this.updateCandidate(id, { status });
	}

	acceptHighConfidence(): void {
		this._candidates = this._candidates.map((candidate) =>
			candidate.confidence >= 0.9 ? { ...candidate, status: 'accepted' } : candidate
		);
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
		try {
			const request: BatchCreateRequest = {
				location_id: this._locationId,
				items: accepted.map((candidate) => ({
					name: candidate.name,
					quantity: candidate.quantity,
					description: candidate.description,
					tag_ids: candidate.tag_ids,
					parent_id: this._parentItemId,
					manufacturer: candidate.manufacturer,
					model_number: candidate.model_number,
					serial_number: candidate.serial_number,
					purchase_price: candidate.purchase_price,
					purchase_from: candidate.purchase_from,
					notes: candidate.notes,
					custom_fields: candidate.custom_fields,
				})),
			};
			const created = await items.create(request);
			for (let i = 0; i < created.created.length; i++) {
				const item = created.created[i];
				const candidate = accepted[i];
				if (!item?.id || !candidate?.originalFiles?.length) continue;
				for (const file of candidate.originalFiles.slice(0, 4)) {
					await items.uploadAttachment(item.id, file);
				}
				this._submissionProgress = {
					current: i + 1,
					total: accepted.length,
					message: `Submitted ${i + 1} of ${accepted.length}...`,
				};
			}
			this._status = 'complete';
			goto(resolve('/success'));
			return true;
		} catch (error) {
			log.error('Bulk submission failed', error);
			this._error = error instanceof Error ? error.message : 'Bulk submission failed';
			this._status = 'reviewing';
			return false;
		} finally {
			this._submissionProgress = null;
		}
	}

	cancelAnalysis(): void {
		this.abortController?.abort();
	}

	reset(): void {
		for (const photo of this._photos) safeRevoke(photo.previewUrl);
		this._status = 'idle';
		this._locationId = null;
		this._locationName = null;
		this._locationPath = null;
		this._parentItemId = null;
		this._parentItemName = null;
		this._startedAtMs = null;
		this._photos = [];
		this._audioSegments = [];
		this._transcriptSpans = [];
		this._rawTranscriptText = '';
		this._interimTranscriptText = '';
		this._editedTranscriptText = '';
		this._transcriptEdited = false;
		this._transcriptSource = 'none';
		this._candidates = [];
		this._analysisProgress = null;
		this._submissionProgress = null;
		this._error = null;
		this._warnings = [];
		this._stats = null;
	}

	private async persistMission(): Promise<void> {
		if (!this._locationId) return;
		try {
			await bulkMissionDb.saveMission({
				schemaVersion: 1,
				id: this.missionId,
				status: this._status,
				locationId: this._locationId,
				parentItemId: this._parentItemId,
				areaLabel: this._locationName ?? '',
				photoIds: this._photos.map((photo) => photo.id),
				audioSegmentIds: this._audioSegments.map((audio) => audio.id),
				transcriptSpanIds: this._transcriptSpans.map((span) => span.id),
				observationChunkIds: [],
				candidateIds: [],
				outboxOperationIds: [],
				chunkSize: 6,
				lastError: this._error ? { code: 'WORKFLOW', message: this._error, retryable: true } : null,
			});
		} catch (error) {
			log.warn('Bulk mission persistence failed', error);
		}
	}
}

export const bulkSweepWorkflow = new BulkSweepWorkflow();
