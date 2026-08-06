import type { BulkTranscriptSpanRecord } from '$lib/types/bulkDomain';

const DB_NAME = 'hbc-bulk-missions';
const DB_VERSION = 2;

interface DetailedProviderSegment {
	text: string;
	start_offset_ms: number;
	end_offset_ms: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
		transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
	});
}

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Bulk database could not open'));
		request.onupgradeneeded = () => {
			request.transaction?.abort();
			reject(new Error('Bulk database schema is unavailable'));
		};
	});
}

function spanId(audioSegmentId: string, index: number): string {
	return `server:${audioSegmentId}:${String(index).padStart(3, '0')}`;
}

function storeKey(missionId: string, id: string): string {
	return `${missionId}:${id}`;
}

export async function replaceDetailedServerSpans(input: {
	missionId: string;
	audioSegmentId: string;
	audioStartMs: number;
	audioEndMs: number;
	segments: DetailedProviderSegment[];
}): Promise<BulkTranscriptSpanRecord[]> {
	const duration = Math.max(0, input.audioEndMs - input.audioStartMs);
	const normalized = input.segments
		.map((segment) => ({
			text: segment.text.trim(),
			start: segment.start_offset_ms,
			end: segment.end_offset_ms,
		}))
		.filter(
			(segment) =>
				segment.text &&
				Number.isFinite(segment.start) &&
				Number.isFinite(segment.end) &&
				segment.start >= 0 &&
				segment.end >= segment.start
		)
		.map((segment, index): BulkTranscriptSpanRecord => ({
			schemaVersion: 2,
			missionId: input.missionId,
			id: spanId(input.audioSegmentId, index),
			sourceAudioSegmentId: input.audioSegmentId,
			text: segment.text,
			startOffsetMs: input.audioStartMs + Math.min(duration, segment.start),
			endOffsetMs: input.audioStartMs + Math.min(duration, segment.end),
			source: 'server',
			canonical: false,
		}));

	const db = await openDatabase();
	const transaction = db.transaction(['spans', 'missions'], 'readwrite');
	const done = transactionDone(transaction);
	try {
		const spanStore = transaction.objectStore('spans');
		const allKeys = await requestResult(spanStore.getAllKeys());
		const prefix = storeKey(input.missionId, `server:${input.audioSegmentId}:`);
		const removedIds: string[] = [];
		for (const key of allKeys) {
			const value = String(key);
			if (!value.startsWith(prefix)) continue;
			removedIds.push(value.slice(`${input.missionId}:`.length));
			spanStore.delete(key);
		}
		for (const span of normalized) spanStore.put(span, storeKey(input.missionId, span.id));

		const missionStore = transaction.objectStore('missions');
		const mission = (await requestResult(missionStore.get(input.missionId))) as
			| { transcriptSpanIds?: string[]; updatedAtMs?: number }
			| undefined;
		if (!mission) throw new Error('Bulk mission is not durable');
		mission.transcriptSpanIds = [
			...(mission.transcriptSpanIds ?? []).filter((id) => !removedIds.includes(id)),
			...normalized.map((span) => span.id),
		].filter((id, index, values) => values.indexOf(id) === index);
		mission.updatedAtMs = Date.now();
		missionStore.put(mission, input.missionId);
		await done;
		return normalized;
	} catch (error) {
		try {
			transaction.abort();
		} catch {
			// Transaction may already be complete or aborted.
		}
		throw error;
	} finally {
		db.close();
	}
}
