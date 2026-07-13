import { request, requestFormData } from './client';
import type { MedicineCandidate } from '../types';

export interface MedicineReference {
	cip13: string;
	cip7?: string | null;
	cis: string;
	name: string;
	pharmaceutical_form?: string | null;
	presentation?: string | null;
	active_substances: string[];
	authorization_holder?: string | null;
	official_page_url: string;
	notice_url: string;
	rcp_url?: string | null;
	source_updated_at?: string | null;
	source_name: string;
}

export interface MedicineLookupResponse {
	reference: MedicineReference | null;
	lookupSource: 'bdpm-local' | 'manual';
	warnings: string[];
}

export interface MedicineCreateResponse {
	itemId: string;
	created: boolean;
	photoUploaded: boolean;
	noticeAttached: boolean;
	warnings: string[];
}

export interface MedicineCatalogItem {
	homebox_item_id: string;
	name: string;
	active_substances: string[];
	short_purpose: string | null;
	expiry_date: string | null;
	expiry_state: 'expired' | 'expiring' | 'current' | 'unknown';
	days_until_expiry: number | null;
	location_id: string | null;
	location_path: string | null;
	cip13: string | null;
	cis: string | null;
	package_photo_url: string | null;
	official_notice_url: string | null;
	notice_attachment_url: string | null;
	remaining_level: string | null;
}

export const medicines = {
	lookup: (barcodeText: string, signal?: AbortSignal) =>
		request<MedicineLookupResponse>('/medicines/lookup', {
			method: 'POST',
			body: JSON.stringify({ barcode_text: barcodeText }),
			signal,
		}),

	list: (page = 1, pageSize = 50, signal?: AbortSignal) =>
		request<{ items: MedicineCatalogItem[]; page: number; pageSize: number; total: number }>(
			`/medicines?page=${page}&page_size=${pageSize}`,
			{ signal }
		),

	get: (itemId: string, signal?: AbortSignal) =>
		request<MedicineCatalogItem>(`/medicines/${itemId}`, { signal }),

	create: (
		candidate: MedicineCandidate,
		locationId: string,
		photos: File[],
		signal?: AbortSignal
	) => {
		const form = new FormData();
		form.append(
			'draft',
			JSON.stringify({
				draft_id: candidate.id,
				barcode_text: candidate.cip13,
				cip13: candidate.cip13,
				display_name: candidate.name,
				expiry_date: candidate.expiryDate || null,
				opened_date: candidate.openedDate || null,
				remaining_level: candidate.remainingDoseLabel || 'unknown',
				location_id: locationId,
				user_note: candidate.notes || null,
				reference: candidate.databaseMatch
					? {
							cip13: candidate.databaseMatch.cip13 || candidate.cip13,
							cis: candidate.databaseMatch.cis,
							name: candidate.name,
							pharmaceutical_form: candidate.form,
							presentation: candidate.packageSize,
							active_substances: candidate.databaseMatch.activeSubstances || [],
							official_page_url: candidate.officialPageUrl,
							notice_url: candidate.noticeUrl,
							rcp_url: candidate.rcpUrl,
							source_name: 'Base de Données Publique des Médicaments',
						}
					: null,
			})
		);
		for (const photo of photos) form.append('photos', photo);
		return requestFormData<MedicineCreateResponse>('/medicines', form, {
			errorMessage: 'Medicine save failed; your draft was kept',
			signal,
		});
	},

	refreshNotice: (itemId: string, signal?: AbortSignal) =>
		request<{ ok: boolean; checksum: string | null }>(`/medicines/${itemId}/notice/refresh`, {
			method: 'POST',
			signal,
		}),
};
