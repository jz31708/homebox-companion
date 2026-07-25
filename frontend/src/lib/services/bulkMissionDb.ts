import { browser } from '$app/environment';
import { deleteDB, openDB, type IDBPDatabase } from 'idb';
import type {
	BulkAudioRecord,
	BulkCandidateRecord,
	BulkMissionRecord,
	BulkObservationChunkRecord,
	BulkOutboxOperationRecord,
	BulkPhotoRecord,
	BulkTranscriptSpanRecord,
} from '$lib/types/bulkDomain';

const DB_NAME = 'hbc-bulk-missions';
const DB_VERSION = 2;
const MISSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STORES = [
	'missions',
	'photos',
	'audio',
	'spans',
	'chunks',
	'candidates',
	'outbox',
	'meta',
] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBPDatabase> | null = null;
let writeQueue = Promise.resolve();
let migrationPromise: Promise<void> | null = null;

function requireBrowser(): void {
	if (!browser) throw new Error('Bulk mission storage is only available in the browser');
}

function getDb(): Promise<IDBPDatabase> {
	requireBrowser();
	if (!dbPromise) {
			dbPromise = openDB(DB_NAME, DB_VERSION, {
			upgrade(db, oldVersion, _newVersion, transaction) {
				for (const store of STORES) {
					if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
				}
				void oldVersion;
				void transaction;
			},
		});
	}
	if (!migrationPromise) migrationPromise = dbPromise.then((db) => migrateV1Records(db));
	return dbPromise.then(async (db) => { await migrationPromise; return db; });
}

async function migrateV1Records(db: IDBPDatabase): Promise<void> {
	const marker = (await db.get('meta', 'schema')) as { recordsMigrated?: boolean } | undefined;
	if (marker?.recordsMigrated) return;
	const tx = db.transaction([...STORES], 'readwrite');
	for (const storeName of STORES) {
		const store = tx.objectStore(storeName);
		const values = (await store.getAll()) as Record<string, unknown>[];
		for (const value of values) {
			if (value.schemaVersion === 2) continue;
			if (storeName === 'missions') {
				value.createdAtMs ??= value.startedAtMs ?? Date.now();
				value.updatedAtMs ??= value.startedAtMs ?? value.createdAtMs;
				value.areaLabel ??= '';
				value.parentItemName ??= null;
				value.nextCaptureSequence ??= 0;
			}
			if (storeName === 'candidates') {
				value.correctionHistory ??= [];
				value.payloadSnapshot ??= null;
			}
			value.schemaVersion = 2;
			const id = (value.id as string | undefined) ?? '';
			await store.put(value, storeName === 'missions' ? id : `${value.missionId ?? ''}:${id}`);
		}
	}
	await tx.objectStore('meta').put({ schemaVersion: 2, recordsMigrated: true, migratedAtMs: Date.now() }, 'schema');
	await tx.done;
}

function key(missionId: string, id: string): string {
	return `${missionId}:${id}`;
}

async function serializedWrite<T>(operation: () => Promise<T>): Promise<T> {
	const next = writeQueue.then(operation, operation);
	writeQueue = next.then(
		() => undefined,
		() => undefined
	);
	return next;
}

async function put<T>(store: StoreName, value: T, id: string, missionId?: string): Promise<void> {
	try {
		return await serializedWrite(async () => {
			const db = await getDb();
			await db.put(store, value, missionId ? key(missionId, id) : id);
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === 'QuotaExceededError') {
			throw new Error('BULK_STORAGE_QUOTA_EXCEEDED: earlier evidence was preserved', {
				cause: error,
			});
		}
		throw error;
	}
}

export async function saveMission(mission: BulkMissionRecord): Promise<void> {
	await put('missions', { ...mission, updatedAtMs: Date.now() }, mission.id);
}

export async function addOrUpdatePhoto(photo: BulkPhotoRecord): Promise<void> {
	await put('photos', photo, photo.id, photo.missionId);
}

export async function appendPhotosAndUpdateMission(
	mission: BulkMissionRecord,
	photos: BulkPhotoRecord[]
): Promise<BulkMissionRecord> {
	return serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction(['missions', 'photos'], 'readwrite');
		const current = (await tx.objectStore('missions').get(mission.id)) as
			BulkMissionRecord | undefined;
		if (!current) throw new Error('Bulk mission is not durable');
		const next = current.nextCaptureSequence ?? 0;
		const committedPhotos = photos.map((photo, index) => ({ ...photo, captureSequence: next + index }));
		for (const photo of committedPhotos)
			await tx.objectStore('photos').put(photo, key(mission.id, photo.id));
		const updated: BulkMissionRecord = {
			...current,
			photoIds: [...current.photoIds, ...committedPhotos.map((photo) => photo.id)],
			updatedAtMs: Date.now(),
			nextCaptureSequence: next + committedPhotos.length,
		};
		await tx.objectStore('missions').put(updated, mission.id);
		await tx.done;
		return updated;
	});
}

export async function removePhoto(missionId: string, photoId: string): Promise<void> {
	return serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction(['missions', 'photos', 'chunks', 'candidates', 'meta'], 'readwrite');
		await tx.objectStore('photos').delete(key(missionId, photoId));
		const chunks = (await tx.objectStore('chunks').getAll()) as BulkObservationChunkRecord[];
		for (const chunk of chunks) {
			if (chunk.missionId === missionId && chunk.photoIds.includes(photoId)) {
				chunk.status = 'pending';
				chunk.observations = [];
				await tx.objectStore('chunks').put(chunk, key(missionId, chunk.id));
			}
		}
		const candidates = (await tx.objectStore('candidates').getAll()) as BulkCandidateRecord[];
		for (const candidate of candidates) {
			if (candidate.missionId === missionId && candidate.evidencePhotoIds.includes(photoId)) {
				await tx.objectStore('candidates').delete(key(missionId, candidate.id));
			}
		}
		const mission = (await tx.objectStore('missions').get(missionId)) as
			BulkMissionRecord | undefined;
		if (mission) {
			mission.photoIds = mission.photoIds.filter((id) => id !== photoId);
			const removedCandidateIds = candidates
				.filter((candidate) => candidate.missionId === missionId && candidate.evidencePhotoIds.includes(photoId))
				.map((candidate) => candidate.id);
			mission.candidateIds = mission.candidateIds.filter((id) => !removedCandidateIds.includes(id));
			const invalidatedChunkIds = chunks
				.filter((chunk) => chunk.missionId === missionId && chunk.photoIds.includes(photoId))
				.map((chunk) => chunk.id);
			mission.observationChunkIds = mission.observationChunkIds.filter((id) => !invalidatedChunkIds.includes(id));
			mission.updatedAtMs = Date.now();
			await tx.objectStore('missions').put(mission, missionId);
		}
		await tx.objectStore('meta').delete(`candidate-snapshot:${missionId}`);
		await tx.done;
	});
}

export async function addOrUpdateAudio(audio: BulkAudioRecord): Promise<void> {
	await put('audio', audio, audio.id, audio.missionId);
}

export async function saveSpan(span: BulkTranscriptSpanRecord): Promise<void> {
	await put('spans', span, span.id, span.missionId);
}

export async function saveChunk(chunk: BulkObservationChunkRecord): Promise<void> {
	await put('chunks', chunk, chunk.id, chunk.missionId);
}

export async function saveCandidates(
	missionId: string,
	candidates: BulkCandidateRecord[]
): Promise<void> {
	await replaceCandidates(missionId, candidates);
}

export async function replaceCandidates(
	missionId: string,
	candidates: BulkCandidateRecord[]
): Promise<void> {
	await serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction(['missions', 'candidates', 'meta'], 'readwrite');
		const keys = await tx.objectStore('candidates').getAllKeys();
		for (const current of keys) {
			if (String(current).startsWith(`${missionId}:`))
				await tx.objectStore('candidates').delete(current);
		}
		for (const candidate of candidates) {
			await tx.objectStore('candidates').put(candidate, key(missionId, candidate.id));
		}
		const mission = (await tx.objectStore('missions').get(missionId)) as
			BulkMissionRecord | undefined;
		if (mission) {
			mission.candidateIds = candidates.map((candidate) => candidate.id);
			mission.updatedAtMs = Date.now();
			await tx.objectStore('missions').put(mission, missionId);
		}
		await tx.objectStore('meta').delete(`candidate-snapshot:${missionId}`);
		await tx.done;
	});
}

export async function saveCandidate(candidate: BulkCandidateRecord): Promise<void> {
	await put('candidates', candidate, candidate.id, candidate.missionId);
}

export async function saveCandidateSnapshot(
	missionId: string,
	candidates: BulkCandidateRecord[]
): Promise<void> {
	void missionId;
	void candidates;
}

export async function loadCandidateSnapshot(missionId: string): Promise<BulkCandidateRecord[]> {
	const db = await getDb();
	const value = (await db.get('meta', `candidate-snapshot:${missionId}`)) as
		{ candidates?: BulkCandidateRecord[] } | undefined;
	return value?.candidates ?? [];
}

export async function saveOutbox(operation: BulkOutboxOperationRecord): Promise<void> {
	await put('outbox', operation, operation.id, operation.missionId);
}

export async function loadActiveMission(): Promise<BulkMissionRecord | null> {
	requireBrowser();
	const db = await getDb();
	const missions = (await db.getAll('missions')) as BulkMissionRecord[];
	return (
		missions
			.filter((mission) => mission.status !== 'complete')
			.sort((a, b) => (b as any).updatedAtMs - (a as any).updatedAtMs)[0] ?? null
	);
}

export async function listRecoverableMissions(): Promise<BulkMissionRecord[]> {
	requireBrowser();
	const db = await getDb();
	const missions = (await db.getAll('missions')) as BulkMissionRecord[];
	return missions.filter((mission) => mission.status !== 'complete');
}

export async function storageEstimate(): Promise<StorageEstimate | null> {
	requireBrowser();
	return navigator.storage?.estimate ? navigator.storage.estimate() : null;
}

export interface BulkMissionBundle {
	mission: BulkMissionRecord;
	photos: BulkPhotoRecord[];
	audio: BulkAudioRecord[];
	spans: BulkTranscriptSpanRecord[];
	chunks: BulkObservationChunkRecord[];
	candidates: BulkCandidateRecord[];
	outbox: BulkOutboxOperationRecord[];
}

async function missionRecords<T>(store: StoreName, missionId: string): Promise<T[]> {
	const db = await getDb();
	const values = (await db.getAll(store)) as T[];
	return values.filter((value) => (value as { missionId?: string }).missionId === missionId);
}

export async function loadMissionBundle(missionId: string): Promise<BulkMissionBundle | null> {
	requireBrowser();
	const db = await getDb();
	const mission = (await db.get('missions', missionId)) as BulkMissionRecord | undefined;
	if (!mission) return null;
	return {
		mission,
		photos: await missionRecords<BulkPhotoRecord>('photos', missionId),
		audio: await missionRecords<BulkAudioRecord>('audio', missionId),
		spans: await missionRecords<BulkTranscriptSpanRecord>('spans', missionId),
		chunks: await missionRecords<BulkObservationChunkRecord>('chunks', missionId),
		candidates: await missionRecords<BulkCandidateRecord>('candidates', missionId),
		outbox: await missionRecords<BulkOutboxOperationRecord>('outbox', missionId),
	};
}

export async function discardMission(missionId: string): Promise<void> {
	await serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction([...STORES], 'readwrite');
		for (const store of STORES) {
			const keys = await tx.objectStore(store).getAllKeys();
			for (const current of keys)
				if (
					String(current).startsWith(`${missionId}:`) ||
					current === missionId ||
					(store === 'meta' && String(current).includes(missionId))
				)
					await tx.objectStore(store).delete(current);
		}
		await tx.done;
	});
}

export async function cleanupStaleMissions(now = Date.now()): Promise<void> {
	const missions = await listRecoverableMissions();
	for (const mission of missions) {
		if (now - Number((mission as any).updatedAtMs ?? 0) > MISSION_TTL_MS)
			await discardMission(mission.id);
	}
}

export async function resetDatabaseForTests(): Promise<void> {
	if (!browser) return;
	dbPromise = null;
	await deleteDB(DB_NAME);
}
