import type { BulkCapturedPhoto, BulkTranscriptSpan } from '$lib/types';

export interface BulkPlannedChunk {
	id: string;
	photoIds: string[];
	transcriptSpanIds: string[];
	requestHash: string;
}

export function planBulkObservationChunks(
	missionId: string,
	photos: BulkCapturedPhoto[],
	spans: BulkTranscriptSpan[],
	chunkSize = 8
): BulkPlannedChunk[] {
	if (chunkSize < 6 || chunkSize > 8)
		throw new Error('Bulk observation chunk size must be between 6 and 8');
	const active = photos
		.map((photo, index) => ({ photo, index }))
		.filter(({ photo }) => !photo.ignored)
		.sort((a, b) => a.index - b.index);
	const chunks: BulkPlannedChunk[] = [];
	for (let offset = 0; offset < active.length; offset += chunkSize) {
		const selected = active.slice(offset, offset + chunkSize);
		const start = Math.min(...selected.map(({ photo }) => photo.sessionOffsetMs));
		const end = Math.max(...selected.map(({ photo }) => photo.sessionOffsetMs));
		const transcriptSpanIds = spans
			.filter(
				(span) =>
					span.startMs === undefined ||
					Math.abs((span.startMs ?? 0) - start) <= 45_000 ||
					Math.abs((span.startMs ?? 0) - end) <= 45_000
			)
			.map((span) => span.id);
		const photoIds = selected.map(({ photo }) => photo.id);
		const canonical = JSON.stringify({ missionId, photoIds, transcriptSpanIds });
		chunks.push({
			id: `${missionId}:chunk:${offset / chunkSize}`,
			photoIds,
			transcriptSpanIds,
			requestHash: canonical,
		});
	}
	return chunks;
}
