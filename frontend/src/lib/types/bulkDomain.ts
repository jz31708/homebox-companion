/** Durable, identity-safe contracts for the final Bulk Sweep workflow. */
export type BulkReviewTier = 'ready' | 'attention' | 'blocked';
export type BulkEntityMode = 'individual' | 'grouped' | 'kit';
export type BulkQuantityBasis =
	'explicit_count' | 'distinct_entities' | 'pack_size' | 'user_confirmed' | 'unknown';
export type BulkCandidateState =
	| 'proposed'
	| 'ready'
	| 'needs_review'
	| 'blocked'
	| 'accepted'
	| 'rejected'
	| 'submitting'
	| 'item_created'
	| 'attachments_partial'
	| 'submitted'
	| 'failed';

export interface BulkStructuredError {
	code: string;
	message: string;
	retryable: boolean;
	details?: Record<string, unknown>;
}

export interface BulkMissionRecord {
	schemaVersion: 1;
	id: string;
	status: string;
	locationId: string;
	parentItemId: string | null;
	areaLabel: string;
	photoIds: string[];
	audioSegmentIds: string[];
	transcriptSpanIds: string[];
	observationChunkIds: string[];
	candidateIds: string[];
	outboxOperationIds: string[];
	chunkSize: number;
	lastError: BulkStructuredError | null;
}

export interface BulkPhotoRecord {
	schemaVersion: 1;
	missionId: string;
	id: string;
	status: 'persisting' | 'ready' | 'ignored' | 'observing' | 'observed' | 'failed';
	blob: Blob;
	thumbnailBlob?: Blob;
	filename: string;
	mimeType: string;
	byteSize: number;
	takenAtMs: number;
	sessionOffsetMs: number;
	note: string;
	groupLabel: string;
	ignored: boolean;
	captureSequence: number;
	error?: BulkStructuredError | null;
}

export interface BulkAudioRecord {
	schemaVersion: 1;
	missionId: string;
	id: string;
	status: 'recording' | 'persisted' | 'transcribing' | 'done' | 'failed' | 'ignored';
	blob: Blob;
	mimeType: string;
	byteSize: number;
	startedAtMs: number;
	endedAtMs: number;
	rawTranscript: string;
	error: BulkStructuredError | null;
	retryCount: number;
}

export interface BulkTranscriptSpanRecord {
	schemaVersion: 1;
	missionId: string;
	id: string;
	sourceAudioSegmentId: string | null;
	text: string;
	startOffsetMs: number | null;
	endOffsetMs: number | null;
	source: 'server' | 'live_preview' | 'manual';
	canonical: boolean;
}

export interface BulkEvidenceRefRecord {
	photoId?: string;
	transcriptSpanId?: string;
	quote?: string;
	reason?: string;
}

export interface BulkObservationRecord {
	schemaVersion: 1;
	missionId: string;
	id: string;
	photoIds: string[];
	transcriptSpanIds: string[];
	name: string;
	evidence: BulkEvidenceRefRecord[];
}

export interface BulkObservationChunkRecord {
	schemaVersion: 1;
	missionId: string;
	id: string;
	status: 'pending' | 'uploading' | 'analyzing' | 'complete' | 'failed' | 'cancelled';
	photoIds: string[];
	transcriptSpanIds: string[];
	requestHash: string;
	observations: BulkObservationRecord[];
	error: BulkStructuredError | null;
}

export interface BulkDuplicateMatchRecord {
	existingItemId: string;
	matchKind: string;
	reasons: string[];
}

export interface BulkCandidateRecord {
	schemaVersion: 1;
	missionId: string;
	id: string;
	state: BulkCandidateState;
	reviewTier: BulkReviewTier;
	name: string;
	quantity: number;
	entityMode: BulkEntityMode;
	quantityBasis: BulkQuantityBasis;
	sourceObservationIds: string[];
	evidencePhotoIds: string[];
	evidenceTranscriptSpanIds: string[];
	blockerCodes: string[];
	warningCodes: string[];
	duplicateMatches: BulkDuplicateMatchRecord[];
	createdHomeboxItemId: string | null;
}

export interface BulkOutboxOperationRecord {
	schemaVersion: 1;
	missionId: string;
	id: string;
	candidateId: string;
	requestHash: string;
	status: 'pending' | 'sending' | 'item_created' | 'partial' | 'complete' | 'failed';
	evidencePhotoIds: string[];
	homeboxItemId: string | null;
	lastError: BulkStructuredError | null;
}
