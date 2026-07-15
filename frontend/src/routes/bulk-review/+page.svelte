<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { bulkSweepWorkflow } from '$lib/workflows/bulkSweep.svelte';
	import { showToast } from '$lib/stores/ui.svelte';
	import Button from '$lib/components/Button.svelte';
	import StepIndicator from '$lib/components/StepIndicator.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import AnalysisProgressBar from '$lib/components/AnalysisProgressBar.svelte';
	import { Check, X, Pencil, Package, AlertTriangle, ImageIcon } from 'lucide-svelte';

	const workflow = bulkSweepWorkflow;
	let editingId = $state<string | null>(null);

	onMount(() => {
		if (!workflow.state.candidates.length) goto(resolve('/bulk-capture'));
	});

	async function submit() {
		const ok = await workflow.submitAccepted();
		if (!ok && workflow.state.error) showToast(workflow.state.error, 'error');
	}
</script>

<svelte:head>
	<title>Bulk Review - Homebox Companion</title>
</svelte:head>

<div class="animate-in pb-36">
	<StepIndicator currentStep={3} />
	<BackLink href="/bulk-capture" label="Back to sweep" />

	<h2 class="mb-1 text-h2 text-neutral-100">Bulk Review</h2>
	<p class="mb-4 text-body-sm text-neutral-400">
		Approve candidates before anything is sent to Homebox.
	</p>

	{#if workflow.state.stats}
		<div
			class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-body-sm text-neutral-300"
		>
			{workflow.state.stats.candidate_count} candidates from {workflow.state.stats.photo_count} photos.
		</div>
	{/if}

	<div class="mb-4 flex gap-2">
		<Button
			variant="secondary"
			onclick={() =>
				workflow.state.candidates.forEach((c) => workflow.setCandidateStatus(c.id, 'accepted'))}
			>Accept all</Button
		>
	</div>

	<div class="space-y-4">
		{#each workflow.state.candidates as candidate (candidate.id)}
			<div
				class="rounded-xl border bg-neutral-900 p-4 {candidate.status === 'accepted'
					? 'border-success-500/70'
					: candidate.status === 'rejected'
						? 'border-error-500/50 opacity-70'
						: 'border-neutral-700'}"
			>
				<div class="mb-3 flex items-start justify-between gap-3">
					<div class="min-w-0">
						<div class="mb-1 flex items-center gap-2">
							<Package size={18} strokeWidth={1.5} class="text-neutral-400" />
							<h3 class="truncate font-semibold text-neutral-100">{candidate.name}</h3>
						</div>
						<p class="text-caption text-neutral-500">Review status: {candidate.status} · Qty {candidate.quantity}</p>
						<p class="hidden text-caption text-neutral-500">
							Confidence {Math.round(candidate.confidence * 100)}% · Qty {candidate.quantity}
						</p>
					</div>
					{#if candidate.uncertaintyReasons.length > 0}
						<AlertTriangle size={18} strokeWidth={1.5} class="shrink-0 text-warning-400" />
					{/if}
				</div>

				{#if editingId === candidate.id}
					<div class="mb-3 grid gap-2">
						<input
							class="input-sm"
							value={candidate.name}
							oninput={(event) =>
								workflow.updateCandidate(candidate.id, { name: event.currentTarget.value })}
						/>
						<input
							class="input-sm"
							type="number"
							min="1"
							value={candidate.quantity}
							oninput={(event) =>
								workflow.updateCandidate(candidate.id, {
									quantity: Number(event.currentTarget.value) || 1,
								})}
						/>
						<textarea
							class="input-sm min-h-20"
							value={candidate.description ?? ''}
							oninput={(event) =>
								workflow.updateCandidate(candidate.id, { description: event.currentTarget.value })}
						></textarea>
					</div>
				{:else if candidate.description}
					<p class="mb-3 text-body-sm text-neutral-300">{candidate.description}</p>
				{/if}

				<div class="mb-3 flex flex-wrap gap-2">
					{#each candidate.sourcePhotoIds as photoId (photoId)}
						{@const photo = workflow.state.photos.find((p) => p.id === photoId)}
						{#if photo}
							<img
								src={photo.previewUrl}
								alt="Evidence"
								class="h-16 w-16 rounded-lg object-cover"
							/>
						{:else}
							<div class="flex h-16 w-16 items-center justify-center rounded-lg bg-neutral-800">
								<ImageIcon size={18} strokeWidth={1.5} class="text-neutral-500" />
							</div>
						{/if}
					{/each}
				</div>

				{#if candidate.evidence.length > 0}
					<ul class="mb-3 space-y-1 text-caption text-neutral-500">
						{#each candidate.evidence.slice(0, 3) as evidence, index (index)}
							<li>{evidence.reason ?? evidence.quote ?? 'Evidence attached'}</li>
						{/each}
					</ul>
				{/if}

				<div class="flex gap-2">
					<Button
						variant="primary"
						onclick={() => workflow.setCandidateStatus(candidate.id, 'accepted')}
					>
						<Check size={16} strokeWidth={2} />
						<span>Accept</span>
					</Button>
					<Button
						variant="secondary"
						onclick={() => (editingId = editingId === candidate.id ? null : candidate.id)}
					>
						<Pencil size={16} strokeWidth={1.5} />
						<span>Edit</span>
					</Button>
					<Button
						variant="secondary"
						onclick={() => workflow.setCandidateStatus(candidate.id, 'rejected')}
					>
						<X size={16} strokeWidth={1.5} />
						<span>Reject</span>
					</Button>
				</div>
			</div>
		{/each}
	</div>

	{#if workflow.state.submissionProgress}
		<div class="mt-4">
			<AnalysisProgressBar
				current={workflow.state.submissionProgress.current}
				total={workflow.state.submissionProgress.total}
				message={workflow.state.submissionProgress.message}
			/>
		</div>
	{/if}
</div>

<div class="fixed-bottom-panel p-4">
	<Button variant="primary" full onclick={submit}>
		<Check size={18} strokeWidth={2} />
		<span>Submit Accepted ({workflow.acceptedCandidates.length})</span>
	</Button>
</div>
