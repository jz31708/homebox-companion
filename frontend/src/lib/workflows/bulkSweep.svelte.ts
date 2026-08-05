import { vision } from '$lib/api';
import * as bulkMissionDb from '$lib/services/bulkMissionDb';
import type { BulkAudioSegment } from '$lib/types';
import type { BulkStructuredError } from '$lib/types/bulkDomain';
import { workflowLogger as log } from '$lib/utils/logger';
import { SvelteMap } from 'svelte/reactivity';
import {
	bulkSweepWorkflow as baseWorkflow,
	type BulkMissionIdentity,
} from './bulkSweepBase.svelte';

export type { BulkMissionIdentity } from './bulkSweepBase.svelte';

const transcriptionPromises = new Map<string, Promise<void>>();
const transcriptionControllers = new Map<string, AbortController>();
const activeAudioOverlay = new SvelteMap<
	string,
	Pick<BulkAudioSegment, 'status' | 'retryCount' | 'activeAttemptId' | 'activeAttemptStartedAtMs'>
>();

const durableState = baseWorkflow.state;
const narratedState = new Proxy(durableState, {
	get(target, property: string | symbol) {
		if (property === 'audioSegments') {
			return target.audioSegments.map((segment) => {
				const overlay = activeAudioOverlay.get(segment.id);
				return overlay ? { ...segment, ...overlay } : segment;
			});
		}
		return Reflect.get(target, property, target);
	},
});
Object.defineProperty(baseWorkflow, 'state', {
	configurable: true,
	get: () => narratedState,
});

function currentIdentity(identity: BulkMissionIdentity): boolean {
	const current = baseWorkflow.getMissionIdentity();
	return current.missionId === identity.missionId && current.generation === identity.generation;
}

function attemptId(segmentId: string): string {
	const unique =
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
	return `${segmentId}:attempt_${unique}`;
}

function normalizedMime(mimeType: string): string {
	return mimeType.split(';', 1)[0].trim().toLowerCase();
}

function filenameForAudio(segmentId: string, mimeType: string): string {
	const extension: Record<string, string> = {
		'audio/webm': '.webm',
		'audio/ogg': '.ogg',
		'audio/wav': '.wav',
		'audio/x-wav': '.wav',
		'audio/mpeg': '.mp3',
		'audio/mp4': '.m4a',
		'audio/x-m4a': '.m4a',
	};
	return `${segmentId}${extension[normalizedMime(mimeType)] ?? '.webm'}`;
}

function safeTranscriptionError(error: unknown): BulkStructuredError {
	const value = error as { name?: string; status?: number; statusCode?: number };
	if (value?.name === 'AbortError') {
		return {
			code: 'TRANSCRIPTION_CANCELLED',
			message: 'Transcription was cancelled. Retry this recording.',
			retryable: true,
		};
	}
	const status = value?.status ?? value?.statusCode;
	if (status === 401 || status === 403) {
		return {
			code: 'TRANSCRIPTION_AUTH_FAILED',
			message: 'Authentication failed. Sign in again before retrying.',
			retryable: true,
		};
	}
	if (status === 413) {
		return {
			code: 'TRANSCRIPTION_AUDIO_TOO_LARGE',
			message: 'This recording is too large to transcribe.',
			retryable: false,
		};
	}
	if (status === 415) {
		return {
			code: 'TRANSCRIPTION_AUDIO_UNSUPPORTED',
			message: 'This recording format is not supported.',
			retryable: false,
		};
	}
	return {
		code: 'TRANSCRIPTION_FAILED',
		message: 'Server transcription failed. Retry this recording.',
		retryable: true,
	};
}

function serverSpanOffsets(
	segment: Pick<BulkAudioSegment, 'startedAtMs' | 'endedAtMs'>,
	response: { start_offset_ms?: number | null; end_offset_ms?: number | null }
): { startOffsetMs: number; endOffsetMs: number } {
	const start = segment.startedAtMs;
	const end = segment.endedAtMs;
	const duration = Math.max(0, end - start);
	const providerStart = response.start_offset_ms;
	const providerEnd = response.end_offset_ms;
	if (
		typeof providerStart !== 'number' ||
		!Number.isFinite(providerStart) ||
		typeof providerEnd !== 'number' ||
		!Number.isFinite(providerEnd) ||
		providerStart < 0 ||
		providerEnd < providerStart
	) {
		return { startOffsetMs: start, endOffsetMs: end };
	}
	const boundedStart = Math.min(duration, providerStart);
	const boundedEnd = Math.min(duration, providerEnd);
	if (boundedEnd < boundedStart) return { startOffsetMs: start, endOffsetMs: end };
	return { startOffsetMs: start + boundedStart, endOffsetMs: start + boundedEnd };
}

async function resynchronizeCurrentMission(identity: BulkMissionIdentity): Promise<void> {
	if (!currentIdentity(identity)) return;
	await baseWorkflow.recover();
}

async function persistAttemptFailure(
	identity: BulkMissionIdentity,
	segmentId: string,
	currentAttemptId: string,
	error: BulkStructuredError
): Promise<void> {
	try {
		const failure = await bulkMissionDb.commitAudioTranscriptionFailure(
			identity.missionId,
			segmentId,
			currentAttemptId,
			error
		);
		if (failure.committed && currentIdentity(identity)) {
			await resynchronizeCurrentMission(identity);
		}
	} catch {
		log.error(`Bulk transcription persistence failed safely (${error.code})`);
	}
}

async function runAudioTranscription(segmentId: string): Promise<void> {
	const initial = baseWorkflow.state.audioSegments.find((entry) => entry.id === segmentId);
	if (!initial || (initial.status !== 'persisted' && initial.status !== 'failed')) return;

	const identity = baseWorkflow.getMissionIdentity();
	const currentAttemptId = attemptId(segmentId);
	let controller: AbortController | null = null;

	try {
		const attempt = await bulkMissionDb.beginAudioTranscriptionAttempt(
			identity.missionId,
			segmentId,
			currentAttemptId,
			Date.now()
		);
		if (!attempt.acquired) return;
		activeAudioOverlay.set(segmentId, {
			status: attempt.record.status,
			retryCount: attempt.record.retryCount,
			activeAttemptId: attempt.record.activeAttemptId,
			activeAttemptStartedAtMs: attempt.record.activeAttemptStartedAtMs,
		});

		if (!currentIdentity(identity)) {
			await persistAttemptFailure(identity, segmentId, currentAttemptId, {
				code: 'TRANSCRIPTION_CANCELLED',
				message: 'Transcription was cancelled. Retry this recording.',
				retryable: true,
			});
			return;
		}

		controller = new AbortController();
		transcriptionControllers.set(segmentId, controller);
		const result = await vision.transcribeAudio(
			attempt.record.blob,
			filenameForAudio(segmentId, attempt.record.mimeType),
			{ signal: controller.signal }
		);

		if (
			!currentIdentity(identity) ||
			transcriptionControllers.get(segmentId) !== controller
		) {
			await persistAttemptFailure(identity, segmentId, currentAttemptId, {
				code: 'TRANSCRIPTION_CANCELLED',
				message: 'Transcription was cancelled. Retry this recording.',
				retryable: true,
			});
			return;
		}

		const text = result.text.trim();
		if (!text) throw new Error('Empty normalized transcript');
		const committed = await bulkMissionDb.commitAudioTranscriptionSuccess({
			missionId: identity.missionId,
			segmentId,
			attemptId: currentAttemptId,
			text,
			...serverSpanOffsets(attempt.record, result),
		});
		if (!committed.committed || !currentIdentity(identity)) return;
		await resynchronizeCurrentMission(identity);
	} catch (error) {
		const structured = safeTranscriptionError(error);
		await persistAttemptFailure(identity, segmentId, currentAttemptId, structured);
		log.warn(`Bulk transcription attempt ended safely (${structured.code})`);
	} finally {
		activeAudioOverlay.delete(segmentId);
		if (controller && transcriptionControllers.get(segmentId) === controller) {
			transcriptionControllers.delete(segmentId);
		}
	}
}

baseWorkflow.transcribeAudioSegment = (segmentId: string): Promise<void> => {
	const existing = transcriptionPromises.get(segmentId);
	if (existing) return existing;
	const promise = runAudioTranscription(segmentId).finally(() => {
		if (transcriptionPromises.get(segmentId) === promise) {
			transcriptionPromises.delete(segmentId);
		}
	});
	transcriptionPromises.set(segmentId, promise);
	return promise;
};

baseWorkflow.retryAudioTranscription = async (segmentId: string): Promise<void> => {
	const segment = baseWorkflow.state.audioSegments.find((entry) => entry.id === segmentId);
	if (!segment || segment.status !== 'failed') return;
	await baseWorkflow.transcribeAudioSegment(segmentId);
};

baseWorkflow.cancelActiveTranscriptions = (): void => {
	for (const controller of transcriptionControllers.values()) controller.abort();
};

const mutableWorkflow = baseWorkflow as unknown as Record<
	string,
	(...args: unknown[]) => unknown
>;
for (const methodName of [
	'discardPersistedMission',
	'continueSameArea',
	'finishLocation',
	'reset',
] as const) {
	const original = mutableWorkflow[methodName].bind(baseWorkflow);
	mutableWorkflow[methodName] = (...args: unknown[]) => {
		baseWorkflow.cancelActiveTranscriptions();
		return original(...args);
	};
}

export const bulkSweepWorkflow = baseWorkflow;
