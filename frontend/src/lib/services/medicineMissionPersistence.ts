import { browser } from '$app/environment';
import { openDB, type IDBPDatabase } from 'idb';
import type {
	BatchCreateRequest,
	MedicineCandidate,
	MedicineCandidateState,
	MedicineCapturedPhoto,
	MedicineIntakeStatus,
	MedicinePhotoKind,
	MedicineQueuedScan,
} from '$lib/types';
import { createLogger } from '$lib/utils/logger';
import { dataUrlToFile, fileToDataUrl } from './serialize';

const log = createLogger({ prefix: 'MedicineMissionPersistence' });

const DB_NAME = 'hbc-medicine-mission-recovery';
const DB_VERSION = 1;
const STORE_NAME = 'missions';
const SESSION_KEY = 'current';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredMedicinePhoto {
	id: string;
	filename: string;
	mimeType: string;
	dataUrl: string;
	takenAtMs: number;
	sessionOffsetMs: number;
	note: string;
	groupLabel: string;
	ignored: boolean;
	kind: MedicinePhotoKind;
}

export interface StoredMedicineCandidate extends Omit<MedicineCandidate, 'originalFiles'> {}

export interface StoredMedicineQueuedScan
	extends Omit<MedicineQueuedScan, 'candidate' | 'homeboxPayloadPreview'> {
	candidate?: StoredMedicineCandidate | null;
	homeboxPayloadPreview?: BatchCreateRequest | null;
}

export interface StoredMedicineMission {
	id: string;
	createdAt: number;
	updatedAt: number;
	missionId: string;
	status: MedicineIntakeStatus;
	locationId: string | null;
	locationName: string | null;
	locationPath: string | null;
	startedAtMs: number | null;
	photos: StoredMedicinePhoto[];
	note: string;
	barcodeText: string;
	expiryDate: string;
	openedDate: string;
	remainingDoses: number | null;
	remainingDoseLabel: 'full' | 'half' | 'low' | 'empty' | 'unknown';
	candidate: StoredMedicineCandidate | null;
	queuedScans: StoredMedicineQueuedScan[];
	activeQueueId: string | null;
	warnings: string[];
	error: string | null;
}

export interface MedicineMissionSummary {
	ageText: string;
	locationName: string | null;
	status: MedicineIntakeStatus;
	photoCount: number;
	candidateCount: number;
	recoverableCount: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
	if (!browser) return Promise.reject(new Error('IndexedDB not available in SSR'));
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, DB_VERSION, {
			upgrade(db) {
				if (db.objectStoreNames.contains(STORE_NAME)) {
					db.deleteObjectStore(STORE_NAME);
				}
				db.createObjectStore(STORE_NAME);
			},
		});
	}
	return dbPromise;
}

function isExpired(session: StoredMedicineMission): boolean {
	return Date.now() - session.createdAt > SESSION_TTL_MS;
}

function formatAge(timestamp: number): string {
	const diffMs = Date.now() - timestamp;
	const diffMins = Math.floor(diffMs / (1000 * 60));
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
	if (diffMins < 1) return 'just now';
	if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
	if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
	return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function stripCandidate(candidate: MedicineCandidate | null | undefined): StoredMedicineCandidate | null {
	if (!candidate) return null;
	const { originalFiles: _originalFiles, ...stored } = candidate;
	return stored;
}

function restoreCandidate(
	candidate: StoredMedicineCandidate | null | undefined,
	photos: MedicineCapturedPhoto[]
): MedicineCandidate | null {
	if (!candidate) return null;
	const originalFiles = candidate.sourcePhotoIds
		.map((id) => photos.find((photo) => photo.id === id)?.file)
		.filter((file): file is File => Boolean(file));
	return { ...candidate, originalFiles };
}

export async function serializePhoto(photo: MedicineCapturedPhoto): Promise<StoredMedicinePhoto> {
	return {
		id: photo.id,
		filename: photo.file.name,
		mimeType: photo.file.type || 'image/jpeg',
		dataUrl: await fileToDataUrl(photo.file),
		takenAtMs: photo.takenAtMs,
		sessionOffsetMs: photo.sessionOffsetMs,
		note: photo.note,
		groupLabel: photo.groupLabel,
		ignored: photo.ignored,
		kind: photo.kind,
	};
}

export async function deserializePhoto(stored: StoredMedicinePhoto): Promise<MedicineCapturedPhoto> {
	const file = await dataUrlToFile(stored.dataUrl, stored.filename, stored.mimeType);
	return {
		id: stored.id,
		file,
		previewUrl: URL.createObjectURL(file),
		takenAtMs: stored.takenAtMs,
		sessionOffsetMs: stored.sessionOffsetMs,
		note: stored.note,
		groupLabel: stored.groupLabel,
		ignored: stored.ignored,
		kind: stored.kind,
	};
}

export function serializeCandidate(candidate: MedicineCandidate | null): StoredMedicineCandidate | null {
	return stripCandidate(candidate);
}

export function deserializeCandidate(
	candidate: StoredMedicineCandidate | null,
	photos: MedicineCapturedPhoto[]
): MedicineCandidate | null {
	return restoreCandidate(candidate, photos);
}

export function serializeQueuedScans(scans: MedicineQueuedScan[]): StoredMedicineQueuedScan[] {
	return scans.map((scan) => ({
		...scan,
		candidate: stripCandidate(scan.candidate),
		homeboxPayloadPreview: scan.homeboxPayloadPreview ?? null,
	}));
}

export function deserializeQueuedScans(
	scans: StoredMedicineQueuedScan[],
	photos: MedicineCapturedPhoto[]
): MedicineQueuedScan[] {
	return scans.map((scan) => ({
		...scan,
		status: scan.status === 'analyzing' ? ('recovered' as MedicineCandidateState) : scan.status,
		candidate: restoreCandidate(scan.candidate, photos),
		homeboxPayloadPreview: scan.homeboxPayloadPreview ?? null,
	}));
}

export async function save(session: StoredMedicineMission): Promise<void> {
	if (!browser) return;
	try {
		const db = await getDb();
		session.updatedAt = Date.now();
		const plainSession = JSON.parse(JSON.stringify(session)) as StoredMedicineMission;
		await db.put(STORE_NAME, plainSession, SESSION_KEY);
		log.debug(`Saved medicine mission: status=${session.status}, candidates=${session.queuedScans.length}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.warn(`Failed to save medicine mission: ${message}`);
	}
}

export async function load(): Promise<StoredMedicineMission | null> {
	if (!browser) return null;
	try {
		const db = await getDb();
		const session: StoredMedicineMission | undefined = await db.get(STORE_NAME, SESSION_KEY);
		if (!session) return null;
		if (isExpired(session) || !session.id) {
			await clear();
			return null;
		}
		return session;
	} catch (error) {
		log.warn('Failed to load medicine mission', error);
		await clear();
		return null;
	}
}

export async function hasRecoverableMission(): Promise<boolean> {
	const session = await load();
	if (!session || session.status === 'idle' || session.status === 'complete') return false;
	return Boolean(session.locationId || session.photos.length || session.queuedScans.length || session.candidate);
}

export async function getMissionSummary(): Promise<MedicineMissionSummary | null> {
	const session = await load();
	if (!session) return null;
	const recoverableStatuses = new Set<MedicineCandidateState>([
		'captured',
		'analyzing',
		'needs_review',
		'blocked',
		'ready',
		'failed',
		'recovered',
	]);
	return {
		ageText: formatAge(session.updatedAt),
		locationName: session.locationName,
		status: session.status,
		photoCount: session.photos.length,
		candidateCount: session.queuedScans.length,
		recoverableCount: session.queuedScans.filter((scan) => recoverableStatuses.has(scan.status)).length,
	};
}

export async function clear(): Promise<void> {
	if (!browser) return;
	try {
		const db = await getDb();
		await db.delete(STORE_NAME, SESSION_KEY);
	} catch (error) {
		log.warn('Failed to clear medicine mission', error);
	}
}
