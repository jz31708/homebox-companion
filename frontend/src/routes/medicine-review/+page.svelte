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
	import { AlertTriangle, Check, ExternalLink, ImageIcon, Pill } from 'lucide-svelte';

	const workflow = medicineIntakeWorkflow;

	onMount(() => {
		if (!workflow.state.candidate) goto(resolve('/medicine-capture'));
	});

	function patch(patch: Partial<MedicineCandidate>) {
		workflow.updateCandidate(patch);
	}

	function numberOrNull(value: string): number | null {
		const trimmed = value.trim();
		return trimmed === '' ? null : Math.max(0, Number(trimmed) || 0);
	}

	async function submit() {
		const ok = await workflow.submit();
		if (!ok && workflow.state.error) showToast(workflow.state.error, 'error');
	}
</script>

<svelte:head>
	<title>Medicine Review - Homebox Companion</title>
</svelte:head>

<div class="animate-in pb-36">
	<StepIndicator currentStep={3} />
	<BackLink href="/medicine-capture" label="Back to medicine photos" />

	<h2 class="mb-1 text-h2 text-neutral-100">Medicine Review</h2>
	<p class="mb-4 text-body-sm text-neutral-400">Check the AI-filled fields before Homebox.</p>

	{#if workflow.state.candidate}
		{@const candidate = workflow.state.candidate}
		<div class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
			<div class="mb-3 flex items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-2">
					<Pill size={20} strokeWidth={1.5} class="text-success-300" />
					<h3 class="truncate font-semibold text-neutral-100">{candidate.name}</h3>
				</div>
				<span class="text-caption text-neutral-500"
					>{Math.round(candidate.confidence * 100)}% confidence</span
				>
			</div>

			<div class="grid gap-3">
				<label class="grid gap-1 text-body-sm text-neutral-300">
					<span>Name</span>
					<input
						class="input-sm"
						value={candidate.name}
						oninput={(event) => patch({ name: event.currentTarget.value })}
					/>
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-body-sm text-neutral-300">
						<span>Active ingredient</span>
						<input
							class="input-sm"
							value={candidate.activeIngredient ?? ''}
							oninput={(event) => patch({ activeIngredient: event.currentTarget.value })}
						/>
					</label>
					<label class="grid gap-1 text-body-sm text-neutral-300">
						<span>Strength</span>
						<input
							class="input-sm"
							value={candidate.strength ?? ''}
							oninput={(event) => patch({ strength: event.currentTarget.value })}
						/>
					</label>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-body-sm text-neutral-300">
						<span>Form</span>
						<input
							class="input-sm"
							value={candidate.form ?? ''}
							oninput={(event) => patch({ form: event.currentTarget.value })}
						/>
					</label>
					<label class="grid gap-1 text-body-sm text-neutral-300">
						<span>Package</span>
						<input
							class="input-sm"
							value={candidate.packageSize ?? ''}
							oninput={(event) => patch({ packageSize: event.currentTarget.value })}
						/>
					</label>
				</div>
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
						<span>Opened</span>
						<input
							class="input-sm"
							type="date"
							value={candidate.openedDate ?? ''}
							oninput={(event) => {
								workflow.setOpenedDate(event.currentTarget.value);
								patch({ openedDate: event.currentTarget.value });
							}}
						/>
					</label>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-body-sm text-neutral-300">
						<span>Doses left</span>
						<input
							class="input-sm"
							type="number"
							min="0"
							value={candidate.remainingDoses ?? ''}
							oninput={(event) => {
								const value = numberOrNull(event.currentTarget.value);
								workflow.setRemainingDoses(value);
								patch({ remainingDoses: value });
							}}
						/>
					</label>
					<label class="grid gap-1 text-body-sm text-neutral-300">
						<span>Level</span>
						<select
							class="input-sm"
							value={candidate.remainingDoseLabel ?? 'unknown'}
							onchange={(event) => {
								const value = event.currentTarget.value as MedicineCandidate['remainingDoseLabel'];
								workflow.setRemainingDoseLabel(value ?? 'unknown');
								patch({ remainingDoseLabel: value });
							}}
						>
							<option value="full">Full</option>
							<option value="half">Half</option>
							<option value="low">Low</option>
							<option value="empty">Empty</option>
							<option value="unknown">Unknown</option>
						</select>
					</label>
				</div>
				<label class="grid gap-1 text-body-sm text-neutral-300">
					<span>Storage</span>
					<input
						class="input-sm"
						value={candidate.storage ?? ''}
						oninput={(event) => patch({ storage: event.currentTarget.value })}
					/>
				</label>
				<textarea
					class="input-sm min-h-24"
					value={candidate.notes ?? ''}
					oninput={(event) => patch({ notes: event.currentTarget.value })}
				></textarea>
			</div>
		</div>

		<div class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
			<h3 class="mb-3 font-semibold text-neutral-100">Public Data</h3>
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
			{#if candidate.noticeUrl}
				<button
					type="button"
					class="mt-3 inline-flex items-center gap-2 text-body-sm text-primary-300"
					onclick={() => window.open(candidate.noticeUrl ?? '', '_blank', 'noopener,noreferrer')}
				>
					<ExternalLink size={16} strokeWidth={1.5} />
					<span>Open reference</span>
				</button>
			{/if}
		</div>

		{#if candidate.uncertaintyReasons.length > 0}
			<div class="mb-4 rounded-xl border border-warning-500/40 bg-warning-500/10 p-4">
				<div class="mb-2 flex items-center gap-2 text-warning-200">
					<AlertTriangle size={18} strokeWidth={1.5} />
					<h3 class="font-semibold">Check These</h3>
				</div>
				<ul class="space-y-1 text-body-sm text-warning-100">
					{#each candidate.uncertaintyReasons as reason (reason)}
						<li>{reason}</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="mb-4 flex flex-wrap gap-2">
			{#each candidate.sourcePhotoIds as photoId (photoId)}
				{@const photo = workflow.state.photos.find((p) => p.id === photoId)}
				{#if photo}
					<img src={photo.previewUrl} alt="Evidence" class="h-20 w-20 rounded-lg object-cover" />
				{:else}
					<div class="flex h-20 w-20 items-center justify-center rounded-lg bg-neutral-800">
						<ImageIcon size={18} strokeWidth={1.5} class="text-neutral-500" />
					</div>
				{/if}
			{/each}
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
		<span>Submit Medicine</span>
	</Button>
</div>
