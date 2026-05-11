<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { medicineIntakeWorkflow } from '$lib/workflows/medicineIntake.svelte';
	import { showToast } from '$lib/stores/ui.svelte';
	import Button from '$lib/components/Button.svelte';
	import StepIndicator from '$lib/components/StepIndicator.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import AnalysisProgressBar from '$lib/components/AnalysisProgressBar.svelte';
	import type { MedicineCandidate } from '$lib/types';
	import { AlertTriangle, Check, ExternalLink, ImageIcon, Pill, RotateCcw } from 'lucide-svelte';

	const workflow = medicineIntakeWorkflow;

	onMount(() => {
		if (!workflow.state.candidate) goto(resolve('/medicine-capture'));
	});

	function patch(patch: Partial<MedicineCandidate>) {
		workflow.updateCandidate(patch);
	}

	async function submit() {
		const ok = await workflow.submit();
		if (!ok && workflow.state.error) showToast(workflow.state.error, 'error');
	}

	function recover() {
		workflow.markActiveRecovered();
		showToast('Candidate kept for recovery. Fix fields and save again.', 'success');
	}

	function activeRecord() {
		return workflow.state.queuedScans.find((scan) => scan.id === workflow.state.activeQueueId);
	}

	function payloadPreview() {
		const payload = activeRecord()?.homeboxPayloadPreview;
		return JSON.stringify(payload ?? {}, null, 2);
	}
</script>

<svelte:head>
	<title>Medicine Review - Homebox Companion</title>
</svelte:head>

<div class="animate-in pb-36">
	<StepIndicator currentStep={3} />
	<BackLink href="/medicine-capture" label="Back to medicine inbox" />

	<h2 class="mb-1 text-h2 text-neutral-100">Medicine Command Center</h2>
	<p class="mb-4 text-body-sm text-neutral-400">
		Confirm confidence, blockers, evidence, and the exact Homebox payload before saving.
	</p>

	{#if workflow.state.candidate}
		{@const candidate = workflow.state.candidate}
		{@const record = activeRecord()}
		<div class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
			<div class="mb-3 flex items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-2">
					<Pill size={20} strokeWidth={1.5} class="text-success-300" />
					<h3 class="truncate font-semibold text-neutral-100">{candidate.name}</h3>
				</div>
				<span class="rounded-full border border-neutral-700 px-2 py-1 text-caption text-neutral-300">
					{record?.status ?? 'needs_review'} - {Math.round(candidate.confidence * 100)}%
				</span>
			</div>
			{#if record}
				<div class="mb-3 grid grid-cols-2 gap-2 text-caption text-neutral-400">
					<div class="rounded-lg bg-neutral-950 p-2">
						<p class="text-neutral-500">Mission</p>
						<p class="truncate text-neutral-200">{record.missionKind}</p>
					</div>
					<div class="rounded-lg bg-neutral-950 p-2">
						<p class="text-neutral-500">Location</p>
						<p class="truncate text-neutral-200">{record.selectedLocationPath}</p>
					</div>
					<div class="rounded-lg bg-neutral-950 p-2">
						<p class="text-neutral-500">Evidence</p>
						<p class="text-neutral-200">{record.evidencePhotoIds.length} photo refs</p>
					</div>
					<div class="rounded-lg bg-neutral-950 p-2">
						<p class="text-neutral-500">Corrections</p>
						<p class="text-neutral-200">{record.correctionHistory.length}</p>
					</div>
				</div>
			{/if}

			<div class="grid gap-3">
				<label class="grid gap-1 text-body-sm text-neutral-300">
					<span>Name</span>
					<input
						class="input-sm"
						value={candidate.name}
						oninput={(event) => patch({ name: event.currentTarget.value })}
					/>
				</label>
				<label class="grid gap-1 text-body-sm text-neutral-300">
					<span>What it's for</span>
					<textarea
						class="input-sm min-h-20"
						value={candidate.generalUse ?? ''}
						oninput={(event) =>
							patch({
								generalUse: event.currentTarget.value,
								description: event.currentTarget.value,
							})}
					></textarea>
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-body-sm text-neutral-300">
						<span>Expiry</span>
						<input
							class="input-sm"
							type="month"
							value={candidate.expiryDate ?? ''}
							oninput={(event) => {
								workflow.setExpiryDate(event.currentTarget.value);
								patch({ expiryDate: event.currentTarget.value });
							}}
						/>
					</label>
					<label class="grid gap-1 text-body-sm text-neutral-300">
						<span>Active ingredient</span>
						<input
							class="input-sm"
							value={candidate.activeIngredient ?? ''}
							oninput={(event) => patch({ activeIngredient: event.currentTarget.value })}
						/>
					</label>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-body-sm text-neutral-300">
						<span>Strength</span>
						<input
							class="input-sm"
							value={candidate.strength ?? ''}
							oninput={(event) => patch({ strength: event.currentTarget.value })}
						/>
					</label>
					<label class="grid gap-1 text-body-sm text-neutral-300">
						<span>Form</span>
						<input
							class="input-sm"
							value={candidate.form ?? ''}
							oninput={(event) => patch({ form: event.currentTarget.value })}
						/>
					</label>
				</div>
				<label class="grid gap-1 text-body-sm text-neutral-300">
					<span>Package</span>
					<input
						class="input-sm"
						value={candidate.packageSize ?? ''}
						oninput={(event) => patch({ packageSize: event.currentTarget.value })}
					/>
				</label>
				<label class="grid gap-1 text-body-sm text-neutral-300">
					<span>Notes</span>
					<textarea
						class="input-sm min-h-24"
						value={candidate.notes ?? ''}
						oninput={(event) => patch({ notes: event.currentTarget.value })}
					></textarea>
				</label>
			</div>
		</div>

		{#if record?.blockerReasons.length || record?.error || record?.duplicateSuspicions.length}
			<div class="mb-4 rounded-xl border border-warning-500/40 bg-warning-500/10 p-4">
				<div class="mb-2 flex items-center gap-2 text-warning-200">
					<AlertTriangle size={18} strokeWidth={1.5} />
					<h3 class="font-semibold">Decision Needed</h3>
				</div>
				<ul class="space-y-1 text-body-sm text-warning-100">
					{#if record?.error}
						<li>{record.error}</li>
					{/if}
					{#each record?.blockerReasons ?? [] as reason (reason)}
						<li>{reason}</li>
					{/each}
					{#each record?.duplicateSuspicions ?? [] as suspicion (suspicion)}
						<li>{suspicion}</li>
					{/each}
				</ul>
				{#if record?.status === 'failed'}
					<div class="mt-3">
						<Button variant="secondary" onclick={recover}>
							<RotateCcw size={16} strokeWidth={1.5} />
							<span>Recover Candidate</span>
						</Button>
					</div>
				{/if}
			</div>
		{/if}

		<div class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
			<h3 class="mb-3 font-semibold text-neutral-100">Notice Archive</h3>
			{#if candidate.databaseMatch}
				<p class="mb-2 text-body-sm text-neutral-300">
					{candidate.databaseMatch.source} match, {Math.round(
						candidate.databaseMatch.confidence * 100
					)}% confidence
				</p>
			{/if}
			<div class="grid gap-2">
				<input
					class="input-sm"
					placeholder="CIP13"
					value={candidate.cip13 ?? ''}
					oninput={(event) => patch({ cip13: event.currentTarget.value })}
				/>
				<input
					class="input-sm"
					placeholder="CIS"
					value={candidate.cis ?? ''}
					oninput={(event) => patch({ cis: event.currentTarget.value })}
				/>
				<input
					class="input-sm"
					placeholder="Official medicine page URL"
					value={candidate.officialPageUrl ?? ''}
					oninput={(event) => patch({ officialPageUrl: event.currentTarget.value })}
				/>
				<input
					class="input-sm"
					placeholder="Official notice URL"
					value={candidate.noticeUrl ?? ''}
					oninput={(event) => patch({ noticeUrl: event.currentTarget.value })}
				/>
				<input
					class="input-sm"
					placeholder="Official RCP URL"
					value={candidate.rcpUrl ?? ''}
					oninput={(event) => patch({ rcpUrl: event.currentTarget.value })}
				/>
			</div>
			{#if candidate.noticeUrl || candidate.officialPageUrl}
				<button
					type="button"
					class="mt-3 inline-flex items-center gap-2 text-body-sm text-primary-300"
					onclick={() =>
						window.open(
							candidate.noticeUrl ?? candidate.officialPageUrl ?? '',
							'_blank',
							'noopener,noreferrer'
						)}
				>
					<ExternalLink size={16} strokeWidth={1.5} />
					<span>Open official notice</span>
				</button>
			{/if}
		</div>

		<div class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
			<h3 class="mb-3 font-semibold text-neutral-100">Evidence</h3>
			<div class="flex flex-wrap gap-2">
			{#each record?.evidencePhotoIds ?? candidate.sourcePhotoIds as photoId (photoId)}
				{@const photo = workflow.state.photos.find((p) => p.id === photoId)}
				{#if photo}
					<img src={photo.previewUrl} alt="Evidence" class="h-20 w-20 rounded-lg object-cover" />
				{:else}
					<div class="flex h-20 w-20 items-center justify-center rounded-lg bg-neutral-800">
						<ImageIcon size={18} strokeWidth={1.5} class="text-neutral-500" />
					</div>
				{/if}
			{/each}
			{#if !(record?.evidencePhotoIds.length || candidate.sourcePhotoIds.length)}
				<p class="text-body-sm text-neutral-500">Barcode-only candidate. Add a label photo from the mission inbox if the package needs visual proof.</p>
			{/if}
			</div>
		</div>

		<div class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
			<h3 class="mb-3 font-semibold text-neutral-100">Homebox Payload Preview</h3>
			<pre class="max-h-72 overflow-auto rounded-lg bg-neutral-950 p-3 text-caption text-neutral-300">{payloadPreview()}</pre>
		</div>
	{/if}

	{#if workflow.state.submissionProgress}
		<AnalysisProgressBar
			current={workflow.state.submissionProgress.current}
			total={workflow.state.submissionProgress.total}
			message={workflow.state.submissionProgress.message}
		/>
	{/if}
</div>

<div class="fixed-bottom-panel p-4">
	<Button variant="primary" full onclick={submit}>
		<Check size={18} strokeWidth={2} />
		<span>Save Medicine</span>
	</Button>
</div>
