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
	let activeTab = $state<'attention' | 'ready' | 'accepted' | 'submitted' | 'rejected' | 'all'>('attention');
	let manualName = $state('');
	let draftNames = $state<Record<string, string>>({});
	let filteredCandidates = $derived(
		workflow.state.candidates.filter((candidate) => activeTab === 'all' ||
			(activeTab === 'attention' && candidate.status === 'needs_review') || candidate.status === activeTab)
	);

	onMount(async () => {
		if (!workflow.state.candidates.length) await workflow.recover();
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
	<details class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-3">
		<summary class="cursor-pointer text-body-sm text-neutral-200">Homebox payload preview</summary>
		<pre class="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-caption text-neutral-400">{JSON.stringify(workflow.acceptedCandidates.map((candidate) => ({ name: candidate.name, quantity: candidate.quantity, description: candidate.description, tag_ids: candidate.tag_ids, parent_id: workflow.state.parentItemId, manufacturer: candidate.manufacturer, model_number: candidate.model_number, serial_number: candidate.serial_number })), null, 2)}</pre>
	</details>
	<div class="mb-4 flex gap-2 overflow-x-auto" role="tablist" aria-label="Candidate filters">
		{#each ['attention', 'ready', 'accepted', 'submitted', 'rejected', 'all'] as tab (tab)}
			<button class="rounded-full border px-3 py-2 text-caption {activeTab === tab ? 'border-blue-400 text-blue-200' : 'border-neutral-700 text-neutral-400'}" role="tab" aria-selected={activeTab === tab} onclick={() => (activeTab = tab as typeof activeTab)}>
				{tab} ({tab === 'all' ? workflow.state.candidates.length : workflow.state.candidates.filter((candidate) => tab === 'attention' ? candidate.status === 'needs_review' : candidate.status === tab).length})
			</button>
		{/each}
	</div>
	<div class="mb-4 flex gap-2">
		<input class="input-sm min-w-0 flex-1" placeholder="Add missing item" bind:value={manualName} />
		<Button variant="secondary" onclick={async () => { if (manualName.trim()) { workflow.addManualCandidate(manualName.trim()); manualName = ''; await workflow.persistCandidates(); } }}>Add</Button>
	</div>

	<div class="space-y-4">
		{#each filteredCandidates as candidate (candidate.id)}
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
							value={draftNames[candidate.id] ?? candidate.name}
							oninput={(event) => (draftNames[candidate.id] = (event.target as HTMLInputElement).value)}
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
						<Button variant="secondary" onclick={async () => { workflow.updateCandidate(candidate.id, { name: draftNames[candidate.id] ?? candidate.name }); await workflow.persistCandidates(); }}>Save changes</Button>
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
				{#if candidate.duplicateExistingItemId}
					<div class="mb-3 flex items-center justify-between rounded-lg border border-warning-500/50 p-2 text-caption text-warning-200">
						<span>Possible existing Homebox item</span>
						<button type="button" class="underline" onclick={() => workflow.resolveDuplicate(candidate.id, 'keep_new')}>Keep new</button>
					</div>
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
