import type { BulkCapturedPhoto, BulkTranscriptSpan } from '$lib/types';
import {
	planTimelineChunks,
	type PlannedTimelineChunk,
} from '$lib/shared/ingestionCaptureCore';

export interface BulkPlannedChunk extends PlannedTimelineChunk {}

export function planBulkObservationChunks(
	missionId: string,
	photos: BulkCapturedPhoto[],
	spans: BulkTranscriptSpan[],
	primaryChunkSize = 6
): BulkPlannedChunk[] {
	return planTimelineChunks(
		missionId,
		photos.map((photo, index) => ({
			id: photo.id,
			index,
			captureSequence: photo.captureSequence ?? index,
			takenAtMs: photo.takenAtMs ?? null,
			sessionOffsetMs: photo.sessionOffsetMs,
			note: photo.note,
			groupLabel: photo.groupLabel,
			ignored: photo.ignored,
		})),
		spans.map((span) => ({
			id: span.id,
			text: span.text,
			startMs: span.startMs ?? span.startOffsetMs ?? null,
			endMs: span.endMs ?? span.endOffsetMs ?? null,
			sourceAudioSegmentId: span.sourceAudioSegmentId ?? null,
		})),
		primaryChunkSize
	);
}
