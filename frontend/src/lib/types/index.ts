/**
 * Consolidated type definitions for Homebox Companion
 *
 * This file contains all shared types organized by domain:
 * - Domain models (Location, Tag, Item)
 * - API types (requests/responses)
 * - Workflow types (scan workflow state)
 */

// =============================================================================
// DOMAIN MODELS
// =============================================================================

/** Homebox group (collection) - the multi-tenancy unit */
export interface Group {
	id: string;
	name: string;
	currency: string;
	createdAt?: string;
	updatedAt?: string;
}

/** Location in Homebox hierarchy */
export interface Location {
	id: string;
	name: string;
	description?: string;
	itemCount?: number;
	children?: Location[];
}

/** Location tree node (always has children array) */
export interface LocationTreeNode extends Location {
	children: Location[];
}

/** Tag for categorizing items */
export interface Tag {
	id: string;
	name: string;
	description?: string;
	color?: string;
}

/** Item summary for selection/listing (lightweight) */
export interface ItemSummary {
	id: string;
	name: string;
	quantity: number;
	thumbnailId?: string | null;
}

/** Core item fields shared across all item types */
export interface ItemCore {
	name: string;
	quantity: number;
	description?: string | null;
	tag_ids?: string[] | null;
}

/** Extended item fields (manufacturer, model, etc.) */
export interface ItemExtended {
	manufacturer?: string | null;
	model_number?: string | null;
	serial_number?: string | null;
	purchase_price?: number | null;
	purchase_from?: string | null;
	notes?: string | null;
	/** Custom asset ID (for pre-printed QR codes) */
	asset_id?: string | null;
}

/** Complete item with all fields */
export interface Item extends ItemCore, ItemExtended {
	id?: string;
	location_id?: string | null;
}

// =============================================================================
// WORKFLOW TYPES - Scan Flow
// =============================================================================

/** Image captured for analysis */
export interface CapturedImage {
	file: File;
	/**
	 * URL for displaying preview thumbnail in UI.
	 * This is typically an Object URL (blob:...) for memory efficiency.
	 * Object URLs are much smaller than base64 data URLs since they
	 * reference the existing File blob instead of duplicating it.
	 * Note: This is NOT used for submission - we use compressedDataUrl or originalFile instead.
	 */
	dataUrl: string;
	/** If true, AI should detect multiple items in this image */
	separateItems: boolean;
	/** Optional instructions for AI about this image */
	extraInstructions: string;
	/** Additional images showing the same item from different angles */
	additionalFiles?: File[];
	/** Object URLs for displaying additional image previews in UI */
	additionalDataUrls?: string[];
	/** Custom asset ID from pre-printed QR codes */
	assetId?: string | null;
}

/** Thumbnail editor transform state */
export interface ThumbnailTransform {
	scale: number;
	rotation: number;
	offsetX: number;
	offsetY: number;
	sourceImageIndex: number;
	dataUrl: string | null;
}

/** Item detected by AI, ready for review */
export interface ReviewItem extends ItemCore, ItemExtended {
	/** Index of the source image in capturedImages array */
	sourceImageIndex: number;
	/** Additional images for this specific item */
	additionalImages?: File[];
	/** Reference to original file for attachment upload */
	originalFile?: File;
	/** Custom cropped thumbnail data URL */
	customThumbnail?: string;
	/** Thumbnail editor transform state for restoring edits */
	thumbnailTransform?: ThumbnailTransform;
	/** Compressed image data URL for Homebox upload (replaces originalFile after analysis) */
	compressedDataUrl?: string;
	/** Compressed additional images for Homebox upload */
	compressedAdditionalDataUrls?: string[];
	/** Custom field values extracted by AI (display name → text value) */
	custom_fields?: Record<string, string> | null;
	/** Duplicate match info if serial matches an existing item */
	duplicate_match?: DuplicateMatch | null;
}

/** Item confirmed by user, ready for submission */
export interface ConfirmedItem extends ReviewItem {
	confirmed: true;
}

/** Status of the scan workflow */
export type ScanStatus =
	| 'idle' // No active scan
	| 'location' // Selecting location
	| 'capturing' // Adding/configuring images
	| 'analyzing' // AI processing (async)
	| 'partial_analysis' // Analysis complete with some failures
	| 'reviewing' // Editing detected items
	| 'confirming' // Summary before submit
	| 'submitting' // Creating items in Homebox
	| 'complete'; // Success

/** Status of individual item submission */
export type ItemSubmissionStatus =
	'pending' | 'creating' | 'success' | 'partial_success' | 'failed';

/** Status of individual image analysis */
export type ImageAnalysisStatus = 'pending' | 'analyzing' | 'success' | 'failed';

/** Progress for async operations */
export interface Progress {
	current: number;
	total: number;
	message?: string;
}

/** Result of the last successful submission (for success page display) */
export interface SubmissionResult {
	itemCount: number;
	photoCount: number;
	tagCount: number;
	itemNames: string[];
	locationName: string;
	locationId: string;
	/** Created items with ID, name, thumbnail, and tags (for success screen modals) */
	createdItems: Array<{ id: string; name: string; thumbnail?: string; tag_ids?: string[] }>;
}

/** Complete scan workflow state */
export interface ScanState {
	status: ScanStatus;
	// Location
	locationId: string | null;
	locationName: string | null;
	locationPath: string | null;
	// Parent Item (for sub-item relationships)
	parentItemId: string | null;
	parentItemName: string | null;
	// Capture
	images: CapturedImage[];
	// Analysis
	analysisProgress: Progress | null;
	/** Per-image analysis status for UI feedback */
	imageStatuses: Record<number, ImageAnalysisStatus>;
	// Review
	detectedItems: ReviewItem[];
	currentReviewIndex: number;
	// Confirmation
	confirmedItems: ConfirmedItem[];
	// Submission
	submissionProgress: Progress | null;
	/** Per-item submission status for UI feedback */
	itemStatuses: Record<number, ItemSubmissionStatus>;
	/** Result of last successful submission (preserved for success page) */
	lastSubmissionResult: SubmissionResult | null;
	/** Error messages from the last submission attempt (for displaying specific failure reasons) */
	submissionErrors: string[];
	// Error handling
	error: string | null;
}

// =============================================================================
// WORKFLOW TYPES - Bulk Sweep Flow
// =============================================================================

export type BulkTranscriptSource = 'none' | 'live' | 'server' | 'manual' | 'mixed';
export type BulkTranscriptStatus = 'pending' | 'transcribing' | 'done' | 'failed';
export type BulkCandidateStatus = 'pending' | 'accepted' | 'rejected' | 'needs_review';

export type BulkSweepStatus =
	| 'idle'
	| 'capturing'
	| 'transcript_review'
	| 'analyzing'
	| 'reviewing'
	| 'submitting'
	| 'complete';

export interface BulkCapturedPhoto {
	id: string;
	file: File;
	previewUrl: string;
	takenAtMs: number;
	sessionOffsetMs: number;
	note: string;
	groupLabel: string;
	ignored: boolean;
}

export interface BulkAudioSegment {
	id: string;
	file: Blob;
	mimeType: string;
	startedAtMs: number;
	endedAtMs: number;
	transcript?: string;
	rawTranscript?: string;
	transcriptStatus: BulkTranscriptStatus;
}

export interface BulkTranscriptSpan {
	id: string;
	text: string;
	startMs?: number;
	endMs?: number;
	sourceAudioSegmentId?: string;
}

export interface BulkEvidenceRef {
	photoId?: string;
	photoIndex?: number;
	transcriptSpanId?: string;
	quote?: string;
	reason?: string;
}

export interface BulkCandidateItem extends ItemCore, ItemExtended {
	id: string;
	custom_fields?: Record<string, string> | null;
	confidence: number;
	status: BulkCandidateStatus;
	evidence: BulkEvidenceRef[];
	sourcePhotoIds: string[];
	uncertaintyReasons: string[];
	duplicateCandidateIds: string[];
	duplicateExistingItemId?: string | null;
	suggestedAction: 'accept' | 'review' | 'reject' | 'merge';
	originalFiles?: File[];
	compressedDataUrls?: string[];
}

export interface BulkAnalysisStats {
	photo_count: number;
	ignored_photo_count: number;
	candidate_count: number;
	low_confidence_count: number;
}

export interface BulkDetectResponse {
	candidates: BulkCandidateItem[];
	warnings: string[];
	stats: BulkAnalysisStats;
}

export interface BulkSweepState {
	status: BulkSweepStatus;
	locationId: string | null;
	locationName: string | null;
	locationPath: string | null;
	parentItemId: string | null;
	parentItemName: string | null;
	startedAtMs: number | null;
	photos: BulkCapturedPhoto[];
	audioSegments: BulkAudioSegment[];
	transcriptSpans: BulkTranscriptSpan[];
	rawTranscriptText: string;
	interimTranscriptText: string;
	editedTranscriptText: string;
	transcriptEdited: boolean;
	transcriptSource: BulkTranscriptSource;
	candidates: BulkCandidateItem[];
	analysisProgress: Progress | null;
	submissionProgress: Progress | null;
	error: string | null;
	warnings: string[];
	stats: BulkAnalysisStats | null;
}

export type MedicinePhotoKind = 'front' | 'barcode' | 'expiry' | 'doses' | 'notice' | 'other';
export type MedicineIntakeStatus =
	'idle' | 'capturing' | 'analyzing' | 'reviewing' | 'submitting' | 'complete';

export type MedicineMissionKind =
	'medicine_intake' | 'room_sweep' | 'single_item' | 'pack_travel' | 'find_homebox';

export type MedicineCandidateState =
	| 'captured'
	| 'analyzing'
	| 'needs_review'
	| 'blocked'
	| 'ready'
	| 'submitted'
	| 'failed'
	| 'recovered';

export interface MedicineCapturedPhoto extends BulkCapturedPhoto {
	kind: MedicinePhotoKind;
}

export interface MedicineDatabaseMatch {
	source: 'bdpm' | 'api-medicaments-fr' | 'manual' | 'none';
	query?: string | null;
	cis?: string | null;
	cip13?: string | null;
	denomination?: string | null;
	form?: string | null;
	activeSubstances?: string[];
	generalUse?: string | null;
	officialPageUrl?: string | null;
	noticeUrl?: string | null;
	rcpUrl?: string | null;
	confidence: number;
	raw?: unknown;
}

export interface MedicineCandidate extends ItemCore, ItemExtended {
	id: string;
	activeIngredient?: string | null;
	strength?: string | null;
	form?: string | null;
	packageSize?: string | null;
	expiryDate?: string | null;
	openedDate?: string | null;
	remainingDoses?: number | null;
	remainingDoseLabel?: 'full' | 'half' | 'low' | 'empty' | 'unknown' | null;
	storage?: string | null;
	cip13?: string | null;
	cis?: string | null;
	generalUse?: string | null;
	officialPageUrl?: string | null;
	noticeUrl?: string | null;
	rcpUrl?: string | null;
	confidence: number;
	uncertaintyReasons: string[];
	databaseMatch?: MedicineDatabaseMatch | null;
	sourcePhotoIds: string[];
	custom_fields?: Record<string, string> | null;
	originalFiles?: File[];
}

export interface MedicineDetectResponse {
	candidate: MedicineCandidate;
	warnings: string[];
}

export interface MedicineQueuedScan {
	id: string;
	missionId: string;
	missionKind: MedicineMissionKind;
	code: string;
	status: MedicineCandidateState;
	createdAtMs: number;
	updatedAtMs: number;
	inputSnapshot: MedicineDraftInputSnapshot;
	selectedLocationId: string | null;
	selectedLocationPath: string | null;
	evidencePhotoIds: string[];
	userNote: string;
	aiSummary?: string | null;
	correctionHistory: Array<{ atMs: number; fields: string[] }>;
	confidence: number | null;
	blockerReasons: string[];
	duplicateSuspicions: string[];
	homeboxPayloadPreview?: BatchCreateRequest | null;
	candidate?: MedicineCandidate | null;
	error?: string | null;
	warnings?: string[];
}

export interface MedicineDraftInputSnapshot {
	barcodeText: string;
	expiryDate: string;
	openedDate: string;
	remainingDoses: number | null;
	remainingDoseLabel: 'full' | 'half' | 'low' | 'empty' | 'unknown';
	note: string;
	photoIds: string[];
	capturedAtMs: number;
}

export interface MedicineIntakeState {
	status: MedicineIntakeStatus;
	locationId: string | null;
	locationName: string | null;
	locationPath: string | null;
	startedAtMs: number | null;
	photos: MedicineCapturedPhoto[];
	note: string;
	barcodeText: string;
	expiryDate: string;
	openedDate: string;
	remainingDoses: number | null;
	remainingDoseLabel: 'full' | 'half' | 'low' | 'empty' | 'unknown';
	candidate: MedicineCandidate | null;
	queuedScans: MedicineQueuedScan[];
	activeQueueId: string | null;
	error: string | null;
	warnings: string[];
	analysisProgress: Progress | null;
	submissionProgress: Progress | null;
}

// =============================================================================
// API TYPES - Requests
// =============================================================================

/** Request to create a location */
export interface LocationCreateRequest {
	name: string;
	description?: string;
	parent_id?: string | null;
}

/** Request to update a location */
export interface LocationUpdateRequest {
	name: string;
	description?: string;
	parent_id?: string | null;
}

/** Request to create items in batch */
export interface BatchCreateRequest {
	items: ItemInput[];
	location_id?: string | null;
}

/** Item input for creation (with location) */
export interface ItemInput extends ItemCore, ItemExtended {
	location_id?: string | null;
	parent_id?: string | null;
	insured?: boolean;
	/** Custom field values (display name → text value) */
	custom_fields?: Record<string, string> | null;
}

/** Item for merge operations */
export interface MergeItem extends ItemCore, ItemExtended {}

// =============================================================================
// API TYPES - Responses
// =============================================================================

/** Compressed image from backend */
export interface CompressedImage {
	data: string; // Base64-encoded image
	mime_type: string;
}

/** Response from item detection */
export interface DetectionResponse {
	items: DetectedItem[];
	message: string;
	compressed_images: CompressedImage[];
}

/** Detected item from AI (same as ItemCore + ItemExtended) */
export interface DetectedItem extends ItemCore, ItemExtended {
	/** Custom field values extracted by AI (display name → text value) */
	custom_fields?: Record<string, string> | null;
	/** Duplicate match info if serial matches an existing item */
	duplicate_match?: DuplicateMatch | null;
}

/** Details of an existing item that matches a detected item's serial number */
export interface DuplicateMatch {
	item_id: string;
	item_name: string;
	serial_number: string;
	location_name: string | null;
}

/** Response from advanced analysis */
export interface AdvancedItemDetails {
	name?: string | null;
	description?: string | null;
	serial_number?: string | null;
	model_number?: string | null;
	manufacturer?: string | null;
	purchase_price?: number | null;
	notes?: string | null;
	tag_ids?: string[] | null;
}

/** Response from merge operation */
export interface MergedItemResponse {
	name: string;
	quantity: number;
	description?: string | null;
	tag_ids?: string[] | null;
}

/** Response from correction operation */
export interface CorrectionResponse {
	items: DetectedItem[];
	message: string;
}

/** Item successfully created in Homebox (returned from backend) */
export interface CreatedItem {
	id: string;
	name: string;
	quantity: number;
	description?: string | null;
	/** Location object with id and name */
	location?: {
		id: string;
		name?: string;
	} | null;
	/** Tags array with id and name */
	tags?: Array<{
		id: string;
		name?: string;
	}>;
	// Extended fields (may be present after update)
	manufacturer?: string | null;
	modelNumber?: string | null;
	serialNumber?: string | null;
	purchasePrice?: number | null;
	purchaseFrom?: string | null;
	notes?: string | null;
	insured?: boolean;
}

/** Response from batch item creation */
export interface BatchCreateResponse {
	/** Successfully created items */
	created: CreatedItem[];
	/** Error messages for items that failed to create */
	errors: string[];
	/** Summary message (e.g., "Created 2 items, 1 failed") */
	message: string;
}
