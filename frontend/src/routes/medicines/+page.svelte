<script lang="ts">
	import { onMount } from 'svelte';
	import { items } from '$lib/api';
	import type { ItemSummary } from '$lib/types';

	let medicines: ItemSummary[] = [];
	let search = '';
	let loading = true;
	let error = '';

	onMount(async () => {
		try {
			medicines = await items.list();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load the cabinet';
		} finally {
			loading = false;
		}
	});

	$: filtered = medicines.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
</script>

<svelte:head><title>Medicine cabinet</title></svelte:head>

<main class="mx-auto max-w-3xl space-y-6 p-4">
	<header class="space-y-2">
		<p class="text-caption text-primary-400">Medicine Cabinet</p>
		<h1 class="text-2xl font-semibold text-neutral-100">Your medicines</h1>
		<p class="text-body-sm text-neutral-300">Homebox remains the inventory source of truth.</p>
	</header>
	<label class="block space-y-2 text-body-sm text-neutral-200" for="medicine-search">
		<span>Search by name</span>
		<input id="medicine-search" class="min-h-touch w-full rounded-lg border border-neutral-700 bg-neutral-900 p-3" bind:value={search} placeholder="Search medicines" />
	</label>
	{#if loading}<p class="text-neutral-300">Loading cabinet…</p>
	{:else if error}<p role="alert" class="text-error-400">{error}</p>
	{:else if filtered.length === 0}<p class="rounded-lg border border-neutral-800 p-6 text-neutral-300">No medicine items yet.</p>
	{:else}
		<section aria-label="Medicine items" class="grid gap-3 sm:grid-cols-2">
			{#each filtered as item}
				<article class="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
					<h2 class="font-medium text-neutral-100">{item.name}</h2>
					<p class="text-body-sm text-neutral-400">Quantity: {item.quantity}</p>
				</article>
			{/each}
		</section>
	{/if}
</main>
