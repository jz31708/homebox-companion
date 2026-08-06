import { request, requestFormData } from './client';
import { getPlannedBulkObservationChunk } from '$lib/services/bulkAnalysisPlanner';
import type { BulkCapturedPhoto, BulkTranscriptSpan } from '$lib/types';

interface BulkObserveInputLike {
	photos: BulkCapturedPhoto[];
	photoIds: string[];
	chunkId: string;
	transcriptSpans: BulkTranscriptSpan[];
	editedTranscript: string;
}

interface ObservationV2 {
	id: string;
	name: string;
	quantity?: number | null;
	entityMode?: 'individual' | 'grouped' | 'kit';
	entityKey?: string | null;
	manufacturer?: string | null;
	modelNumber?: string | null;
	serialNumber?: string | null;
	description?: string | null;
	notes?: string | null;
	photoIds: string[];
	transcriptSpanIds: string[];
	evidence: Array<{
		photoId?: string;
		transcriptSpanId?: string;
		quote?: string;
		reason?: string;
	}>;
	uncertaintyReasons?: string[];
}

interface BulkObserveResponseV2 {
	chunkId: string;
	photoIds: string[];
	observations: ObservationV2[];
	warnings: string[];
}

const observationCache = new Map<string, ObservationV2>();

function cacheKey(id: string): string {
	return `hbc-bulk-observation-v2:${id}`;
}

function remember(observation: ObservationV2): void {
	observationCache.set(observation.id, observation);
	try {
		sessionStorage.setItem(cacheKey(observation.id), JSON.stringify(observation));
	} catch {
		// In-memory cache still covers the active analysis run.
	}
}

function recall(id: string): ObservationV2 | null {
	const cached = observationCache.get(id);
	if (cached) return cached;
	try {
		const raw = sessionStorage.getItem(cacheKey(id));
		if (!raw) return null;
		const value = JSON.parse(raw) as ObservationV2;
		observationCache.set(id, value);
		return value;
	} catch {
		return null;
	}
}

function serializeSpan(span: BulkTranscriptSpan) {
	return {
		id: span.id,
		text: span.text,
		startMs: span.startMs ?? span.startOffsetMs ?? null,
		endMs: span.endMs ?? span.endOffsetMs ?? null,
		sourceAudioSegmentId: span.sourceAudioSegmentId ?? null,
	};
}

export async function bulkObserveV2(
	input: BulkObserveInputLike,
	options: { signal?: AbortSignal } = {}
): Promise<BulkObserveResponseV2> {
	const plan = getPlannedBulkObservationChunk(input.chunkId);
	if (!plan) throw new Error(`Timeline plan ${input.chunkId} is unavailable`);
	const byId = new Map(input.photos.map((photo) => [photo.id, photo]));
	const formData = new FormData();
	for (const photoId of plan.photoIds) {
		const photo = byId.get(photoId);
		if (!photo) throw new Error(`Planned photo ${photoId} is unavailable`);
		formData.append('images', photo.file);
	}
	formData.append(
		'session_meta',
		JSON.stringify({
			chunkId: plan.id,
			photoIds: plan.photoIds,
			primaryPhotoIds: plan.primaryPhotoIds,
			photos: plan.photos.map((photo) => ({
				id: photo.id,
				index: photo.index,
				captureSequence: photo.captureSequence,
				takenAtMs: photo.takenAtMs,
				sessionOffsetMs: photo.sessionOffsetMs,
				note: photo.note ?? '',
				groupLabel: photo.groupLabel ?? '',
				ignored: Boolean(photo.ignored),
				contextRole: photo.contextRole,
				localTranscriptSpanIds: photo.localTranscriptSpanIds,
			})),
			timeline: plan.timeline,
		})
	);
	formData.append('transcript_spans', JSON.stringify(input.transcriptSpans.map(serializeSpan)));
	formData.append('edited_transcript', input.editedTranscript);
	const result = await requestFormData<BulkObserveResponseV2>(
		'/tools/vision/bulk-observe-v2',
		formData,
		{
			errorMessage: 'Timeline-aware bulk observation failed',
			signal: options.signal,
			timeout: 180_000,
		}
	);
	for (const observation of result.observations) remember(observation);
	return result;
}

function enrichObservation(input: any): any {
	const full = recall(String(input.id));
	const observation = full ?? input;
	const evidence = (observation.evidence ?? []).map((ref: any) => ({
		photo_id: ref.photoId ?? ref.photo_id,
		transcript_span_id: ref.transcriptSpanId ?? ref.transcript_span_id,
		quote: ref.quote,
		reason: ref.reason,
	}));
	return {
		...input,
		id: observation.id,
		name: observation.name,
		quantity: observation.quantity,
		entity_mode: observation.entityMode ?? observation.entity_mode ?? 'individual',
		entity_key: observation.entityKey ?? observation.entity_key,
		manufacturer: observation.manufacturer,
		model_number: observation.modelNumber ?? observation.model_number,
		serial_number: observation.serialNumber ?? observation.serial_number,
		description: observation.description,
		notes: observation.notes,
		photo_ids: observation.photoIds ?? observation.photo_ids ?? input.photo_ids ?? [],
		transcript_span_ids:
			observation.transcriptSpanIds ?? observation.transcript_span_ids ?? input.transcript_span_ids ?? [],
		evidence,
		uncertainty_reasons:
			observation.uncertaintyReasons ?? observation.uncertainty_reasons ?? [],
	};
}

export async function bulkFuseV2(input: {
	missionId: string;
	observations: any[];
	transcript: string;
}): Promise<any[]> {
	return request<any[]>('/tools/vision/bulk-fuse', {
		method: 'POST',
		body: JSON.stringify({
			...input,
			observations: input.observations.map(enrichObservation),
		}),
		timeout: 180_000,
	});
}
