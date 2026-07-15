import { requestFormData } from './client';

export interface AudioTranscriptSpan {
	id: string;
	text: string;
	startMs: number;
	endMs: number;
}

export interface AudioTranscriptResponse {
	text: string;
	spans: AudioTranscriptSpan[];
	source: 'server';
}

export const audio = {
	transcribe(blob: Blob, filename: string, signal?: AbortSignal): Promise<AudioTranscriptResponse> {
		const form = new FormData();
		form.append('audio', blob, filename);
		return requestFormData<AudioTranscriptResponse>('/tools/audio/transcribe', form, {
			signal,
			timeout: 120_000,
			errorMessage: 'Server transcription failed',
		});
	},
};
