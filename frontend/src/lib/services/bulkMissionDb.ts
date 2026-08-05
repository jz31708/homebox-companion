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
	BulkStructuredError,
} from '$lib/types/bulkDomain';

const DB_NAME = 'hbc-bulk-missions';
const DB_VERSION = 2;
const MISSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DISCARD_MARKER_PREFIX = 'hbc-bulk-discarded:';
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
type MutableRecord = Record<string, unknown>;
type MissionListField =
	| 'photoIds'
	| 'audioSegmentIds'
	| 'transcriptSpanIds'
	| 'observationChunkIds'
	| 'candidateIds'
	| 'outboxOperationIds';

let dbPromise: Promise<IDBPDatabase> | null = null;
let writeQueue = Promise.resolve();
let migrationPromise: Promise<void> | null = null;

function requireBrowser(): void {
	if (!browser) throw new Error('Bulk mission storage is only available in the browser');
}

function discardMarkerKey(missionId: string): string {
	return `${DISCARD_MARKER_PREFIX}${missionId}`;
}

export function markMissionDiscarded(missionId: string): void {
	requireBrowser();
	try {
		localStorage.setItem(discardMarkerKey(missionId), String(Date.now()));
	} catch {
		// IndexedDB deletion still runs when storage policy blocks localStorage.
	}
}

function isMissionDiscarded(missionId: string): boolean {
	if (!browser) return false;
	try {
		return localStorage.getItem(discardMarkerKey(missionId)) !== null;
	} catch {
		return false;
	}
}

function discardedMissionIds(now = Date.now()): string[] {
	if (!browser) return [];
	const ids: string[] = [];
	try {
		for (let index = localStorage.length - 1; index >= 0; index -= 1) {
			const marker = localStorage.key(index);
			if (!marker?.startsWith(DISCARD_MARKER_PREFIX)) continue;
			const missionId = marker.slice(DISCARD_MARKER_PREFIX.length);
			const markedAt = Number(localStorage.getItem(marker) ?? now);
			if (!missionId) {
				localStorage.removeItem(marker);
				continue;
			}
			if (Number.isFinite(markedAt) && now - markedAt > MISSION_TTL_MS) {
				localStorage.removeItem(marker);
				continue;
			}
			ids.push(missionId);
		}
	} catch {
		return ids;
	}
	return ids;
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
	return dbPromise.then(async (db) => {
		await migrationPromise;
		return db;
	});
}

async function migrateV1Records(db: IDBPDatabase): Promise<void> {
	const marker = (await db.get('meta', 'schema')) as
		{ recordsMigrated?: boolean; migrationVersion?: number } | undefined;
	if (marker?.recordsMigrated && marker.migrationVersion === DB_VERSION) return;
	const tx = db.transaction([...STORES], 'readwrite');
	const migrationNow = Date.now();
	const missionKeys = new Map<string, IDBValidKey>();
	const missions = new Map<string, BulkMissionRecord>();
	const nextSequences = new Map<string, number>();
	const photosMissingSequence = new Set<IDBValidKey>();
	const recordIdsByMission = new Map<string, Partial<Record<MissionListField, string[]>>>();
	for (const storeName of STORES) {
		const store = tx.objectStore(storeName);
		let cursor = await store.openCursor();
		while (cursor) {
			if (
				storeName === 'meta' &&
				(!cursor.value || typeof cursor.value !== 'object' || Array.isArray(cursor.value))
			) {
				cursor = await cursor.continue();
				continue;
			}
			if (
				storeName === 'photos' &&
				(() => {
					const sequence =
						cursor.value && typeof cursor.value === 'object'
							? (cursor.value as { captureSequence?: unknown }).captureSequence
							: undefined;
					return typeof sequence !== 'number' || sequence < 0;
				})()
			) {
				photosMissingSequence.add(cursor.primaryKey);
			}
			const value = normalizeRecord(storeName, cursor.value, cursor.primaryKey, migrationNow);
			if (storeName === 'missions') {
				const mission = value as unknown as BulkMissionRecord;
				missionKeys.set(mission.id, cursor.primaryKey);
				missions.set(mission.id, mission);
				nextSequences.set(mission.id, mission.nextCaptureSequence ?? 0);
			} else {
				const record = value as MutableRecord;
				const missionId = typeof record.missionId === 'string' ? record.missionId : '';
				const id = typeof record.id === 'string' ? record.id : '';
				const field = missionListFieldForStore(storeName);
				if (missionId && id && field) {
					const lists = recordIdsByMission.get(missionId) ?? {};
					lists[field] = [...(lists[field] ?? []), id];
					recordIdsByMission.set(missionId, lists);
				}
			}
			await cursor.update(value);
			cursor = await cursor.continue();
		}
	}
	const photoStore = tx.objectStore('photos');
	let photoCursor = await photoStore.openCursor();
	while (photoCursor) {
		const photo = photoCursor.value as BulkPhotoRecord;
		if (photo.missionId) {
			const current = nextSequences.get(photo.missionId) ?? 0;
			const sequence = photosMissingSequence.has(photoCursor.primaryKey)
				? current
				: photo.captureSequence;
			photo.captureSequence = sequence;
			nextSequences.set(photo.missionId, Math.max(current, sequence + 1));
			await photoCursor.update(
				normalizeRecord('photos', photo, photoCursor.primaryKey, migrationNow)
			);
		}
		photoCursor = await photoCursor.continue();
	}
	for (const [missionId, mission] of missions) {
		const recordIds = recordIdsByMission.get(missionId);
		for (const field of [
			'photoIds',
			'audioSegmentIds',
			'transcriptSpanIds',
			'observationChunkIds',
			'candidateIds',
			'outboxOperationIds',
		] as MissionListField[]) {
			const actualIds = recordIds?.[field] ?? [];
			const actualSet = new Set(actualIds);
			mission[field] = uniqueIds([
				...(mission[field] ?? []).filter((id) => actualSet.has(id)),
				...actualIds,
			]) as never;
		}
		const nextCaptureSequence = nextSequences.get(missionId) ?? 0;
		mission.nextCaptureSequence = nextCaptureSequence;
		await tx.objectStore('missions').put(mission, missionKeys.get(missionId) ?? mission.id);
	}
	await tx.objectStore('meta').put(
		{
			schemaVersion: DB_VERSION,
			recordsMigrated: true,
			migrationVersion: DB_VERSION,
			migratedAtMs: migrationNow,
		},
		'schema'
	);
	await tx.done;
}

function missionListFieldForStore(storeName: StoreName): MissionListField | null {
	switch (storeName) {
		case 'photos':
			return 'photoIds';
		case 'audio':
			return 'audioSegmentIds';
		case 'spans':
			return 'transcriptSpanIds';
		case 'chunks':
			return 'observationChunkIds';
		case 'candidates':
			return 'candidateIds';
		case 'outbox':
			return 'outboxOperationIds';
		default:
			return null;
	}
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function arrayValue(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: [];
}

function missionIdFromKey(primaryKey: IDBValidKey): string {
	return typeof primaryKey === 'string' ? primaryKey.split(':')[0] : '';
}

function recordIdFromKey(primaryKey: IDBValidKey): string {
	return typeof primaryKey === 'string'
		? primaryKey.split(':').slice(1).join(':')
		: String(primaryKey);
}

function normalizeRecord(
	storeName: StoreName,
	input: unknown,
	primaryKey: IDBValidKey,
	now: number
): MutableRecord {
	const record: MutableRecord =
		input && typeof input === 'object' && !Array.isArray(input)
			? { ...(input as MutableRecord) }
			: {};
	record.schemaVersion = DB_VERSION;
	const keyMissionId = missionIdFromKey(primaryKey);
	const keyId = recordIdFromKey(primaryKey);

	switch (storeName) {
		case 'missions': {
			record.id = stringValue(record.id, String(primaryKey));
			record.status = stringValue(record.status, 'capturing');
			record.locationId = stringValue(record.locationId, '');
			record.parentItemId = typeof record.parentItemId === 'string' ? record.parentItemId : null;
			record.parentItemName =
				typeof record.parentItemName === 'string' ? record.parentItemName : null;
			record.areaLabel = stringValue(record.areaLabel, '');
			record.createdAtMs = numberValue(record.createdAtMs, numberValue(record.startedAtMs, now));
			record.startedAtMs = numberValue(record.startedAtMs, record.createdAtMs as number);
			record.updatedAtMs = numberValue(record.updatedAtMs, record.createdAtMs as number);
			record.photoIds = arrayValue(record.photoIds);
			record.audioSegmentIds = arrayValue(record.audioSegmentIds);
			record.transcriptSpanIds = arrayValue(record.transcriptSpanIds);
			record.observationChunkIds = arrayValue(record.observationChunkIds);
			record.candidateIds = arrayValue(record.candidateIds);
			record.outboxOperationIds = arrayValue(record.outboxOperationIds);
			record.chunkSize = numberValue(record.chunkSize, 6);
			record.lastError ??= null;
			record.parentItemName ??= null;
			record.transcriptEdited ??= false;
			record.transcriptSource ??= 'none';
			record.nextCaptureSequence = Math.max(0, numberValue(record.nextCaptureSequence, 0));
			break;
		}
		case 'photos': {
			record.missionId = stringValue(record.missionId, keyMissionId);
			record.id = stringValue(record.id, keyId);
			record.status = stringValue(record.status, 'ready');
			record.filename = stringValue(record.filename, `${record.id}.jpg`);
			record.mimeType = stringValue(
				record.mimeType,
				record.blob instanceof Blob ? record.blob.type : 'image/jpeg'
			);
			record.byteSize = numberValue(
				record.byteSize,
				record.blob instanceof Blob ? record.blob.size : 0
			);
			record.takenAtMs = numberValue(record.takenAtMs, now);
			record.sessionOffsetMs = numberValue(record.sessionOffsetMs, 0);
			record.note = stringValue(record.note, '');
			record.groupLabel = stringValue(record.groupLabel, '');
			record.ignored ??= false;
			record.captureSequence = Math.max(0, numberValue(record.captureSequence, 0));
			break;
		}
		case 'audio': {
			record.missionId = stringValue(record.missionId, keyMissionId);
			record.id = stringValue(record.id, keyId);
			record.status = stringValue(record.status, 'persisted');
			record.mimeType = stringValue(
				record.mimeType,
				record.blob instanceof Blob ? record.blob.type : 'audio/webm'
			);
			record.byteSize = numberValue(
				record.byteSize,
				record.blob instanceof Blob ? record.blob.size : 0
			);
			record.startedAtMs = numberValue(record.startedAtMs, now);
			record.endedAtMs = numberValue(record.endedAtMs, record.startedAtMs as number);
			record.rawTranscript = stringValue(record.rawTranscript, stringValue(record.transcript, ''));
			record.error ??= null;
			record.retryCount = Math.max(0, numberValue(record.retryCount, 0));
			record.activeAttemptId =
				typeof record.activeAttemptId === 'string' ? record.activeAttemptId : null;
			record.activeAttemptStartedAtMs =
				typeof record.activeAttemptStartedAtMs === 'number' &&
				Number.isFinite(record.activeAttemptStartedAtMs)
					? record.activeAttemptStartedAtMs
					: null;
			record.source ??= 'server';
			break;
		}
		case 'spans': {
			record.missionId = stringValue(record.missionId, keyMissionId);
			record.id = stringValue(record.id, keyId);
			record.sourceAudioSegmentId =
				typeof record.sourceAudioSegmentId === 'string' ? record.sourceAudioSegmentId : null;
			record.text = stringValue(record.text, '');
			record.startOffsetMs = typeof record.startOffsetMs === 'number' ? record.startOffsetMs : null;
			record.endOffsetMs = typeof record.endOffsetMs === 'number' ? record.endOffsetMs : null;
			record.source ??= 'manual';
			record.canonical ??= false;
			break;
		}
		case 'chunks': {
			record.missionId = stringValue(record.missionId, keyMissionId);
			record.id = stringValue(record.id, keyId);
			record.status = stringValue(record.status, 'pending');
			record.photoIds = arrayValue(record.photoIds);
			record.transcriptSpanIds = arrayValue(record.transcriptSpanIds);
			record.requestHash = stringValue(record.requestHash, '');
			record.observations = Array.isArray(record.observations)
				? record.observations.map((entry, index) => {
						const observation =
							entry && typeof entry === 'object' ? { ...(entry as MutableRecord) } : {};
						observation.schemaVersion = DB_VERSION;
						observation.missionId = record.missionId;
						observation.id = stringValue(observation.id, `${record.id}:observation-${index}`);
						observation.photoIds = arrayValue(observation.photoIds);
						observation.transcriptSpanIds = arrayValue(observation.transcriptSpanIds);
						observation.name = stringValue(observation.name, 'Unnamed observation');
						observation.evidence = Array.isArray(observation.evidence) ? observation.evidence : [];
						return observation;
					})
				: [];
			record.error ??= null;
			break;
		}
		case 'candidates': {
			record.missionId = stringValue(record.missionId, keyMissionId);
			record.id = stringValue(record.id, keyId);
			record.state = stringValue(record.state, 'needs_review');
			record.reviewTier = stringValue(record.reviewTier, 'attention');
			record.name = stringValue(record.name, 'Unnamed item');
			record.quantity = Math.max(0, numberValue(record.quantity, 1));
			record.entityMode = stringValue(record.entityMode, 'individual');
			record.quantityBasis = stringValue(record.quantityBasis, 'unknown');
			record.sourceObservationIds = arrayValue(record.sourceObservationIds);
			record.evidencePhotoIds = arrayValue(record.evidencePhotoIds);
			record.evidenceTranscriptSpanIds = arrayValue(record.evidenceTranscriptSpanIds);
			record.duplicateCandidateIds = arrayValue(record.duplicateCandidateIds);
			record.blockerCodes = arrayValue(record.blockerCodes);
			record.warningCodes = arrayValue(record.warningCodes);
			record.duplicateMatches = Array.isArray(record.duplicateMatches)
				? record.duplicateMatches
				: [];
			record.createdHomeboxItemId =
				typeof record.createdHomeboxItemId === 'string' ? record.createdHomeboxItemId : null;
			record.correctionHistory = Array.isArray(record.correctionHistory)
				? record.correctionHistory
				: [];
			record.payloadSnapshot ??= null;
			break;
		}
		case 'outbox': {
			record.missionId = stringValue(record.missionId, keyMissionId);
			record.id = stringValue(record.id, keyId);
			record.candidateId = stringValue(record.candidateId, '');
			record.requestHash = stringValue(record.requestHash, '');
			record.status = stringValue(record.status, 'pending');
			record.evidencePhotoIds = arrayValue(record.evidencePhotoIds);
			record.homeboxItemId = typeof record.homeboxItemId === 'string' ? record.homeboxItemId : null;
			record.lastError ??= null;
			break;
		}
		case 'meta':
			break;
	}
	return record;
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
	return next.catch((error: unknown) => {
		throw normalizeStorageError(error);
	});
}

function normalizeStorageError(error: unknown): Error {
	if (
		(typeof DOMException !== 'undefined' &&
			error instanceof DOMException &&
			error.name === 'QuotaExceededError') ||
		(error instanceof Error && error.name === 'QuotaExceededError')
	) {
		return new Error('BULK_STORAGE_QUOTA_EXCEEDED: earlier evidence was preserved', {
			cause: error,
		});
	}
	return error instanceof Error ? error : new Error(String(error));
}

function abortTransactionAndThrow(tx: { abort(): void }, error: unknown): never {
	try {
		tx.abort();
	} catch {
		// The transaction may already be finished or aborted.
	}
	throw error;
}

function uniqueIds(ids: string[]): string[] {
	return [...new Set(ids)];
}

function normalizedReferenceFieldName(fieldName: string): string {
	return fieldName.replace(/[_-]/g, '').toLowerCase();
}

function isPhotoReferenceArrayField(fieldName: string): boolean {
	const normalized = normalizedReferenceFieldName(fieldName);
	return (
		normalized === 'evidencephotoids' ||
		normalized === 'photoids' ||
		normalized === 'expectedattachmentmanifest' ||
		normalized === 'attachmentmanifest' ||
		normalized === 'attachmentmanifestids'
	);
}

function cloneWithoutPhotoReference(value: unknown, photoId: string, fieldName?: string): unknown {
	if (Array.isArray(value)) {
		return value
			.filter((entry) => {
				if (!isPhotoReferenceArrayField(fieldName ?? '')) return true;
				if (entry === photoId) return false;
				if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
					const item = entry as Record<string, unknown>;
					return item.photoId !== photoId && item.photo_id !== photoId;
				}
				return true;
			})
			.map((entry) => cloneWithoutPhotoReference(entry, photoId, fieldName));
	}
	if (!value || typeof value !== 'object') return value;
	if (value instanceof Blob) return value;
	const copy: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (isPhotoReferenceArrayField(fieldName ?? '') && key === photoId) continue;
		copy[key] = cloneWithoutPhotoReference(entry, photoId, key);
	}
	return copy;
}

function sanitizePayloadSnapshot(
	payloadSnapshot: Record<string, unknown> | undefined,
	photoId: string
): Record<string, unknown> | undefined {
	return payloadSnapshot
		? (cloneWithoutPhotoReference(payloadSnapshot, photoId) as Record<string, unknown>)
		: undefined;
}

function deterministicRequestHash(payloadSnapshot: Record<string, unknown> | undefined): string {
	return payloadSnapshot ? (JSON.stringify(payloadSnapshot) ?? '') : '';
}

function hasPhotoReference(value: unknown, photoId: string, fieldName?: string): boolean {
	if (Array.isArray(value)) {
		return value.some((entry) => {
			if (isPhotoReferenceArrayField(fieldName ?? '') && entry === photoId) return true;
			if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
				const item = entry as Record<string, unknown>;
				if (isPhotoReferenceArrayField(fieldName ?? ''))
					return item.photoId === photoId || item.photo_id === photoId;
			}
			return hasPhotoReference(entry, photoId, fieldName);
		});
	}
	if (!value || typeof value !== 'object' || value instanceof Blob) return false;
	if (isPhotoReferenceArrayField(fieldName ?? '')) {
		if (Object.prototype.hasOwnProperty.call(value, photoId)) return true;
		const item = value as Record<string, unknown>;
		if (item.photoId === photoId || item.photo_id === photoId || item.id === photoId) return true;
	}
	return Object.entries(value as Record<string, unknown>).some(([key, entry]) =>
		hasPhotoReference(entry, photoId, key)
	);
}

function candidateReferencesPhoto(candidate: BulkCandidateRecord, photoId: string): boolean {
	if (candidate.evidencePhotoIds.includes(photoId)) return true;
	return Boolean(
		candidate.evidence?.some(
			(reference) =>
				(reference as { photoId?: string; photo_id?: string }).photoId === photoId ||
				(reference as { photoId?: string; photo_id?: string }).photo_id === photoId
		)
	);
}

function mergeMissionLists(
	current: BulkMissionRecord,
	incoming: BulkMissionRecord
): BulkMissionRecord {
	const merged = { ...incoming };
	for (const field of [
		'photoIds',
		'audioSegmentIds',
		'transcriptSpanIds',
		'observationChunkIds',
		'candidateIds',
		'outboxOperationIds',
	] as MissionListField[]) {
		// Existing mission lists are durable indexes, not caller-owned patches. A
		// stale workflow snapshot must never reintroduce an ID removed by another
		// atomic operation.
		merged[field] = [...(current[field] ?? [])] as never;
	}
	merged.nextCaptureSequence = Math.max(
		current.nextCaptureSequence ?? 0,
		incoming.nextCaptureSequence ?? 0
	);
	merged.rawTranscript = current.rawTranscript;
	merged.canonicalTranscript = current.canonicalTranscript;
	merged.editedTranscript = current.editedTranscript;
	merged.transcriptEdited = current.transcriptEdited;
	merged.transcriptSource = current.transcriptSource;
	return merged;
}

async function saveMissionScopedRecord<T extends { missionId: string; id: string }>(
	storeName: Exclude<StoreName, 'missions' | 'photos' | 'meta'>,
	record: T,
	missionListField: Exclude<MissionListField, 'photoIds'>
): Promise<void> {
	if (isMissionDiscarded(record.missionId)) return;
	await serializedWrite(async () => {
		if (isMissionDiscarded(record.missionId)) return;
		const db = await getDb();
		const tx = db.transaction([storeName, 'missions'], 'readwrite');
		try {
			await tx
				.objectStore(storeName)
				.put({ ...record, schemaVersion: DB_VERSION }, key(record.missionId, record.id));
			const mission = (await tx.objectStore('missions').get(record.missionId)) as
				BulkMissionRecord | undefined;
			if (mission) {
				mission[missionListField] = uniqueIds([
					...(mission[missionListField] ?? []),
					record.id,
				]) as never;
				mission.updatedAtMs = Date.now();
				await tx.objectStore('missions').put(mission, mission.id);
			}
			await tx.done;
		} catch (error) {
			abortTransactionAndThrow(tx, error);
		}
	});
}

export async function saveMission(mission: BulkMissionRecord): Promise<void> {
	if (isMissionDiscarded(mission.id)) return;
	await serializedWrite(async () => {
		if (isMissionDiscarded(mission.id)) return;
		const db = await getDb();
		const tx = db.transaction('missions', 'readwrite');
		const current = (await tx.objectStore('missions').get(mission.id)) as
			BulkMissionRecord | undefined;
		const value = current ? mergeMissionLists(current, mission) : { ...mission };
		value.schemaVersion = DB_VERSION;
		value.updatedAtMs = Date.now();
		await tx.objectStore('missions').put(value, mission.id);
		await tx.done;
	});
}

export async function updateMissionTranscriptEdit(
	missionId: string,
	editedTranscript: string
): Promise<BulkMissionRecord> {
	return serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction('missions', 'readwrite');
		const mission = (await tx.objectStore('missions').get(missionId)) as
			BulkMissionRecord | undefined;
		if (!mission) throw new Error('Bulk mission is not durable');
		const canonical = mission.canonicalTranscript ?? mission.rawTranscript ?? '';
		mission.editedTranscript = editedTranscript;
		mission.transcriptEdited = editedTranscript !== canonical;
		mission.transcriptSource = mission.transcriptEdited
			? canonical.trim()
				? 'mixed'
				: 'manual'
			: canonical.trim()
				? 'server'
				: 'none';
		mission.updatedAtMs = Date.now();
		await tx.objectStore('missions').put(mission, missionId);
		await tx.done;
		return mission;
	});
}

export async function addOrUpdatePhoto(photo: BulkPhotoRecord): Promise<void> {
	await serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction(['photos', 'missions'], 'readwrite');
		try {
			const photoStore = tx.objectStore('photos');
			const existing = (await photoStore.get(key(photo.missionId, photo.id))) as
				BulkPhotoRecord | undefined;
			const value: BulkPhotoRecord = existing
				? { ...existing, ...photo, captureSequence: existing.captureSequence }
				: { ...photo, schemaVersion: DB_VERSION };
			await photoStore.put(value, key(photo.missionId, photo.id));
			const mission = (await tx.objectStore('missions').get(photo.missionId)) as
				BulkMissionRecord | undefined;
			if (mission) {
				mission.photoIds = uniqueIds([...(mission.photoIds ?? []), photo.id]);
				mission.updatedAtMs = Date.now();
				await tx.objectStore('missions').put(mission, mission.id);
			}
			await tx.done;
		} catch (error) {
			abortTransactionAndThrow(tx, error);
		}
	});
}

export async function updatePhoto(
	missionId: string,
	photoId: string,
	patch: Partial<BulkPhotoRecord>
): Promise<BulkPhotoRecord> {
	return serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction(['photos', 'missions'], 'readwrite');
		try {
			const photoStore = tx.objectStore('photos');
			const existing = (await photoStore.get(key(missionId, photoId))) as
				BulkPhotoRecord | undefined;
			if (!existing) throw new Error('Bulk photo is not durable');
			const value: BulkPhotoRecord = {
				...existing,
				...patch,
				missionId,
				id: photoId,
				captureSequence: existing.captureSequence,
			};
			await photoStore.put(value, key(missionId, photoId));
			const mission = (await tx.objectStore('missions').get(missionId)) as
				BulkMissionRecord | undefined;
			if (mission) {
				mission.updatedAtMs = Date.now();
				await tx.objectStore('missions').put(mission, mission.id);
			}
			await tx.done;
			return value;
		} catch (error) {
			abortTransactionAndThrow(tx, error);
		}
	});
}

export async function appendPhotosAndUpdateMission(
	mission: BulkMissionRecord,
	photos: BulkPhotoRecord[]
): Promise<{ mission: BulkMissionRecord; photos: BulkPhotoRecord[] }> {
	return serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction(['missions', 'photos'], 'readwrite');
		try {
			const current = (await tx.objectStore('missions').get(mission.id)) as
				BulkMissionRecord | undefined;
			if (!current) throw new Error('Bulk mission is not durable');
			const next = current.nextCaptureSequence ?? 0;
			const committedPhotos: BulkPhotoRecord[] = photos.map((photo, index) => ({
				...photo,
				missionId: current.id,
				schemaVersion: 2,
				captureSequence: next + index,
			}));
			for (const photo of committedPhotos)
				await tx.objectStore('photos').put(photo, key(current.id, photo.id));
			const updated: BulkMissionRecord = {
				...current,
				photoIds: uniqueIds([...current.photoIds, ...committedPhotos.map((photo) => photo.id)]),
				updatedAtMs: Date.now(),
				nextCaptureSequence: next + committedPhotos.length,
			};
			await tx.objectStore('missions').put(updated, current.id);
			await tx.done;
			return { mission: updated, photos: committedPhotos };
		} catch (error) {
			abortTransactionAndThrow(tx, error);
		}
	});
}

export async function removePhoto(missionId: string, photoId: string): Promise<void> {
	return serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction(
			['missions', 'photos', 'chunks', 'candidates', 'outbox', 'meta'],
			'readwrite'
		);
		try {
			const mission = (await tx.objectStore('missions').get(missionId)) as
				BulkMissionRecord | undefined;
			await tx.objectStore('photos').delete(key(missionId, photoId));
			const chunks = (await tx.objectStore('chunks').getAll()) as BulkObservationChunkRecord[];
			for (const chunk of chunks) {
				if (chunk.missionId === missionId && chunk.photoIds.includes(photoId)) {
					chunk.photoIds = chunk.photoIds.filter((id) => id !== photoId);
					chunk.status = 'pending';
					chunk.observations = [];
					await tx.objectStore('chunks').put(chunk, key(missionId, chunk.id));
				}
			}
			const candidates = (await tx.objectStore('candidates').getAll()) as BulkCandidateRecord[];
			const removedCandidateIds = candidates
				.filter(
					(candidate) =>
						candidate.missionId === missionId && candidateReferencesPhoto(candidate, photoId)
				)
				.map((candidate) => candidate.id);
			for (const candidate of candidates) {
				if (removedCandidateIds.includes(candidate.id) && candidate.missionId === missionId) {
					await tx.objectStore('candidates').delete(key(missionId, candidate.id));
				}
			}
			const outbox = (await tx.objectStore('outbox').getAll()) as BulkOutboxOperationRecord[];
			const remainingOutboxIds: string[] = [];
			for (const operation of outbox) {
				if (operation.missionId !== missionId) continue;
				if (removedCandidateIds.includes(operation.candidateId)) {
					await tx.objectStore('outbox').delete(key(missionId, operation.id));
					continue;
				}
				const evidencePhotoIds = operation.evidencePhotoIds.filter((id) => id !== photoId);
				const expectedAttachmentManifest = operation.expectedAttachmentManifest?.filter(
					(id) => id !== photoId
				);
				const attachmentResults = operation.attachmentResults
					? { ...operation.attachmentResults }
					: undefined;
				if (attachmentResults && Object.prototype.hasOwnProperty.call(attachmentResults, photoId))
					delete attachmentResults[photoId];
				const payloadHasPhoto = hasPhotoReference(operation.payloadSnapshot, photoId);
				const sanitizedPayloadSnapshot = payloadHasPhoto
					? sanitizePayloadSnapshot(operation.payloadSnapshot, photoId)
					: operation.payloadSnapshot;
				const changed =
					evidencePhotoIds.length !== operation.evidencePhotoIds.length ||
					expectedAttachmentManifest?.length !== operation.expectedAttachmentManifest?.length ||
					Boolean(
						operation.attachmentResults &&
						attachmentResults &&
						Object.keys(operation.attachmentResults).length !==
							Object.keys(attachmentResults).length
					) ||
					payloadHasPhoto;
				if (changed) {
					operation.evidencePhotoIds = evidencePhotoIds;
					operation.expectedAttachmentManifest = expectedAttachmentManifest;
					operation.attachmentResults = attachmentResults;
					operation.payloadSnapshot = sanitizedPayloadSnapshot;
					operation.requestHash = deterministicRequestHash(sanitizedPayloadSnapshot);
					await tx.objectStore('outbox').put(operation, key(missionId, operation.id));
				}
				remainingOutboxIds.push(operation.id);
			}
			if (mission) {
				mission.photoIds = mission.photoIds.filter((id) => id !== photoId);
				mission.observationChunkIds = uniqueIds(
					chunks.filter((chunk) => chunk.missionId === missionId).map((chunk) => chunk.id)
				);
				mission.candidateIds = candidates
					.filter(
						(candidate) =>
							candidate.missionId === missionId && !removedCandidateIds.includes(candidate.id)
					)
					.map((candidate) => candidate.id);
				mission.outboxOperationIds = remainingOutboxIds;
				mission.updatedAtMs = Date.now();
				await tx.objectStore('missions').put(mission, missionId);
			}
			await tx.objectStore('meta').delete(`candidate-snapshot:${missionId}`);
			await tx.done;
		} catch (error) {
			abortTransactionAndThrow(tx, error);
		}
	});
}

export async function addOrUpdateAudio(audio: BulkAudioRecord): Promise<void> {
	await saveMissionScopedRecord('audio', audio, 'audioSegmentIds');
}

export async function insertAudioSegment(
	missionId: string,
	record: BulkAudioRecord
): Promise<BulkAudioRecord> {
	return serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction(['missions', 'audio'], 'readwrite');
		try {
			const mission = (await tx.objectStore('missions').get(missionId)) as
				BulkMissionRecord | undefined;
			if (!mission) throw new Error('Bulk mission is not durable');
			const audioKey = key(missionId, record.id);
			if (await tx.objectStore('audio').get(audioKey))
				throw new Error('Audio segment already exists');
			if (record.blob.size <= 0) throw new Error('Audio segment is empty');
			if (
				!Number.isFinite(record.startedAtMs) ||
				!Number.isFinite(record.endedAtMs) ||
				record.startedAtMs < 0 ||
				record.endedAtMs < record.startedAtMs
			)
				throw new Error('Audio segment timing is invalid');
			const committed: BulkAudioRecord = {
				...record,
				missionId,
				schemaVersion: DB_VERSION,
				status: 'persisted',
				activeAttemptId: null,
				activeAttemptStartedAtMs: null,
				byteSize: record.blob.size,
				mimeType: record.blob.type || record.mimeType,
			};
			await tx.objectStore('audio').put(committed, audioKey);
			mission.audioSegmentIds = uniqueIds([...(mission.audioSegmentIds ?? []), record.id]);
			mission.updatedAtMs = Date.now();
			await tx.objectStore('missions').put(mission, missionId);
			await tx.done;
			return committed;
		} catch (error) {
			abortTransactionAndThrow(tx, error);
		}
	});
}

export type BeginAudioTranscriptionAttemptResult =
	| { acquired: true; record: BulkAudioRecord }
	| { acquired: false; reason: 'already_transcribing' | 'not_retryable'; record: BulkAudioRecord };

export async function beginAudioTranscriptionAttempt(
	missionId: string,
	segmentId: string,
	attemptId: string,
	attemptStartedAtMs: number
): Promise<BeginAudioTranscriptionAttemptResult> {
	return serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction(['missions', 'audio'], 'readwrite');
		const mission = (await tx.objectStore('missions').get(missionId)) as
			BulkMissionRecord | undefined;
		const audio = (await tx.objectStore('audio').get(key(missionId, segmentId))) as
			BulkAudioRecord | undefined;
		if (!mission || !audio || audio.missionId !== missionId)
			throw new Error('Audio segment no longer belongs to this mission');
		if (audio.status === 'transcribing' && audio.activeAttemptId)
			return { acquired: false, reason: 'already_transcribing', record: audio };
		if (audio.status !== 'persisted' && audio.status !== 'failed')
			return { acquired: false, reason: 'not_retryable', record: audio };
		const next: BulkAudioRecord = {
			...audio,
			status: 'transcribing',
			error: null,
			retryCount: Math.max(0, audio.retryCount ?? 0) + 1,
			activeAttemptId: attemptId,
			activeAttemptStartedAtMs: attemptStartedAtMs,
		};
		await tx.objectStore('audio').put(next, key(missionId, segmentId));
		mission.updatedAtMs = Date.now();
		await tx.objectStore('missions').put(mission, missionId);
		await tx.done;
		return { acquired: true, record: next };
	});
}

export async function commitAudioTranscriptionFailure(
	missionId: string,
	segmentId: string,
	attemptId: string,
	error: BulkStructuredError
): Promise<{
	committed: boolean;
	audio: BulkAudioRecord | null;
	mission: BulkMissionRecord | null;
}> {
	return serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction(['missions', 'audio'], 'readwrite');
		const mission = (await tx.objectStore('missions').get(missionId)) as
			BulkMissionRecord | undefined;
		const audio = (await tx.objectStore('audio').get(key(missionId, segmentId))) as
			BulkAudioRecord | undefined;
		if (
			!mission ||
			!audio ||
			audio.status !== 'transcribing' ||
			audio.activeAttemptId !== attemptId
		)
			return { committed: false, audio: null, mission: null };
		const next: BulkAudioRecord = {
			...audio,
			status: 'failed',
			error,
			activeAttemptId: null,
			activeAttemptStartedAtMs: null,
		};
		await tx.objectStore('audio').put(next, key(missionId, segmentId));
		mission.lastError = error;
		mission.updatedAtMs = Date.now();
		await tx.objectStore('missions').put(mission, missionId);
		await tx.done;
		return { committed: true, audio: next, mission };
	});
}

export function serverTranscriptSpanId(segmentId: string): string {
	return `server:${segmentId}`;
}

export async function recoverInterruptedAudioAttempts(missionId: string): Promise<number> {
	return serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction(['missions', 'audio'], 'readwrite');
		const mission = (await tx.objectStore('missions').get(missionId)) as
			BulkMissionRecord | undefined;
		if (!mission) return 0;
		const records = (await tx.objectStore('audio').getAll()) as BulkAudioRecord[];
		let repaired = 0;
		for (const audio of records) {
			if (audio.missionId !== missionId || audio.status !== 'transcribing') continue;
			const next: BulkAudioRecord = {
				...audio,
				status: 'failed',
				error: {
					code: 'TRANSCRIPTION_INTERRUPTED',
					message: 'Transcription was interrupted. Retry this recording.',
					retryable: true,
				},
				activeAttemptId: null,
				activeAttemptStartedAtMs: null,
			};
			await tx.objectStore('audio').put(next, key(missionId, audio.id));
			repaired += 1;
		}
		if (repaired) {
			mission.lastError = {
				code: 'TRANSCRIPTION_INTERRUPTED',
				message: 'Transcription was interrupted. Retry this recording.',
				retryable: true,
			};
			mission.updatedAtMs = Date.now();
			await tx.objectStore('missions').put(mission, missionId);
		}
		await tx.done;
		return repaired;
	});
}

export interface CommitAudioTranscriptionSuccessInput {
	missionId: string;
	segmentId: string;
	attemptId: string;
	text: string;
	startOffsetMs: number;
	endOffsetMs: number;
}

export interface CommitAudioTranscriptionSuccessResult {
	committed: boolean;
	audio: BulkAudioRecord | null;
	span: BulkTranscriptSpanRecord | null;
	mission: BulkMissionRecord | null;
}

export async function commitAudioTranscriptionSuccess(
	input: CommitAudioTranscriptionSuccessInput
): Promise<CommitAudioTranscriptionSuccessResult> {
	return serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction(['missions', 'audio', 'spans'], 'readwrite');
		const mission = (await tx.objectStore('missions').get(input.missionId)) as
			BulkMissionRecord | undefined;
		const audio = (await tx.objectStore('audio').get(key(input.missionId, input.segmentId))) as
			BulkAudioRecord | undefined;
		const text = input.text.trim();
		if (
			!mission ||
			!audio ||
			audio.status !== 'transcribing' ||
			audio.activeAttemptId !== input.attemptId ||
			!text ||
			input.startOffsetMs < audio.startedAtMs ||
			input.endOffsetMs < input.startOffsetMs ||
			input.endOffsetMs > audio.endedAtMs
		)
			return { committed: false, audio: null, span: null, mission: null };
		const span: BulkTranscriptSpanRecord = {
			schemaVersion: DB_VERSION,
			missionId: input.missionId,
			id: serverTranscriptSpanId(input.segmentId),
			sourceAudioSegmentId: input.segmentId,
			text,
			startOffsetMs: input.startOffsetMs,
			endOffsetMs: input.endOffsetMs,
			source: 'server',
			canonical: true,
		};
		await tx.objectStore('spans').put(span, key(input.missionId, span.id));
		const nextAudio: BulkAudioRecord = {
			...audio,
			status: 'done',
			transcript: text,
			rawTranscript: text,
			source: 'server',
			error: null,
			activeAttemptId: null,
			activeAttemptStartedAtMs: null,
		};
		await tx.objectStore('audio').put(nextAudio, key(input.missionId, input.segmentId));
		const spans = (await tx.objectStore('spans').getAll()) as BulkTranscriptSpanRecord[];
		const canonical = spans
			.filter(
				(entry) =>
					entry.missionId === input.missionId && entry.canonical && entry.source === 'server'
			)
			.sort(
				(a, b) =>
					(a.startOffsetMs ?? Number.MAX_SAFE_INTEGER) -
						(b.startOffsetMs ?? Number.MAX_SAFE_INTEGER) ||
					(a.sourceAudioSegmentId ?? '').localeCompare(b.sourceAudioSegmentId ?? '') ||
					a.id.localeCompare(b.id)
			)
			.map((entry) => entry.text.trim())
			.filter(Boolean)
			.join(' ');
		mission.rawTranscript = canonical;
		mission.canonicalTranscript = canonical;
		if (!mission.transcriptEdited) mission.editedTranscript = canonical;
		mission.transcriptSource = mission.transcriptEdited ? 'mixed' : 'server';
		mission.transcriptSpanIds = uniqueIds([...(mission.transcriptSpanIds ?? []), span.id]);
		mission.audioSegmentIds = uniqueIds([...(mission.audioSegmentIds ?? []), input.segmentId]);
		if (mission.lastError?.code?.startsWith('TRANSCRIPTION_')) mission.lastError = null;
		mission.updatedAtMs = Date.now();
		await tx.objectStore('missions').put(mission, input.missionId);
		await tx.done;
		return { committed: true, audio: nextAudio, span, mission };
	});
}

export async function saveSpan(span: BulkTranscriptSpanRecord): Promise<void> {
	await saveMissionScopedRecord('spans', span, 'transcriptSpanIds');
}

export async function saveChunk(chunk: BulkObservationChunkRecord): Promise<void> {
	await saveMissionScopedRecord('chunks', chunk, 'observationChunkIds');
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
		try {
			const keys = await tx.objectStore('candidates').getAllKeys();
			for (const current of keys) {
				if (String(current).startsWith(`${missionId}:`))
					await tx.objectStore('candidates').delete(current);
			}
			for (const candidate of candidates) {
				await tx
					.objectStore('candidates')
					.put(
						{ ...candidate, missionId, schemaVersion: DB_VERSION },
						key(missionId, candidate.id)
					);
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
		} catch (error) {
			try {
				tx.abort();
			} catch {
				// The transaction may already be finished or aborted.
			}
			throw error;
		}
	});
}

export async function saveCandidate(candidate: BulkCandidateRecord): Promise<void> {
	await saveMissionScopedRecord('candidates', candidate, 'candidateIds');
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
	await saveMissionScopedRecord('outbox', operation, 'outboxOperationIds');
}

export async function loadActiveMission(): Promise<BulkMissionRecord | null> {
	requireBrowser();
	const db = await getDb();
	const missions = (await db.getAll('missions')) as BulkMissionRecord[];
	return (
		missions
			.filter((mission) => mission.status !== 'complete' && !isMissionDiscarded(mission.id))
			.sort((a, b) => (b as any).updatedAtMs - (a as any).updatedAtMs)[0] ?? null
	);
}

export async function listRecoverableMissions(): Promise<BulkMissionRecord[]> {
	requireBrowser();
	const db = await getDb();
	const missions = (await db.getAll('missions')) as BulkMissionRecord[];
	return missions.filter(
		(mission) => mission.status !== 'complete' && !isMissionDiscarded(mission.id)
	);
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
	if (isMissionDiscarded(missionId)) return null;
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
	markMissionDiscarded(missionId);
	await serializedWrite(async () => {
		const db = await getDb();
		const tx = db.transaction([...STORES], 'readwrite');
		try {
			for (const store of STORES) {
				const keys = await tx.objectStore(store).getAllKeys();
				for (const current of keys)
					if (
						String(current).startsWith(`${missionId}:`) ||
						current === missionId ||
						(store === 'meta' &&
							(String(current) === `candidate-snapshot:${missionId}` ||
								String(current).startsWith(`${missionId}:`)))
					)
						await tx.objectStore(store).delete(current);
			}
			await tx.done;
		} catch (error) {
			abortTransactionAndThrow(tx, error);
		}
	});
}

export async function cleanupStaleMissions(now = Date.now()): Promise<void> {
	for (const missionId of discardedMissionIds(now)) await discardMission(missionId);
	const missions = await listRecoverableMissions();
	for (const mission of missions) {
		if (now - Number((mission as any).updatedAtMs ?? 0) > MISSION_TTL_MS)
			await discardMission(mission.id);
	}
}

export async function resetDatabaseForTests(): Promise<void> {
	if (!browser) return;
	try {
		for (let index = localStorage.length - 1; index >= 0; index -= 1) {
			const marker = localStorage.key(index);
			if (marker?.startsWith(DISCARD_MARKER_PREFIX)) localStorage.removeItem(marker);
		}
	} catch {
		// Test reset still deletes IndexedDB when localStorage is unavailable.
	}
	const pendingQueue = writeQueue;
	try {
		await pendingQueue;
	} catch {
		// The database is being reset; the failed operation is intentionally discarded.
	}
	const pendingDb = dbPromise;
	dbPromise = null;
	migrationPromise = null;
	writeQueue = Promise.resolve();
	if (pendingDb) {
		try {
			(await pendingDb).close();
		} catch {
			// The open promise may have failed; deleteDB below still resets the database.
		}
	}
	await deleteDB(DB_NAME);
}
