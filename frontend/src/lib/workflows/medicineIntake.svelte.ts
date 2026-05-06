import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { items, vision } from '$lib/api';
import { workflowLogger as log } from '$lib/utils/logger';
import type {
	BatchCreateRequest,
	MedicineCandidate,
	MedicineCapturedPhoto,
	MedicineDetectResponse,
	MedicineIntakeState,
	MedicineIntakeStatus,
	MedicinePhotoKind,
	Progress,
} from '$lib/types';

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
	private _analysisProgress = $state<Progress | null>(null);
	private _submissionProgress = $state<Progress | null>(null);
	private _error = $state<string | null>(null);
	private _warnings = $state<string[]>([]);
	private abortController: AbortController | null = null;
	private _stateProxy: MedicineIntakeState | null = null;

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
			this._candidate = this.attachLocalFiles(result.candidate);
			this._warnings = result.warnings;
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
			const result = await vision.medicineLookup(
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
			this._analysisProgress = { current: 2, total: 2, message: 'Preparing medicine review...' };
			this._candidate = this.attachLocalFiles(result.candidate);
			this._warnings = result.warnings;
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

	private attachLocalFiles(candidate: MedicineCandidate): MedicineCandidate {
		const files = candidate.sourcePhotoIds
			.map((id) => this._photos.find((photo) => photo.id === id)?.file)
			.filter((file): file is File => Boolean(file));
		return {
			...candidate,
			originalFiles: files.length ? files : this._photos.map((photo) => photo.file),
		};
	}

	updateCandidate(patch: Partial<MedicineCandidate>): void {
		if (!this._candidate) return;
		this._candidate = { ...this._candidate, ...patch };
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
			const request: BatchCreateRequest = {
				location_id: this._locationId,
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
			const created = await items.create(request);
			const item = created.created[0];
			if (item?.id) {
				for (const file of candidate.originalFiles?.slice(0, 6) ?? []) {
					await items.uploadAttachment(item.id, file);
				}
			}
			this._submissionProgress = { current: 1, total: 1, message: 'Medicine submitted.' };
			this._status = 'complete';
			this.startNextAtSameLocation();
			goto(resolve('/medicine-capture'));
			return true;
		} catch (error) {
			log.error('Medicine submission failed', error);
			this._error = error instanceof Error ? error.message : 'Medicine submission failed';
			this._status = 'reviewing';
			return false;
		} finally {
			this._submissionProgress = null;
		}
	}

	cancelAnalysis(): void {
		this.abortController?.abort();
	}

	reset(): void {
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
		this._analysisProgress = null;
		this._submissionProgress = null;
		this._error = null;
		this._warnings = [];
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
		this._analysisProgress = null;
		this._submissionProgress = null;
		this._error = null;
		this._warnings = [];
	}
}

export const medicineIntakeWorkflow = new MedicineIntakeWorkflow();
