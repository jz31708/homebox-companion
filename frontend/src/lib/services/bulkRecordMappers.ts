import type {
	BulkAudioRecord,
	BulkCandidateRecord,
	BulkDuplicateMatchRecord,
	BulkEvidenceRefRecord,
	BulkOutboxOperationRecord,
	BulkTranscriptSpanRecord,
} from '$lib/types/bulkDomain';
import type {
	BulkAudioSegment,
	BulkCandidateItem,
	BulkCapturedPhoto,
	BulkTranscriptSpan,
} from '$lib/types';

type PhotoLookup = ReadonlyArray<BulkCapturedPhoto> | ReadonlyMap<string, BulkCapturedPhoto>;

/**
 * Turn Svelte reactive proxies into values that IndexedDB can clone.
 * Payloads are JSON-shaped, but this also preserves Blob/File/Date values if a
 * caller includes one in a future snapshot.
 */
export function deepDeproxy<T>(value: T, seen = new WeakMap<object, unknown>()): T {
	if (value === null || typeof value !== 'object') return value;
	if (value instanceof Blob || value instanceof Date) return value;
	if (typeof File !== 'undefined' && value instanceof File) return value;
	const objectValue = value as object;
	const existing = seen.get(objectValue);
	if (existing) return existing as T;
	if (Array.isArray(value)) {
		const result: unknown[] = [];
		seen.set(objectValue, result);
		for (const entry of value) result.push(deepDeproxy(entry, seen));
		return result as T;
	}
	const result: Record<string, unknown> = {};
	seen.set(objectValue, result);
	for (const key of Object.keys(value as Record<string, unknown>)) {
		result[key] = deepDeproxy((value as Record<string, unknown>)[key], seen);
	}
	return result as T;
}

function findPhoto(photos: PhotoLookup, id: string): BulkCapturedPhoto | undefined {
	if (photos instanceof Map) return photos.get(id);
	return (photos as ReadonlyArray<BulkCapturedPhoto>).find((photo) => photo.id === id);
}

function copyEvidence(ref: BulkEvidenceRefRecord): BulkEvidenceRefRecord {
	return { ...ref };
}

/** Convert the complete durable candidate without inferring fields from quantity or name. */
export function fromCandidateRecord(
	record: BulkCandidateRecord,
	photos: PhotoLookup = [],
	_spans: ReadonlyArray<BulkTranscriptSpan> = []
): BulkCandidateItem {
	const evidence = record.evidence
		? record.evidence.map(copyEvidence)
		: [
				...record.evidencePhotoIds.map((photoId) => ({ photoId })),
				...record.evidenceTranscriptSpanIds.map((transcriptSpanId) => ({ transcriptSpanId })),
			];
	const candidate = {
		id: record.id,
		name: record.name,
		quantity: record.quantity,
		description: record.description,
		tag_ids: record.tagIds,
		manufacturer: record.manufacturer,
		model_number: record.modelNumber,
		serial_number: record.serialNumber,
		purchase_price: record.purchasePrice,
		purchase_from: record.purchaseFrom,
		notes: record.notes,
		custom_fields: record.customFields,
		status: record.state,
		evidence,
		sourcePhotoIds: [...record.evidencePhotoIds],
		uncertaintyReasons: [...record.warningCodes, ...record.blockerCodes],
		duplicateCandidateIds: [...(record.duplicateCandidateIds ?? [])],
		duplicateExistingItemId: record.duplicateResolution?.existingItemId ?? null,
		reviewTier: record.reviewTier,
		entityMode: record.entityMode,
		quantityBasis: record.quantityBasis,
		sourceObservationIds: [...record.sourceObservationIds],
		evidenceTranscriptSpanIds: [...record.evidenceTranscriptSpanIds],
		blockerCodes: [...record.blockerCodes],
		warningCodes: [...record.warningCodes],
		duplicateMatches: record.duplicateMatches.map((match) => ({
			...match,
			reasons: [...match.reasons],
		})),
		duplicateResolution: record.duplicateResolution
			? { ...record.duplicateResolution }
			: record.duplicateResolution,
		createdHomeboxItemId: record.createdHomeboxItemId,
		suggestedAction:
			(record.suggestedAction as BulkCandidateItem['suggestedAction'] | undefined) ?? 'review',
		correctionHistory: record.correctionHistory?.map((entry) => ({
			...entry,
			fields: [...entry.fields],
		})),
		payloadSnapshot: record.payloadSnapshot ? deepDeproxy(record.payloadSnapshot) : null,
		originalFiles: record.evidencePhotoIds
			.map((photoId) => findPhoto(photos, photoId)?.file)
			.filter((file): file is File => Boolean(file)),
	} as BulkCandidateItem;
	if (typeof record.confidence === 'number' && Number.isFinite(record.confidence)) {
		candidate.confidence = record.confidence;
	}
	return candidate;
}

/** Convert the complete UI candidate to its durable representation. */
export function toCandidateRecord(
	candidate: BulkCandidateItem,
	missionId: string
): BulkCandidateRecord {
	const evidence = candidate.evidence.map(copyEvidence);
	return {
		schemaVersion: 2,
		missionId,
		id: candidate.id,
		state: candidate.status,
		reviewTier: candidate.reviewTier ?? 'attention',
		name: candidate.name,
		quantity: candidate.quantity,
		...(typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence)
			? { confidence: candidate.confidence }
			: {}),
		entityMode: candidate.entityMode ?? 'individual',
		quantityBasis: candidate.quantityBasis ?? 'unknown',
		sourceObservationIds: [...(candidate.sourceObservationIds ?? [])],
		evidencePhotoIds: [...candidate.sourcePhotoIds],
		evidenceTranscriptSpanIds: [
			...(candidate.evidenceTranscriptSpanIds ??
				evidence
					.filter((ref) => ref.transcriptSpanId)
					.map((ref) => ref.transcriptSpanId as string)),
		],
		evidence,
		blockerCodes: [...(candidate.blockerCodes ?? [])],
		warningCodes: [...(candidate.warningCodes ?? candidate.uncertaintyReasons)],
		duplicateCandidateIds: [...candidate.duplicateCandidateIds],
		duplicateMatches: (candidate.duplicateMatches ?? []).map((match: BulkDuplicateMatchRecord) => ({
			...match,
			reasons: [...match.reasons],
		})),
		duplicateResolution: candidate.duplicateResolution
			? { ...candidate.duplicateResolution }
			: null,
		createdHomeboxItemId: candidate.createdHomeboxItemId ?? null,
		description: candidate.description,
		tagIds: [...(candidate.tag_ids ?? [])],
		manufacturer: candidate.manufacturer,
		modelNumber: candidate.model_number,
		serialNumber: candidate.serial_number,
		purchasePrice: candidate.purchase_price,
		purchaseFrom: candidate.purchase_from,
		notes: candidate.notes,
		customFields: candidate.custom_fields ? deepDeproxy(candidate.custom_fields) : null,
		suggestedAction: candidate.suggestedAction,
		correctionHistory: candidate.correctionHistory?.map((entry) => ({
			...entry,
			fields: [...entry.fields],
		})),
		payloadSnapshot: candidate.payloadSnapshot ? deepDeproxy(candidate.payloadSnapshot) : null,
	};
}

export function fromAudioRecord(record: BulkAudioRecord): BulkAudioSegment {
	return {
		id: record.id,
		file: record.blob,
		mimeType: record.mimeType,
		startedAtMs: record.startedAtMs,
		endedAtMs: record.endedAtMs,
		transcript: record.transcript,
		rawTranscript: record.rawTranscript,
		transcriptStatus:
			record.status === 'done' ? 'done' : record.status === 'failed' ? 'failed' : 'pending',
		status: record.status,
		source: record.source,
		error: record.error,
		retryCount: record.retryCount,
		activeAttemptId: record.activeAttemptId,
		activeAttemptStartedAtMs: record.activeAttemptStartedAtMs,
		byteSize: record.byteSize,
	};
}

export function toAudioRecord(segment: BulkAudioSegment, missionId: string): BulkAudioRecord {
	return {
		schemaVersion: 2,
		missionId,
		id: segment.id,
		status: segment.status ?? (segment.transcriptStatus === 'done' ? 'done' : 'persisted'),
		blob: segment.file,
		mimeType: segment.mimeType,
		byteSize: segment.byteSize ?? segment.file.size,
		startedAtMs: segment.startedAtMs,
		endedAtMs: segment.endedAtMs,
		rawTranscript: segment.rawTranscript ?? '',
		transcript: segment.transcript,
		source: segment.source,
		error: segment.error ?? null,
		retryCount: segment.retryCount ?? 0,
		activeAttemptId: segment.activeAttemptId ?? null,
		activeAttemptStartedAtMs: segment.activeAttemptStartedAtMs ?? null,
	};
}

export function fromTranscriptSpanRecord(record: BulkTranscriptSpanRecord): BulkTranscriptSpan {
	return {
		id: record.id,
		text: record.text,
		startMs: record.startOffsetMs ?? undefined,
		endMs: record.endOffsetMs ?? undefined,
		startOffsetMs: record.startOffsetMs,
		endOffsetMs: record.endOffsetMs,
		sourceAudioSegmentId: record.sourceAudioSegmentId ?? undefined,
		source: record.source,
		canonical: record.canonical,
	};
}

export function toTranscriptSpanRecord(
	span: BulkTranscriptSpan,
	missionId: string
): BulkTranscriptSpanRecord {
	return {
		schemaVersion: 2,
		missionId,
		id: span.id,
		sourceAudioSegmentId: span.sourceAudioSegmentId ?? null,
		text: span.text,
		startOffsetMs: span.startOffsetMs ?? span.startMs ?? null,
		endOffsetMs: span.endOffsetMs ?? span.endMs ?? null,
		source: span.source ?? 'live_preview',
		canonical: span.canonical ?? true,
	};
}

export function cloneOutboxRecord(record: BulkOutboxOperationRecord): BulkOutboxOperationRecord {
	return deepDeproxy({
		...record,
		evidencePhotoIds: [...record.evidencePhotoIds],
		expectedAttachmentManifest: record.expectedAttachmentManifest
			? [...record.expectedAttachmentManifest]
			: undefined,
		attachmentResults: record.attachmentResults ? { ...record.attachmentResults } : undefined,
		lastError: record.lastError ? { ...record.lastError } : null,
		payloadSnapshot: record.payloadSnapshot ? { ...record.payloadSnapshot } : undefined,
	});
}
