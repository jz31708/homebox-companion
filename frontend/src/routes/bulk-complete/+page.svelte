<script lang="ts">
	import { bulkSweepWorkflow } from '$lib/workflows/bulkSweep.svelte';
	import Button from '$lib/components/Button.svelte';
</script>

<svelte:head><title>Bulk Sweep Complete - Homebox Companion</title></svelte:head>

<div class="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
	<h1 class="mb-3 text-h1 text-neutral-100">Sweep complete</h1>
	<p class="mb-8 text-body text-neutral-300">Accepted items were added to {bulkSweepWorkflow.state.locationPath ?? 'this location'}.</p>
	<div class="w-full space-y-3">
		<Button variant="primary" full onclick={() => bulkSweepWorkflow.continueSameArea()}>Sweep another shelf or box</Button>
		<Button variant="secondary" full onclick={() => bulkSweepWorkflow.finishLocation()}>Finish this location</Button>
	</div>
</div>
