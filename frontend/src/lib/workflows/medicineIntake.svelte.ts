import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { medicines, vision } from '$lib/api';
import type { MedicineReference } from '$lib/api/medicines';
import { workflowLogger as log } from '$lib/utils/logger';
import * as medicineMissionPersistence from '$lib/services/medicineMissionPersistence';
import type {
	BatchCreateRequest,
	MedicineCandidate,
	MedicineCapturedPhoto,
	MedicineDetectResponse,
	MedicineCandidateState,
	MedicineIntakeState,
	MedicineIntakeStatus,
	MedicinePhotoKind,
	MedicineQueuedScan,
	Progress,
} from '$lib/types';

const AUTO_PERSIST_DEBOUNCE_MS = 1000;

function createId(prefix: string): string {
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeRevoke(url: string): void {
	if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

function medicineCustomFields(candidate: MedicineCandidate): Record<string, string> {
	const fields: Record<string, string> = { ...(candidate.custom_fields ?? {}) };
	const entries: Array<[string, string | number | null | undefined]> = [
		['Active ingredient', candidate.activeIngredient],
		['Strength', candidate.strength],
		['Medicine form', candidate.form],
		['Package size', candidate.packageSize],
		['Expiry date', candidate.expiryDate],
		['Opened date', candidate.openedDate],
		['Remaining doses', candidate.remainingDoses],
		['Remaining level', candidate.remainingDoseLabel],
		['Storage', candidate.storage],
		['General use (verify notice)', candidate.generalUse],
		['CIP13', candidate.cip13],
		['CIS', candidate.cis],
		['Official medicine page', candidate.officialPageUrl],
		['Official notice', candidate.noticeUrl],
		['Official RCP', candidate.rcpUrl],
	];
	for (const [key, value] of entries) {
		if (value !== null && value !== undefined && `${value}`.trim()) fields[key] = `${value}`;
	}
	return fields;
}

function buildMedicinePayload(
	candidate: MedicineCandidate,
	locationId: string | null
): BatchCreateRequest {
	return {
		location_id: locationId,
		items: [
			{
				name: candidate.name,
				quantity: candidate.quantity || 1,
				description: candidate.description,
				tag_ids: candidate.tag_ids,
				manufacturer: candidate.manufacturer,
				model_number: candidate.model_number,
				serial_number: candidate.serial_number,
				purchase_price: candidate.purchase_price,
				purchase_from: candidate.purchase_from,
				notes: candidate.notes,
				custom_fields: medicineCustomFields(candidate),
			},
		],
	};
}

function candidateBlockers(candidate: MedicineCandidate): string[] {
	return candidate.name?.trim() ? [] : ['Medicine name is required before saving.'];
}

function candidateStatus(candidate: MedicineCandidate): MedicineCandidateState {
	const blockers = candidateBlockers(candidate);
	if (blockers.some((reason) => reason.toLowerCase().includes('missing'))) return 'blocked';
	return blockers.length > 0 ? 'needs_review' : 'ready';
}

function candidateAiSummary(candidate: MedicineCandidate): string {
	const parts = [candidate.name, candidate.generalUse, candidate.databaseMatch?.source]
		.filter(Boolean)
		.map((value) => `${value}`);
	return parts.join(' | ');
}

function candidateFromReference(
	reference: MedicineReference,
	input: {
		id: string;
		expiryDate: string;
		openedDate: string;
		remainingDoseLabel: MedicineCandidate['remainingDoseLabel'];
		photoIds: string[];
	}
): MedicineCandidate {
	return {
		id: input.id,
		name: reference.name,
		quantity: 1,
		description: '',
		activeIngredient: reference.active_substances.join(', '),
		form: reference.pharmaceutical_form,
		packageSize: reference.presentation,
		expiryDate: input.expiryDate || null,
		openedDate: input.openedDate || null,
		remainingDoseLabel: input.remainingDoseLabel,
		cip13: reference.cip13,
		cis: reference.cis,
		officialPageUrl: reference.official_page_url,
		noticeUrl: reference.notice_url,
		rcpUrl: reference.rcp_url,
		confidence: 1,
		uncertaintyReasons: [],
		sourcePhotoIds: input.photoIds,
		databaseMatch: {
			source: 'bdpm',
			cis: reference.cis,
			cip13: reference.cip13,
			denomination: reference.name,
			form: reference.pharmaceutical_form,
			activeSubstances: reference.active_substances,
			officialPageUrl: reference.official_page_url,
			noticeUrl: reference.notice_url,
			rcpUrl: reference.rcp_url,
			confidence: 1,
		},
	};
}

class MedicineIntakeWorkflow {
	private _status = $state<MedicineIntakeStatus>('idle');
	private _locationId = $state<string | null>(null);
	private _locationName = $state<string | null>(null);
	private _locationPath = $state<string | null>(null);
	private _startedAtMs = $state<number | null>(null);
	private _photos = $state<MedicineCapturedPhoto[]>([]);
	private _note = $state('');
	private _barcodeText = $state('');
	private _expiryDate = $state('');
	private _openedDate = $state('');
	private _remainingDoses = $state<number | null>(null);
	private _remainingDoseLabel = $state<'full' | 'half' | 'low' | 'empty' | 'unknown'>('unknown');
	private _candidate = $state<MedicineCandidate | null>(null);
	private _queuedScans = $state<MedicineQueuedScan[]>([]);
	private _activeQueueId = $state<string | null>(null);
	private _analysisProgress = $state<Progress | null>(null);
	private _submissionProgress = $state<Progress | null>(null);
	private _error = $state<string | null>(null);
	private _warnings = $state<string[]>([]);
	private abortController: AbortController | null = null;
	private queueProcessing = false;
	private missionId = createId('mission_medicine');
	private _stateProxy: MedicineIntakeState | null = null;
	private persistedCreatedAt: number | null = null;
	private persistedSessionId: string | null = null;
	private persistTimeout: ReturnType<typeof setTimeout> | null = null;
	private persistChain: Promise<void> = Promise.resolve();
	private isFirstEffectRun = true;

	constructor() {
		if (typeof window !== 'undefined') this.setupAutoPersist();
	}

	private setupAutoPersist(): void {
		$effect.root(() => {
			$effect(() => {
				const status = this._status;
				const locationId = this._locationId;
				const locationName = this._locationName;
				const locationPath = this._locationPath;
				const startedAtMs = this._startedAtMs;
				const photos = this._photos;
				const note = this._note;
				const barcodeText = this._barcodeText;
				const expiryDate = this._expiryDate;
				const openedDate = this._openedDate;
				const remainingDoses = this._remainingDoses;
				const remainingDoseLabel = this._remainingDoseLabel;
				const candidate = this._candidate;
				const queuedScans = this._queuedScans;
				const activeQueueId = this._activeQueueId;
				const warnings = this._warnings;
				const error = this._error;

				void locationId;
				void locationName;
				void locationPath;
				void startedAtMs;
				void photos.length;
				void note;
				void barcodeText;
				void expiryDate;
				void openedDate;
				void remainingDoses;
				void remainingDoseLabel;
				void candidate?.id;
				void queuedScans.length;
				void activeQueueId;
				void warnings.length;
				void error;

				if (this.isFirstEffectRun) {
					this.isFirstEffectRun = false;
					return;
				}
				if (status === 'idle' || status === 'complete' || status === 'submitting') return;
				this.schedulePersist();
			});
		});
		window.addEventListener('beforeunload', () => this.flushPendingPersist());
	}

	private schedulePersist(): void {
		if (this.persistTimeout) clearTimeout(this.persistTimeout);
		this.persistTimeout = setTimeout(() => {
			this.persistTimeout = null;
			void this.persistAsync();
		}, AUTO_PERSIST_DEBOUNCE_MS);
	}

	private flushPendingPersist(): void {
		if (!this.persistTimeout) return;
		clearTimeout(this.persistTimeout);
		this.persistTimeout = null;
		void this.persistAsync();
	}

	get state(): MedicineIntakeState {
		if (!this._stateProxy) {
			// eslint-disable-next-line @typescript-eslint/no-this-alias -- Required for live getters in Proxy handlers
			const workflow = this;
			this._stateProxy = new Proxy({} as MedicineIntakeState, {
				get(_target, prop: string | symbol) {
					if (typeof prop === 'symbol') return undefined;
					switch (prop as keyof MedicineIntakeState) {
						case 'status':
							return workflow._status;
						case 'locationId':
							return workflow._locationId;
						case 'locationName':
							return workflow._locationName;
						case 'locationPath':
							return workflow._locationPath;
						case 'startedAtMs':
							return workflow._startedAtMs;
						case 'photos':
							return workflow._photos;
						case 'note':
							return workflow._note;
						case 'barcodeText':
							return workflow._barcodeText;
						case 'expiryDate':
							return workflow._expiryDate;
						case 'openedDate':
							return workflow._openedDate;
						case 'remainingDoses':
							return workflow._remainingDoses;
						case 'remainingDoseLabel':
							return workflow._remainingDoseLabel;
						case 'candidate':
							return workflow._candidate;
						case 'queuedScans':
							return workflow._queuedScans;
						case 'activeQueueId':
							return workflow._activeQueueId;
						case 'error':
							return workflow._error;
						case 'warnings':
							return workflow._warnings;
						case 'analysisProgress':
							return workflow._analysisProgress;
						case 'submissionProgress':
							return workflow._submissionProgress;
						default:
							throw new TypeError(`Unknown Medicine Intake state property: ${String(prop)}`);
					}
				},
			});
		}
		return this._stateProxy;
	}

	start(locationId: string, locationName: string, locationPath: string): void {
		this.reset();
		this._status = 'capturing';
		this._locationId = locationId;
		this._locationName = locationName;
		this._locationPath = locationPath;
		this._startedAtMs = Date.now();
	}

	addPhotos(files: File[], kind: MedicinePhotoKind = 'other'): void {
		if (!this._startedAtMs) this._startedAtMs = Date.now();
		const now = Date.now();
		const added = files.map((file) => ({
			id: createId('m'),
			file,
			previewUrl: URL.createObjectURL(file),
			takenAtMs: now,
			sessionOffsetMs: now - (this._startedAtMs ?? now),
			note: '',
			groupLabel: '',
			ignored: false,
			kind,
		}));
		this._photos = [...this._photos, ...added];
	}

	updatePhoto(
		id: string,
		patch: Partial<Pick<MedicineCapturedPhoto, 'note' | 'groupLabel' | 'ignored' | 'kind'>>
	): void {
		this._photos = this._photos.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo));
	}

	removePhoto(id: string): void {
		const removed = this._photos.find((photo) => photo.id === id);
		if (removed) safeRevoke(removed.previewUrl);
		this._photos = this._photos.filter((photo) => photo.id !== id);
	}

	setNote(value: string): void {
		this._note = value;
	}

	setBarcodeText(value: string): void {
		this._barcodeText = value;
	}

	setExpiryDate(value: string): void {
		this._expiryDate = value;
		if (this._candidate) this.updateCandidate({ expiryDate: value || null });
	}

	setOpenedDate(value: string): void {
		this._openedDate = value;
		if (this._candidate) this.updateCandidate({ openedDate: value || null });
	}

	setRemainingDoses(value: number | null): void {
		this._remainingDoses = value;
		if (this._candidate) this.updateCandidate({ remainingDoses: value });
	}

	setRemainingDoseLabel(value: 'full' | 'half' | 'low' | 'empty' | 'unknown'): void {
		this._remainingDoseLabel = value;
		if (this._candidate) this.updateCandidate({ remainingDoseLabel: value });
	}

	async analyze(): Promise<MedicineDetectResponse | null> {
		const activePhotos = this._photos.filter((photo) => !photo.ignored);
		if (activePhotos.length === 0) {
			this._error = 'Add at least one non-ignored medicine photo before analysis.';
			return null;
		}
		this.abortController = new AbortController();
		this._status = 'analyzing';
		this._analysisProgress = { current: 1, total: 3, message: 'Reading label photos...' };
		this._error = null;
		try {
			const result = await vision.medicineDetect(
				{
					photos: activePhotos,
					allPhotos: this._photos,
					locationId: this._locationId,
					locationName: this._locationName,
					locationPath: this._locationPath,
					note: this._note,
					barcodeText: this._barcodeText,
					expiryDate: this._expiryDate,
					openedDate: this._openedDate,
					remainingDoses: this._remainingDoses,
					remainingDoseLabel: this._remainingDoseLabel,
				},
				{ signal: this.abortController.signal }
			);
			this._analysisProgress = { current: 3, total: 3, message: 'Preparing medicine review...' };
			this._candidate = this.attachLocalFiles(result.candidate, true);
			this._warnings = result.warnings;
			const scan = this.upsertCandidateRecord({
				code: this._barcodeText.trim() || 'photo-analysis',
				candidate: this._candidate,
				warnings: result.warnings,
				fallbackStatus: candidateStatus(this._candidate),
				evidencePhotoIds: this._candidate.sourcePhotoIds.length
					? this._candidate.sourcePhotoIds
					: activePhotos.map((photo) => photo.id),
			});
			this._activeQueueId = scan.id;
			this._status = 'reviewing';
			return result;
		} catch (error) {
			this._error =
				error instanceof Error && error.name === 'AbortError'
					? 'Analysis cancelled'
					: error instanceof Error
						? error.message
						: 'Medicine analysis failed';
			this._status = 'capturing';
			return null;
		} finally {
			this.abortController = null;
			this._analysisProgress = null;
		}
	}

	async lookupBarcode(): Promise<MedicineDetectResponse | null> {
		const code = this._barcodeText.trim();
		if (!code) {
			this._error = 'Scan or enter a medicine code first.';
			return null;
		}
		this.abortController = new AbortController();
		this._status = 'analyzing';
		this._analysisProgress = { current: 1, total: 2, message: 'Looking up scanned code...' };
		this._error = null;
		try {
			const local = await medicines.lookup(code, this.abortController.signal);
			let result: MedicineDetectResponse;
			if (local.reference) {
				const reference = local.reference;
				result = {
					candidate: candidateFromReference(reference, {
						id: createId('medicine'),
						expiryDate: this._expiryDate,
						openedDate: this._openedDate,
						remainingDoseLabel: this._remainingDoseLabel,
						photoIds: this._photos.map((photo) => photo.id),
					}),
					warnings: local.warnings,
				};
			} else {
				result = await vision.medicineLookup(
					{
						barcodeText: code,
						note: this._note,
						expiryDate: this._expiryDate,
						openedDate: this._openedDate,
						remainingDoses: this._remainingDoses,
						remainingDoseLabel: this._remainingDoseLabel,
					},
					{ signal: this.abortController.signal }
				);
			}
			this._analysisProgress = { current: 2, total: 2, message: 'Preparing medicine review...' };
			this._candidate = this.attachLocalFiles(result.candidate, false);
			this._warnings = result.warnings;
			const scan = this.upsertCandidateRecord({
				code,
				candidate: this._candidate,
				warnings: result.warnings,
				fallbackStatus: candidateStatus(this._candidate),
				evidencePhotoIds: this._candidate.sourcePhotoIds,
			});
			this._activeQueueId = scan.id;
			this._status = 'reviewing';
			return result;
		} catch (error) {
			this._error =
				error instanceof Error && error.name === 'AbortError'
					? 'Lookup cancelled'
					: error instanceof Error
						? error.message
						: 'Medicine lookup failed';
			this._status = 'capturing';
			return null;
		} finally {
			this.abortController = null;
			this._analysisProgress = null;
		}
	}

	enqueueBarcode(code: string): MedicineQueuedScan {
		const normalized = code.trim();
		const existing = this._queuedScans.find(
			(scan) => scan.code === normalized && scan.status !== 'failed' && scan.status !== 'submitted'
		);
		if (existing) return existing;
		const now = Date.now();
		const scan: MedicineQueuedScan = {
			id: createId('mq'),
			missionId: this.missionId,
			missionKind: 'medicine_intake',
			code: normalized,
			status: 'captured',
			createdAtMs: now,
			updatedAtMs: now,
			selectedLocationId: this._locationId,
			selectedLocationPath: this._locationPath,
			evidencePhotoIds: this._photos.filter((photo) => !photo.ignored).map((photo) => photo.id),
			userNote: this._note,
			correctionHistory: [],
			confidence: null,
			blockerReasons: [],
			duplicateSuspicions: [],
			homeboxPayloadPreview: null,
			warnings: [],
		};
		this._queuedScans = [scan, ...this._queuedScans];
		void this.persistAsync();
		void this.processQueuedScans();
		return scan;
	}

	retryQueuedScan(id: string): void {
		this._queuedScans = this._queuedScans.map((scan) =>
			scan.id === id
				? {
						...scan,
						status: 'recovered',
						error: null,
						updatedAtMs: Date.now(),
					}
				: scan
		);
		void this.processQueuedScans();
	}

	removeQueuedScan(id: string): void {
		this._queuedScans = this._queuedScans.filter((scan) => scan.id !== id);
		if (this._activeQueueId === id) {
			this._activeQueueId = null;
			this._candidate = null;
		}
		void this.persistAsync();
	}

	openQueuedScan(id: string): boolean {
		const scan = this._queuedScans.find((item) => item.id === id);
		if (
			!scan?.candidate ||
			!['ready', 'needs_review', 'blocked', 'failed', 'recovered'].includes(scan.status)
		) {
			return false;
		}
		this._candidate = this.attachLocalFiles(scan.candidate, false);
		this._warnings = scan.warnings ?? [];
		this._activeQueueId = id;
		this._status = 'reviewing';
		void this.persistAsync();
		return true;
	}

	openNextReadyScan(): boolean {
		const scan = this._queuedScans.find(
			(item) =>
				['ready', 'needs_review', 'blocked', 'failed', 'recovered'].includes(item.status) &&
				item.candidate
		);
		return scan ? this.openQueuedScan(scan.id) : false;
	}

	markActiveRecovered(): void {
		if (!this._activeQueueId) return;
		this._queuedScans = this._queuedScans.map((scan) =>
			scan.id === this._activeQueueId
				? { ...scan, status: 'recovered', error: null, updatedAtMs: Date.now() }
				: scan
		);
	}

	private async processQueuedScans(): Promise<void> {
		if (this.queueProcessing) return;
		this.queueProcessing = true;
		try {
			while (true) {
				const scan = this._queuedScans.find(
					(item) => item.status === 'captured' || item.status === 'recovered'
				);
				if (!scan) break;
				this._queuedScans = this._queuedScans.map((item) =>
					item.id === scan.id
						? { ...item, status: 'analyzing', error: null, updatedAtMs: Date.now() }
						: item
				);
				await this.persistAsync();
				try {
					const local = await medicines.lookup(scan.code);
					const result = local.reference
						? {
								candidate: candidateFromReference(local.reference, {
									id: createId('medicine'),
									expiryDate: this._expiryDate,
									openedDate: this._openedDate,
									remainingDoseLabel: this._remainingDoseLabel,
									photoIds: scan.evidencePhotoIds,
								}),
								warnings: local.warnings,
							}
						: await vision.medicineLookup({
								barcodeText: scan.code,
								note: scan.userNote,
								expiryDate: this._expiryDate,
								openedDate: this._openedDate,
								remainingDoses: this._remainingDoses,
								remainingDoseLabel: this._remainingDoseLabel,
							});
					const nextScans: MedicineQueuedScan[] = this._queuedScans.map((item) =>
						item.id === scan.id
							? {
									...item,
									status: candidateStatus(result.candidate),
									candidate: result.candidate,
									warnings: result.warnings,
									error: null,
									aiSummary: candidateAiSummary(result.candidate),
									confidence: result.candidate.confidence,
									blockerReasons: candidateBlockers(result.candidate),
									duplicateSuspicions: result.candidate.databaseMatch
										? []
										: ['No public database match.'],
									homeboxPayloadPreview: buildMedicinePayload(result.candidate, this._locationId),
									updatedAtMs: Date.now(),
								}
							: item
					);
					await this.persistSnapshot({ queuedScans: nextScans });
					this._queuedScans = nextScans;
				} catch (error) {
					const nextScans: MedicineQueuedScan[] = this._queuedScans.map((item) =>
						item.id === scan.id
							? {
									...item,
									status: 'failed' as const,
									error: error instanceof Error ? error.message : 'Medicine lookup failed',
									updatedAtMs: Date.now(),
								}
							: item
					);
					await this.persistSnapshot({ queuedScans: nextScans });
					this._queuedScans = nextScans;
				}
			}
		} finally {
			this.queueProcessing = false;
		}
	}

	private upsertCandidateRecord(input: {
		code: string;
		candidate: MedicineCandidate;
		warnings: string[];
		fallbackStatus: MedicineCandidateState;
		evidencePhotoIds: string[];
	}): MedicineQueuedScan {
		const now = Date.now();
		const existing = this._queuedScans.find((scan) => scan.code === input.code);
		const next: MedicineQueuedScan = {
			...(existing ?? {
				id: createId('mq'),
				missionId: this.missionId,
				missionKind: 'medicine_intake' as const,
				code: input.code,
				createdAtMs: now,
				correctionHistory: [],
				duplicateSuspicions: [],
			}),
			status: input.fallbackStatus,
			updatedAtMs: now,
			selectedLocationId: this._locationId,
			selectedLocationPath: this._locationPath,
			evidencePhotoIds: input.evidencePhotoIds,
			userNote: this._note,
			candidate: input.candidate,
			warnings: input.warnings,
			error: null,
			aiSummary: candidateAiSummary(input.candidate),
			confidence: input.candidate.confidence,
			blockerReasons: candidateBlockers(input.candidate),
			duplicateSuspicions: input.candidate.databaseMatch ? [] : ['No public database match.'],
			homeboxPayloadPreview: buildMedicinePayload(input.candidate, this._locationId),
		};
		this._queuedScans = existing
			? this._queuedScans.map((scan) => (scan.id === existing.id ? next : scan))
			: [next, ...this._queuedScans];
		void this.persistAsync();
		return next;
	}

	private attachLocalFiles(
		candidate: MedicineCandidate,
		fallbackToAllPhotos: boolean
	): MedicineCandidate {
		const files = candidate.sourcePhotoIds
			.map((id) => this._photos.find((photo) => photo.id === id)?.file)
			.filter((file): file is File => Boolean(file));
		return {
			...candidate,
			originalFiles: files.length
				? files
				: fallbackToAllPhotos
					? this._photos.map((photo) => photo.file)
					: [],
		};
	}

	updateCandidate(patch: Partial<MedicineCandidate>): void {
		if (!this._candidate) return;
		const nextPatch = { ...patch };
		if (
			Object.prototype.hasOwnProperty.call(patch, 'generalUse') &&
			!Object.prototype.hasOwnProperty.call(patch, 'description')
		) {
			nextPatch.description = patch.generalUse || null;
		}
		this._candidate = { ...this._candidate, ...nextPatch };
		if (this._activeQueueId) {
			const candidate = this._candidate;
			this._queuedScans = this._queuedScans.map((scan) =>
				scan.id === this._activeQueueId
					? {
							...scan,
							status: scan.status === 'submitted' ? scan.status : candidateStatus(candidate),
							candidate,
							updatedAtMs: Date.now(),
							correctionHistory: [
								...scan.correctionHistory,
								{ atMs: Date.now(), fields: Object.keys(patch) },
							],
							confidence: candidate.confidence,
							blockerReasons: candidateBlockers(candidate),
							homeboxPayloadPreview: buildMedicinePayload(candidate, this._locationId),
						}
					: scan
			);
		}
		void this.persistAsync();
	}

	async submit(): Promise<boolean> {
		const candidate = this._candidate;
		if (!candidate) {
			this._error = 'Analyze and review a medicine before submitting.';
			return false;
		}
		this._status = 'submitting';
		this._submissionProgress = { current: 0, total: 1, message: 'Creating medicine item...' };
		try {
			if (!this._locationId) throw new Error('Choose a medicine location before saving.');
			const created = await medicines.create(
				candidate,
				this._locationId,
				(candidate.originalFiles ?? []).slice(0, 3)
			);
			if (created.warnings.length) this._warnings = [...created.warnings];
			this._submissionProgress = { current: 1, total: 1, message: 'Medicine submitted.' };
			if (this._activeQueueId) {
				const submittedId = this._activeQueueId;
				this._queuedScans = this._queuedScans.map((scan) =>
					scan.id === submittedId ? { ...scan, status: 'submitted', updatedAtMs: Date.now() } : scan
				);
				const next = this._queuedScans.find(
					(scan) =>
						['ready', 'needs_review', 'blocked', 'failed', 'recovered'].includes(scan.status) &&
						scan.candidate
				);
				if (next) {
					this.openQueuedScan(next.id);
				} else {
					this._candidate = null;
					this._activeQueueId = null;
					this._status = 'capturing';
					await this.persistAsync();
					goto(resolve('/medicine-capture'));
				}
			} else {
				this._status = 'complete';
				this.startNextAtSameLocation();
				await this.persistAsync();
				goto(resolve('/medicine-capture'));
			}
			return true;
		} catch (error) {
			log.error('Medicine submission failed', error);
			this._error = error instanceof Error ? error.message : 'Medicine submission failed';
			if (this._activeQueueId) {
				const message = this._error;
				this._queuedScans = this._queuedScans.map((scan) =>
					scan.id === this._activeQueueId
						? { ...scan, status: 'failed', error: message, updatedAtMs: Date.now() }
						: scan
				);
			}
			await this.persistAsync();
			this._status = 'reviewing';
			return false;
		} finally {
			this._submissionProgress = null;
		}
	}

	async persistAsync(): Promise<void> {
		if (this._status === 'idle' || this._status === 'complete') return;
		if (this.persistTimeout) {
			clearTimeout(this.persistTimeout);
			this.persistTimeout = null;
		}
		await this.persistSnapshot();
	}

	private async persistSnapshot(
		overrides: { queuedScans?: MedicineQueuedScan[] } = {}
	): Promise<void> {
		this.persistChain = this.persistChain
			.catch(() => undefined)
			.then(() => this.doPersist(overrides));
		await this.persistChain;
	}

	private async doPersist(overrides: { queuedScans?: MedicineQueuedScan[] } = {}): Promise<void> {
		try {
			const now = Date.now();
			if (this.persistedCreatedAt === null) this.persistedCreatedAt = now;
			if (this.persistedSessionId === null) this.persistedSessionId = createId('stored_medicine');
			const photos = await Promise.all(this._photos.map(medicineMissionPersistence.serializePhoto));
			const queuedScans = overrides.queuedScans ?? this._queuedScans;
			await medicineMissionPersistence.save({
				id: this.persistedSessionId,
				createdAt: this.persistedCreatedAt,
				updatedAt: now,
				missionId: this.missionId,
				status: this._status === 'analyzing' ? 'capturing' : this._status,
				locationId: this._locationId,
				locationName: this._locationName,
				locationPath: this._locationPath,
				startedAtMs: this._startedAtMs,
				photos,
				note: this._note,
				barcodeText: this._barcodeText,
				expiryDate: this._expiryDate,
				openedDate: this._openedDate,
				remainingDoses: this._remainingDoses,
				remainingDoseLabel: this._remainingDoseLabel,
				candidate: medicineMissionPersistence.serializeCandidate(this._candidate),
				queuedScans: medicineMissionPersistence.serializeQueuedScans(queuedScans),
				activeQueueId: this._activeQueueId,
				warnings: this._warnings,
				error: this._error,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.warn(`Medicine mission persistence failed: ${message}`);
		}
	}

	async recover(): Promise<boolean> {
		const session = await medicineMissionPersistence.load();
		if (!session) return false;
		for (const photo of this._photos) safeRevoke(photo.previewUrl);
		const photos = await Promise.all(
			session.photos.map(medicineMissionPersistence.deserializePhoto)
		);
		this.missionId = session.missionId;
		this._status =
			session.status === 'analyzing' || session.status === 'submitting'
				? 'capturing'
				: session.status;
		this._locationId = session.locationId;
		this._locationName = session.locationName;
		this._locationPath = session.locationPath;
		this._startedAtMs = session.startedAtMs ?? Date.now();
		this._photos = photos;
		this._note = session.note;
		this._barcodeText = session.barcodeText;
		this._expiryDate = session.expiryDate;
		this._openedDate = session.openedDate;
		this._remainingDoses = session.remainingDoses;
		this._remainingDoseLabel = session.remainingDoseLabel;
		this._candidate = medicineMissionPersistence.deserializeCandidate(session.candidate, photos);
		this._queuedScans = medicineMissionPersistence.deserializeQueuedScans(
			session.queuedScans,
			photos
		);
		this._activeQueueId = session.activeQueueId;
		this._warnings = session.warnings;
		this._error = session.error;
		this._analysisProgress = null;
		this._submissionProgress = null;
		this.persistedCreatedAt = session.createdAt;
		this.persistedSessionId = session.id;
		void this.processQueuedScans();
		return true;
	}

	async hasRecoverableMission(): Promise<boolean> {
		return medicineMissionPersistence.hasRecoverableMission();
	}

	async clearPersistedMission(): Promise<void> {
		await medicineMissionPersistence.clear();
	}

	cancelAnalysis(): void {
		this.abortController?.abort();
	}

	reset(): void {
		if (this.persistTimeout) {
			clearTimeout(this.persistTimeout);
			this.persistTimeout = null;
		}
		for (const photo of this._photos) safeRevoke(photo.previewUrl);
		this._status = 'idle';
		this._locationId = null;
		this._locationName = null;
		this._locationPath = null;
		this._startedAtMs = null;
		this._photos = [];
		this._note = '';
		this._barcodeText = '';
		this._expiryDate = '';
		this._openedDate = '';
		this._remainingDoses = null;
		this._remainingDoseLabel = 'unknown';
		this._candidate = null;
		this._queuedScans = [];
		this._activeQueueId = null;
		this.missionId = createId('mission_medicine');
		this._analysisProgress = null;
		this._submissionProgress = null;
		this._error = null;
		this._warnings = [];
		this.persistedCreatedAt = null;
		this.persistedSessionId = null;
		void this.clearPersistedMission();
	}

	private startNextAtSameLocation(): void {
		const locationId = this._locationId;
		const locationName = this._locationName;
		const locationPath = this._locationPath;
		for (const photo of this._photos) safeRevoke(photo.previewUrl);
		this._status = 'capturing';
		this._locationId = locationId;
		this._locationName = locationName;
		this._locationPath = locationPath;
		this._startedAtMs = Date.now();
		this._photos = [];
		this._note = '';
		this._barcodeText = '';
		this._expiryDate = '';
		this._openedDate = '';
		this._remainingDoses = null;
		this._remainingDoseLabel = 'unknown';
		this._candidate = null;
		this._activeQueueId = null;
		this._analysisProgress = null;
		this._submissionProgress = null;
		this._error = null;
		this._warnings = [];
	}
}

export const medicineIntakeWorkflow = new MedicineIntakeWorkflow();
