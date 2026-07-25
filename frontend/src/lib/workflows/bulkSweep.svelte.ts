import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { items, vision } from '$lib/api';
import * as bulkMissionDb from '$lib/services/bulkMissionDb';
import { planBulkObservationChunks } from '$lib/services/bulkAnalysisPlanner';
import type { BulkCandidateRecord, BulkPhotoRecord } from '$lib/types/bulkDomain';
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

class BulkSweepWorkflow {
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
		this._createdAtMs = this._startedAtMs;
		this._nextCaptureSequence = 0;
		this._areaLabel = null;
		void this.persistMission();
	}

	async transcribeAudioSegment(segmentId: string): Promise<void> {
		const segment = this._audioSegments.find((entry) => entry.id === segmentId);
		if (!segment) return;
		try {
			const result = await vision.transcribeAudio(segment.file, `${segmentId}.webm`);
			const text = result.text.trim();
			if (!text) throw new Error('Server returned an empty transcript');
			this._audioSegments = this._audioSegments.map((entry) =>
				entry.id === segmentId ? { ...entry, transcriptStatus: 'done', rawTranscript: text } : entry
			);
			this.appendLiveTranscript(text, true);
			await bulkMissionDb.addOrUpdateAudio({
				schemaVersion: 2,
				missionId: this.missionId,
				id: segmentId,
				status: 'done',
				blob: segment.file,
				mimeType: segment.mimeType,
				byteSize: segment.file.size,
				startedAtMs: segment.startedAtMs,
				endedAtMs: segment.endedAtMs,
				rawTranscript: text,
				transcript: text,
				source: 'server',
				error: null,
				retryCount: 0,
			});
			await this.persistMission();
		} catch (error) {
			log.warn('Bulk server transcription unavailable; audio remains persisted', error);
		}
	}

	setParentItem(id: string | null, name: string | null): void {
		this._parentItemId = id;
		this._parentItemName = name;
		void this.persistMission();
	}

	setAreaLabel(label: string): void {
		this._areaLabel = label.trim() || null;
		void this.persistMission();
	}

	getTargetParentId(): string | null {
		return this._parentItemId ?? this._locationId;
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
		this._locationName = mission.locationName ?? mission.areaLabel;
		this._locationPath = mission.locationPath ?? mission.areaLabel;
		this._areaLabel = mission.areaLabel;
		this._parentItemId = mission.parentItemId;
		this._startedAtMs = mission.startedAtMs ?? mission.updatedAtMs;
		this._createdAtMs = mission.createdAtMs ?? mission.startedAtMs ?? mission.updatedAtMs;
		this._nextCaptureSequence = mission.nextCaptureSequence ?? mission.photoIds.length;
		this._rawTranscriptText = mission.rawTranscript ?? '';
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
			sourceAudioSegmentId: span.sourceAudioSegmentId ?? undefined,
		}));
		const durableCandidates = bundle.candidates;
		this._candidates = durableCandidates.map((candidate) => ({
			id: candidate.id,
			name: candidate.name,
			quantity: candidate.quantity,
			description: candidate.description ?? null,
			tag_ids: candidate.tagIds ?? [],
			manufacturer: candidate.manufacturer ?? null,
			model_number: candidate.modelNumber ?? null,
			serial_number: candidate.serialNumber ?? null,
			purchase_price: candidate.purchasePrice ?? null,
			purchase_from: candidate.purchaseFrom ?? null,
			notes: candidate.notes ?? null,
			custom_fields: candidate.customFields ?? {},
			confidence: 0,
			status:
				candidate.state === 'submitted'
					? 'submitted'
					: candidate.state === 'accepted'
						? 'accepted'
						: candidate.state === 'rejected'
							? 'rejected'
							: 'needs_review',
			evidence: candidate.evidencePhotoIds.map((photoId) => ({
				photoId,
				reason: 'Persisted candidate evidence',
			})),
			sourcePhotoIds: candidate.evidencePhotoIds,
			uncertaintyReasons: candidate.warningCodes,
			duplicateCandidateIds: [],
			duplicateExistingItemId: candidate.duplicateMatches[0]?.existingItemId ?? null,
			suggestedAction:
				(candidate.suggestedAction as BulkCandidateItem['suggestedAction']) ?? 'review',
			correctionHistory: candidate.correctionHistory ?? [],
			payloadSnapshot: candidate.payloadSnapshot ?? null,
			originalFiles: candidate.evidencePhotoIds
				.map((photoId) => this._photos.find((photo) => photo.id === photoId)?.file)
				.filter((file): file is File => Boolean(file)),
		}));
		this._status = this._status === 'analyzing' ? 'transcript_review' : this._status;
		this._error = mission.lastError?.message ?? null;
		return true;
	}

	async discardPersistedMission(): Promise<void> {
		await bulkMissionDb.discardMission(this.missionId);
		this.reset();
	}

	async continueSameArea(): Promise<void> {
		const locationId = this._locationId;
		const locationName = this._locationName;
		const locationPath = this._locationPath;
		const parentId = this._parentItemId;
		const parentName = this._parentItemName;
		await bulkMissionDb.discardMission(this.missionId);
		this.reset();
		if (locationId && locationName && locationPath) {
			this.start(locationId, locationName, locationPath);
			this.setParentItem(parentId, parentName);
		}
		goto(resolve('/bulk-capture'));
	}

	async finishLocation(): Promise<void> {
		await bulkMissionDb.discardMission(this.missionId);
		this.reset();
		goto(resolve('/location'));
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
		const firstSequence = this._nextCaptureSequence;
		const records: BulkPhotoRecord[] = added.map((photo, index) => ({
			schemaVersion: 2,
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
			captureSequence: firstSequence + index,
		}));
		try {
			await bulkMissionDb.appendPhotosAndUpdateMission(
				{
					schemaVersion: 2,
					id: this.missionId,
					status: this._status,
					locationId: this._locationId ?? '',
					locationName: this._locationName ?? '',
					locationPath: this._locationPath ?? '',
					parentItemId: this._parentItemId,
					areaLabel: this._areaLabel ?? '',
					createdAtMs: this._createdAtMs ?? now,
					startedAtMs: this._startedAtMs ?? now,
					updatedAtMs: now,
					photoIds: [], audioSegmentIds: [], transcriptSpanIds: [], observationChunkIds: [],
					candidateIds: [], outboxOperationIds: [],
					chunkSize: 6,
					lastError: null,
				},
				records
			);
		} catch (error) {
			for (const photo of added) safeRevoke(photo.previewUrl);
			throw new Error('Photo could not be saved. Earlier evidence was preserved.', {
				cause: error,
			});
		}
		this._photos = [...this._photos, ...added];
		this._nextCaptureSequence += records.length;
	}

	async updatePhoto(
		id: string,
		patch: Partial<Pick<BulkCapturedPhoto, 'note' | 'groupLabel' | 'ignored'>>
	): Promise<void> {
		this._photos = this._photos.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo));
		const photo = this._photos.find((entry) => entry.id === id);
		if (photo)
			await bulkMissionDb.addOrUpdatePhoto({
				schemaVersion: 2,
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
				captureSequence: await this.captureSequenceFor(photo.id),
			});
	}

	private async captureSequenceFor(id: string): Promise<number> {
		const bundle = await bulkMissionDb.loadMissionBundle(this.missionId);
		return bundle?.photos.find((photo) => photo.id === id)?.captureSequence ?? 0;
	}

	async removePhoto(id: string): Promise<void> {
		const removed = this._photos.find((photo) => photo.id === id);
		await bulkMissionDb.removePhoto(this.missionId, id);
		if (removed) safeRevoke(removed.previewUrl);
		this._photos = this._photos.filter((photo) => photo.id !== id);
		this._candidates = this._candidates.filter(
			(candidate) => !candidate.sourcePhotoIds.includes(id)
		);
		await this.persistCandidateRecords();
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
				schemaVersion: 2,
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
			const span = this._transcriptSpans.at(-1);
			if (span)
				void bulkMissionDb.saveSpan({
					schemaVersion: 2,
					missionId: this.missionId,
					id: span.id,
					sourceAudioSegmentId: this._audioSegments.at(-1)?.id ?? null,
					text: span.text,
					startOffsetMs: span.startMs ?? 0,
					endOffsetMs: span.endMs ?? null,
					source: this._transcriptSource === 'live' ? 'live_preview' : 'manual',
					canonical: !this._transcriptEdited,
				});
			void this.persistMission();
		} else {
			this._interimTranscriptText = text;
		}
	}

	editTranscript(text: string): void {
		this._editedTranscriptText = text;
		this._transcriptEdited = text !== this._rawTranscriptText;
		this._transcriptSource =
			this._transcriptSource === 'none' || this._transcriptSource === 'manual' ? 'manual' : 'mixed';
		void this.persistMission();
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
				candidates.map((candidate): BulkCandidateRecord => ({
					schemaVersion: 2,
					missionId: this.missionId,
					id: candidate.id,
					state:
						candidate.status === 'submitted'
							? 'submitted'
							: candidate.status === 'accepted'
								? 'accepted'
								: 'needs_review',
					reviewTier: candidate.uncertaintyReasons.length ? 'attention' : 'ready',
					name: candidate.name,
					quantity: Math.max(1, candidate.quantity),
					entityMode: candidate.quantity > 1 ? 'grouped' : 'individual',
					quantityBasis: candidate.quantity > 1 ? 'unknown' : 'distinct_entities',
					sourceObservationIds: candidate.sourcePhotoIds.map(
						(photoId: string) => `${this.missionId}:photo:${photoId}`
					),
					evidencePhotoIds: candidate.sourcePhotoIds,
					evidenceTranscriptSpanIds: candidate.evidence
						.map((ref: { transcriptSpanId?: string }) => ref.transcriptSpanId)
						.filter((id: string | undefined): id is string => Boolean(id)),
					blockerCodes: [],
					warningCodes: candidate.quantity > 1 ? ['quantity_unconfirmed'] : [],
					duplicateMatches: [],
					createdHomeboxItemId: null,
					description: candidate.description,
					tagIds: candidate.tag_ids ?? [],
					manufacturer: candidate.manufacturer,
					modelNumber: candidate.model_number,
					serialNumber: candidate.serial_number,
					purchasePrice: candidate.purchase_price,
					purchaseFrom: candidate.purchase_from,
					notes: candidate.notes,
					customFields: candidate.custom_fields ?? {},
					suggestedAction: candidate.suggestedAction,
					correctionHistory: [],
					payloadSnapshot: null,
				}))
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
		void this.persistCandidateRecords().catch((error) =>
			log.error('Candidate persistence failed', error)
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
		void this.persistCandidateRecords();
	}

	private async persistCandidateRecords(): Promise<void> {
		const records: BulkCandidateRecord[] = [];
		const existingBundle = await bulkMissionDb.loadMissionBundle(this.missionId);
		for (const candidate of this._candidates) {
			const previous = existingBundle?.candidates.find((entry) => entry.id === candidate.id);
			const record: BulkCandidateRecord = {
				schemaVersion: 2,
				missionId: this.missionId,
				id: candidate.id,
				state:
					candidate.status === 'submitted'
						? 'submitted'
						: candidate.status === 'accepted'
							? 'accepted'
							: candidate.status === 'rejected'
								? 'rejected'
								: 'needs_review',
				reviewTier: candidate.uncertaintyReasons.length ? 'attention' : 'ready',
				name: candidate.name,
				quantity: Math.max(1, candidate.quantity),
				entityMode: candidate.quantity > 1 ? 'grouped' : 'individual',
				quantityBasis: candidate.quantity > 1 ? 'unknown' : 'distinct_entities',
				sourceObservationIds: candidate.sourcePhotoIds,
				evidencePhotoIds: candidate.sourcePhotoIds,
				evidenceTranscriptSpanIds: candidate.evidence
					.map((ref) => ref.transcriptSpanId)
					.filter((span): span is string => Boolean(span)),
				blockerCodes: [],
				warningCodes: candidate.uncertaintyReasons,
				duplicateMatches: candidate.duplicateExistingItemId
					? [
							{
								existingItemId: candidate.duplicateExistingItemId,
								matchKind: 'advisory',
								reasons: ['Review required'],
							},
						]
					: [],
				createdHomeboxItemId: null,
				description: candidate.description,
				tagIds: candidate.tag_ids ?? [],
				manufacturer: candidate.manufacturer,
				modelNumber: candidate.model_number,
				serialNumber: candidate.serial_number,
				purchasePrice: candidate.purchase_price,
				purchaseFrom: candidate.purchase_from,
				notes: candidate.notes,
				customFields: candidate.custom_fields ?? {},
				suggestedAction: candidate.suggestedAction,
				correctionHistory: candidate.correctionHistory ?? previous?.correctionHistory ?? [],
				payloadSnapshot: candidate.payloadSnapshot ?? previous?.payloadSnapshot ?? null,
			};
			const clone = JSON.parse(JSON.stringify(record)) as BulkCandidateRecord;
			records.push(clone);
		}
		await bulkMissionDb.replaceCandidates(this.missionId, records);
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
				confidence: 0,
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
		void this.persistCandidateRecords().catch((error) =>
			log.error('Candidate persistence failed', error)
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
		void this.persistCandidateRecords().catch((error) =>
			log.error('Candidate persistence failed', error)
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
		void this.persistCandidateRecords().catch((error) =>
			log.error('Candidate persistence failed', error)
		);
	}

	resolveDuplicate(id: string, action: 'keep_new' | 'use_existing' | 'review'): void {
		this._candidates = this._candidates.map((candidate) =>
			candidate.id === id
				? {
						...candidate,
						duplicateExistingItemId:
							action === 'use_existing' ? candidate.duplicateExistingItemId : null,
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
		void this.persistCandidateRecords();
	}

	acceptHighConfidence(): void {
		this.acceptReadyCandidates();
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
				const payload = {
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
				};
				const requestHash = JSON.stringify(payload);
				await bulkMissionDb.saveOutbox({
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
					candidate.status = response.status === 'complete' ? 'submitted' : 'needs_review';
					hasPartial ||= response.status !== 'complete';
					await bulkMissionDb.saveOutbox({
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
				} catch (error) {
					hasPartial = true;
					candidate.status = 'needs_review';
					this._error = `Submission for ${candidate.name} failed; other candidates continued.`;
					await bulkMissionDb.saveOutbox({
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
				}
				this._submissionProgress = {
					current: i + 1,
					total: accepted.length,
					message: `Submitted ${i + 1} of ${accepted.length}...`,
				};
			}
			this._status = hasPartial ? 'reviewing' : 'complete';
			await this.persistMission();
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
				schemaVersion: 2,
				id: this.missionId,
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
				outboxOperationIds: [],
				chunkSize: 6,
				lastError: this._error ? { code: 'WORKFLOW', message: this._error, retryable: true } : null,
				rawTranscript: this._rawTranscriptText,
				canonicalTranscript: this._rawTranscriptText,
				editedTranscript: this._editedTranscriptText,
				transcriptEdited: this._transcriptEdited,
				transcriptSource: this._transcriptSource,
			});
		} catch (error) {
			log.warn('Bulk mission persistence failed', error);
		}
	}
}

export const bulkSweepWorkflow = new BulkSweepWorkflow();
