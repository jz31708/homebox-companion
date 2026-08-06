const DB_NAME = 'hbc-bulk-missions';
const DB_VERSION = 2;

export interface ExactCaptureMetadata {
	captureSequence: number;
	takenAtMs: number;
	sessionOffsetMs: number;
}

const activeMetadata = new Map<string, ExactCaptureMetadata>();

function photoKey(missionId: string, photoId: string): string {
	return `${missionId}:${photoId}`;
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

export function captureMetadataFor(photoId: string): ExactCaptureMetadata | null {
	return activeMetadata.get(photoId) ?? null;
}

export function clearCaptureMetadata(photoId?: string): void {
	if (photoId) activeMetadata.delete(photoId);
	else activeMetadata.clear();
}

export async function patchCapturedPhotoTiming(input: {
	missionId: string;
	photoId: string;
	metadata: ExactCaptureMetadata;
}): Promise<void> {
	const db = await openDatabase();
	const transaction = db.transaction(['photos', 'missions'], 'readwrite');
	const done = transactionDone(transaction);
	try {
		const missions = transaction.objectStore('missions');
		const mission = (await requestResult(missions.get(input.missionId))) as
			| Record<string, unknown>
			| undefined;
		if (!mission) throw new Error('Bulk mission is not durable');
		const missionStartedAtMs = Number(mission.startedAtMs ?? input.metadata.takenAtMs);
		const missionRelativeOffsetMs = Math.max(
			0,
			input.metadata.takenAtMs - missionStartedAtMs
		);
		const normalizedMetadata: ExactCaptureMetadata = {
			...input.metadata,
			sessionOffsetMs: missionRelativeOffsetMs,
		};

		const photos = transaction.objectStore('photos');
		const record = (await requestResult(photos.get(photoKey(input.missionId, input.photoId)))) as
			| Record<string, unknown>
			| undefined;
		if (!record || record.missionId !== input.missionId) {
			throw new Error('Captured photo is not durable in the active mission');
		}
		photos.put(
			{
				...record,
				takenAtMs: normalizedMetadata.takenAtMs,
				sessionOffsetMs: normalizedMetadata.sessionOffsetMs,
				captureSequence: normalizedMetadata.captureSequence,
			},
			photoKey(input.missionId, input.photoId)
		);
		const nextSequence = Math.max(
			Number(mission.nextCaptureSequence ?? 0),
			normalizedMetadata.captureSequence + 1
		);
		missions.put(
			{
				...mission,
				nextCaptureSequence: nextSequence,
				updatedAtMs: Date.now(),
			},
			input.missionId
		);
		await done;
		activeMetadata.set(input.photoId, normalizedMetadata);
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
