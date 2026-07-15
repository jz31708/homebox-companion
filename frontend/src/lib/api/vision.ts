/**
 * Vision AI API endpoints
 */

import { request, requestFormData } from './client';
import { getIsDemoMode, fieldPreferences } from './settings';
import { apiLogger as log } from '../utils/logger';
import type {
	DetectionResponse,
	AdvancedItemDetails,
	MergedItemResponse,
	CorrectionResponse,
	MergeItem,
	BulkCapturedPhoto,
	BulkDetectResponse,
	BulkTranscriptSpan,
	MedicineCapturedPhoto,
	MedicineDetectResponse,
} from '../types';

export interface DetectOptions {
	singleItem?: boolean;
	extraInstructions?: string;
	extractExtendedFields?: boolean;
	additionalImages?: File[];
	signal?: AbortSignal;
}

export interface AnalyzeOptions {
	signal?: AbortSignal;
}

export interface MergeOptions {
	signal?: AbortSignal;
}

export interface CorrectOptions {
	signal?: AbortSignal;
}

export interface BulkDetectOptions {
	signal?: AbortSignal;
}

export interface BulkDetectInput {
	photos: BulkCapturedPhoto[];
	allPhotos: BulkCapturedPhoto[];
	locationId: string | null;
	locationName: string | null;
	locationPath: string | null;
	parentItemId: string | null;
	editedTranscript: string;
	transcriptSpans: BulkTranscriptSpan[];
	photoIds?: string[];
}

export interface MedicineDetectOptions {
	signal?: AbortSignal;
}

export interface MedicineDetectInput {
	photos: MedicineCapturedPhoto[];
	allPhotos: MedicineCapturedPhoto[];
	locationId: string | null;
	locationName: string | null;
	locationPath: string | null;
	note: string;
	barcodeText: string;
	expiryDate: string;
	openedDate: string;
	remainingDoses: number | null;
	remainingDoseLabel: 'full' | 'half' | 'low' | 'empty' | 'unknown';
}

export interface MedicineLookupInput {
	barcodeText: string;
	note: string;
	expiryDate: string;
	openedDate: string;
	remainingDoses: number | null;
	remainingDoseLabel: 'full' | 'half' | 'low' | 'empty' | 'unknown';
}

/**
 * Build headers for vision API requests.
 * In demo mode, includes field preferences for AI customization.
 */
async function buildVisionHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = {};

	// Add field preferences header in demo mode
	if (getIsDemoMode()) {
		try {
			const prefs = await fieldPreferences.get();
			headers['X-Field-Preferences'] = JSON.stringify(prefs);
			log.debug('Added field preferences header for demo mode');
		} catch (error) {
			// Silently ignore - preferences are optional
			log.debug('Failed to load field preferences for header:', error);
		}
	}

	return headers;
}

export const vision = {
	/**
	 * Detect items from a single image
	 */
	detect: async (image: File, options: DetectOptions = {}): Promise<DetectionResponse> => {
		log.debug(`Preparing detection request: file=${image.name}, size=${image.size} bytes`);
		log.debug(
			`Options: singleItem=${options.singleItem ?? false}, extractExtendedFields=${options.extractExtendedFields ?? true}, additionalImages=${options.additionalImages?.length ?? 0}`
		);

		const formData = new FormData();
		formData.append('image', image);

		if (options.singleItem !== undefined) {
			formData.append('single_item', String(options.singleItem));
		}
		if (options.extraInstructions) {
			formData.append('extra_instructions', options.extraInstructions);
			log.debug(
				`Extra instructions: ${options.extraInstructions.substring(0, 100)}${options.extraInstructions.length > 100 ? '...' : ''}`
			);
		}
		if (options.extractExtendedFields !== undefined) {
			formData.append('extract_extended_fields', String(options.extractExtendedFields));
		}
		if (options.additionalImages) {
			for (const img of options.additionalImages) {
				formData.append('additional_images', img);
			}
		}

		const headers = await buildVisionHeaders();
		log.info('Sending vision/detect request to backend');
		return requestFormData<DetectionResponse>('/tools/vision/detect', formData, {
			errorMessage: 'Detection failed',
			signal: options.signal,
			headers,
		});
	},

	/**
	 * Analyze multiple images to extract detailed item information
	 */
	analyze: async (
		images: File[],
		itemName: string,
		itemDescription?: string,
		options: AnalyzeOptions = {}
	): Promise<AdvancedItemDetails> => {
		log.debug(`Preparing analysis request: item="${itemName}", images=${images.length}`);

		const formData = new FormData();
		for (const img of images) {
			formData.append('images', img);
		}
		formData.append('item_name', itemName);
		if (itemDescription) {
			formData.append('item_description', itemDescription);
		}

		const headers = await buildVisionHeaders();
		log.info(`Sending vision/analyze request for "${itemName}" to backend`);
		return requestFormData<AdvancedItemDetails>('/tools/vision/analyze', formData, {
			errorMessage: 'Analysis failed',
			signal: options.signal,
			headers,
		});
	},

	/**
	 * Merge multiple items into a single consolidated item using AI
	 */
	merge: async (
		itemsToMerge: MergeItem[],
		options: MergeOptions = {}
	): Promise<MergedItemResponse> => {
		log.debug(`Preparing merge request: ${itemsToMerge.length} items`);

		const headers = await buildVisionHeaders();
		log.info(`Sending vision/merge request for ${itemsToMerge.length} items to backend`);
		return request<MergedItemResponse>('/tools/vision/merge', {
			method: 'POST',
			body: JSON.stringify({ items: itemsToMerge }),
			signal: options.signal,
			headers,
		});
	},

	/**
	 * Correct an item based on user feedback
	 */
	correct: async (
		image: File,
		currentItem: MergeItem,
		correctionInstructions: string,
		options: CorrectOptions = {}
	): Promise<CorrectionResponse> => {
		log.debug(`Preparing correction request: item="${currentItem.name}"`);
		log.debug(
			`Correction instructions: ${correctionInstructions.substring(0, 100)}${correctionInstructions.length > 100 ? '...' : ''}`
		);

		const formData = new FormData();
		formData.append('image', image);
		formData.append('current_item', JSON.stringify(currentItem));
		formData.append('correction_instructions', correctionInstructions);

		const headers = await buildVisionHeaders();
		log.info(`Sending vision/correct request for "${currentItem.name}" to backend`);
		return requestFormData<CorrectionResponse>('/tools/vision/correct', formData, {
			errorMessage: 'Correction failed',
			signal: options.signal,
			headers,
		});
	},

	bulkDetect: async (
		input: BulkDetectInput,
		options: BulkDetectOptions = {}
	): Promise<BulkDetectResponse> => {
		const formData = new FormData();
		for (const photo of input.photos) {
			formData.append('images', photo.file);
		}
		formData.append(
			'session_meta',
			JSON.stringify({
				locationId: input.locationId,
				locationName: input.locationName,
				locationPath: input.locationPath,
				parentItemId: input.parentItemId,
				photos: input.allPhotos.map((photo, index) => ({
					id: photo.id,
					index,
					takenAtMs: photo.takenAtMs,
					sessionOffsetMs: photo.sessionOffsetMs,
					note: photo.note,
					groupLabel: photo.groupLabel,
					ignored: photo.ignored,
				})),
				photoIds: input.photoIds,
			})
		);
		formData.append('edited_transcript', input.editedTranscript);
		formData.append('transcript_spans', JSON.stringify(input.transcriptSpans));
		formData.append(
			'options',
			JSON.stringify({
				extractExtendedFields: true,
				includeLowConfidence: true,
			})
		);

		const headers = await buildVisionHeaders();
		return requestFormData<BulkDetectResponse>('/tools/vision/bulk-detect', formData, {
			errorMessage: 'Bulk analysis failed',
			signal: options.signal,
			headers,
			timeout: 180_000,
		});
	},

	medicineDetect: async (
		input: MedicineDetectInput,
		options: MedicineDetectOptions = {}
	): Promise<MedicineDetectResponse> => {
		const formData = new FormData();
		for (const photo of input.photos) {
			formData.append('images', photo.file);
		}
		formData.append(
			'session_meta',
			JSON.stringify({
				locationId: input.locationId,
				locationName: input.locationName,
				locationPath: input.locationPath,
				photos: input.allPhotos.map((photo, index) => ({
					id: photo.id,
					index,
					kind: photo.kind,
					takenAtMs: photo.takenAtMs,
					sessionOffsetMs: photo.sessionOffsetMs,
					note: photo.note,
					groupLabel: photo.groupLabel,
					ignored: photo.ignored,
				})),
			})
		);
		formData.append(
			'user_context',
			JSON.stringify({
				note: input.note,
				barcodeText: input.barcodeText,
				expiryDate: input.expiryDate,
				openedDate: input.openedDate,
				remainingDoses: input.remainingDoses,
				remainingDoseLabel: input.remainingDoseLabel,
			})
		);

		const headers = await buildVisionHeaders();
		return requestFormData<MedicineDetectResponse>('/tools/vision/medicine-detect', formData, {
			errorMessage: 'Medicine analysis failed',
			signal: options.signal,
			headers,
			timeout: 180_000,
		});
	},

	medicineLookup: async (
		input: MedicineLookupInput,
		options: MedicineDetectOptions = {}
	): Promise<MedicineDetectResponse> => {
		const headers = await buildVisionHeaders();
		return request<MedicineDetectResponse>('/tools/vision/medicine-lookup', {
			method: 'POST',
			body: JSON.stringify(input),
			signal: options.signal,
			headers,
			timeout: 60_000,
		});
	},
};
