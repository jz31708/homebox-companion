import type { BulkCapturedPhoto, BulkTranscriptSpan } from '$lib/types';
import { captureMetadataFor } from '$lib/services/bulkCaptureMetadata';
import {
	planTimelineChunks,
	type PlannedTimelineChunk,
} from '$lib/shared/ingestionCaptureCore';

export type BulkPlannedChunk = PlannedTimelineChunk;

const plannedChunks = new Map<string, BulkPlannedChunk>();

export function getPlannedBulkObservationChunk(id: string): BulkPlannedChunk | null {
	return plannedChunks.get(id) ?? null;
}

export function clearPlannedBulkObservationChunks(missionId?: string): void {
	for (const [id] of plannedChunks) {
		if (!missionId || id.startsWith(`${missionId}:chunk:`)) plannedChunks.delete(id);
	}
}

export function planBulkObservationChunks(
	missionId: string,
	photos: BulkCapturedPhoto[],
	spans: BulkTranscriptSpan[],
	primaryChunkSize = 6
): BulkPlannedChunk[] {
	clearPlannedBulkObservationChunks(missionId);
	const detailedSourceIds = new Set(
		spans
			.filter((span) => /:([0-9]{3})$/.test(span.id) && span.sourceAudioSegmentId)
			.map((span) => span.sourceAudioSegmentId as string)
	);
	const contextSpans = spans.filter(
		(span) =>
			!span.sourceAudioSegmentId ||
			!detailedSourceIds.has(span.sourceAudioSegmentId) ||
			/:([0-9]{3})$/.test(span.id)
	);
	const plans = planTimelineChunks(
		missionId,
		photos.map((photo, index) => {
			const metadata = captureMetadataFor(photo.id);
			return {
				id: photo.id,
				index,
				captureSequence: metadata?.captureSequence ?? index,
				takenAtMs: metadata?.takenAtMs ?? photo.takenAtMs ?? null,
				sessionOffsetMs: metadata?.sessionOffsetMs ?? photo.sessionOffsetMs,
				note: photo.note,
				groupLabel: photo.groupLabel,
				ignored: photo.ignored,
			};
		}),
		contextSpans.map((span) => ({
			id: span.id,
			text: span.text,
			startMs: span.startMs ?? span.startOffsetMs ?? null,
			endMs: span.endMs ?? span.endOffsetMs ?? null,
			sourceAudioSegmentId: span.sourceAudioSegmentId ?? null,
		})),
		primaryChunkSize
	);
	for (const plan of plans) plannedChunks.set(plan.id, plan);
	return plans;
}
