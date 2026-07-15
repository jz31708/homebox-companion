<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as db from '$lib/services/bulkMissionDb';
	import { bulkSweepWorkflow } from '$lib/workflows/bulkSweep.svelte';
	import Button from '$lib/components/Button.svelte';

	let mission = $state<Awaited<ReturnType<typeof db.loadActiveMission>>>(null);
	let dismissed = $state(false);

	onMount(async () => {
		await db.cleanupStaleMissions();
		mission = await db.loadActiveMission();
	});

	async function resume() {
		if (await bulkSweepWorkflow.recover()) {
			const route = ['reviewing', 'submitting', 'complete'].includes(bulkSweepWorkflow.state.status)
				? '/bulk-review'
				: '/bulk-capture';
			goto(resolve(route));
		}
	}

	async function discard() {
		if (!mission || !confirm('Discard this saved sweep and all of its captured evidence?')) return;
		await db.discardMission(mission.id);
		mission = null;
	}
</script>

{#if mission && !dismissed}
	<div
		class="mb-4 rounded-xl border border-primary-500/50 bg-primary-500/10 p-4"
		data-testid="bulk-resume-banner"
	>
		<div class="mb-2 font-semibold text-neutral-100">Resume apartment sweep</div>
		<p class="mb-3 text-body-sm text-neutral-300">
			{mission.areaLabel} · {mission.photoIds.length} saved photo{mission.photoIds.length === 1
				? ''
				: 's'}
		</p>
		<div class="flex flex-wrap gap-2">
			<Button variant="primary" onclick={resume}>Resume</Button>
			<Button variant="secondary" onclick={discard}>Discard</Button>
			<button
				class="px-3 text-body-sm text-neutral-400 underline"
				type="button"
				onclick={() => (dismissed = true)}>Later</button
			>
		</div>
	</div>
{/if}
