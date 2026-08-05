import { vision } from '$lib/api';
import * as bulkMissionDb from '$lib/services/bulkMissionDb';
import { fromAudioRecord, fromTranscriptSpanRecord } from '$lib/services/bulkRecordMappers';
import type { BulkMissionRecord, BulkStructuredError } from '$lib/types/bulkDomain';
import type { BulkAudioSegment, BulkTranscriptSpan } from '$lib/types';
import { workflowLogger as log } from '$lib/utils/logger';
import {
	bulkSweepWorkflow as baseWorkflow,
	type BulkMissionIdentity,
} from './bulkSweepBase.svelte';

export type { BulkMissionIdentity } from './bulkSweepBase.svelte';

type RuntimeWorkflow = typeof baseWorkflow & {
	_audioSegments: BulkAudioSegment[];
	_transcriptSpans: BulkTranscriptSpan[];
	_interimTranscriptText: string;
	_error: string | null;
	applyCommittedMissionTranscript(mission: BulkMissionRecord): void;
};

const workflow = baseWorkflow as RuntimeWorkflow;
const transcriptionPromises = new Map<string, Promise<void>>();
const transcriptionControllers = new Map<string, AbortController>();

function currentIdentity(identity: BulkMissionIdentity): boolean {
	const current = workflow.getMissionIdentity();
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
	segment: BulkAudioSegment,
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

function replaceAudio(record: Parameters<typeof fromAudioRecord>[0]): void {
	const converted = fromAudioRecord(record);
	workflow._audioSegments = workflow._audioSegments.map((entry) =>
		entry.id === converted.id ? converted : entry
	);
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
		if (!failure.committed || !failure.audio || !failure.mission || !currentIdentity(identity)) {
			return;
		}
		replaceAudio(failure.audio);
		workflow._error = error.message;
	} catch {
		log.error(`Bulk transcription persistence failed safely (${error.code})`);
	}
}

async function runAudioTranscription(segmentId: string): Promise<void> {
	const initial = workflow._audioSegments.find((entry) => entry.id === segmentId);
	if (!initial || (initial.status !== 'persisted' && initial.status !== 'failed')) return;

	const identity = workflow.getMissionIdentity();
	const currentAttemptId = attemptId(segmentId);
	let controller: AbortController | null = null;

	try {
		const attempt = await bulkMissionDb.beginAudioTranscriptionAttempt(
			identity.missionId,
			segmentId,
			currentAttemptId,
			Date.now()
		);
		replaceAudio(attempt.record);
		if (!attempt.acquired) return;

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
			...serverSpanOffsets(fromAudioRecord(attempt.record), result),
		});
		if (
			!committed.committed ||
			!committed.audio ||
			!committed.span ||
			!committed.mission ||
			!currentIdentity(identity)
		) {
			return;
		}

		replaceAudio(committed.audio);
		const span = fromTranscriptSpanRecord(committed.span);
		workflow._transcriptSpans = [
			...workflow._transcriptSpans.filter((entry) => entry.id !== span.id),
			span,
		];
		workflow.applyCommittedMissionTranscript(committed.mission);
		workflow._interimTranscriptText = '';
		workflow._error = null;
	} catch (error) {
		const structured = safeTranscriptionError(error);
		await persistAttemptFailure(identity, segmentId, currentAttemptId, structured);
		log.warn(`Bulk transcription attempt ended safely (${structured.code})`);
	} finally {
		if (controller && transcriptionControllers.get(segmentId) === controller) {
			transcriptionControllers.delete(segmentId);
		}
	}
}

workflow.transcribeAudioSegment = (segmentId: string): Promise<void> => {
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

workflow.retryAudioTranscription = async (segmentId: string): Promise<void> => {
	const segment = workflow._audioSegments.find((entry) => entry.id === segmentId);
	if (!segment || segment.status !== 'failed') return;
	await workflow.transcribeAudioSegment(segmentId);
};

workflow.cancelActiveTranscriptions = (): void => {
	for (const controller of transcriptionControllers.values()) controller.abort();
};

for (const methodName of [
	'discardPersistedMission',
	'continueSameArea',
	'finishLocation',
	'reset',
] as const) {
	const original = workflow[methodName].bind(workflow) as (...args: unknown[]) => unknown;
	(workflow as unknown as Record<string, unknown>)[methodName] = (...args: unknown[]) => {
		workflow.cancelActiveTranscriptions();
		return original(...args);
	};
}

export const bulkSweepWorkflow = workflow;
