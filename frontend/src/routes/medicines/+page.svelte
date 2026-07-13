<script lang="ts">
	import { onMount } from 'svelte';
	import { medicines, type MedicineCatalogItem } from '$lib/api/medicines';
	import { resolve } from '$app/paths';

	type Filter = 'all' | 'expired' | 'expiring' | 'current' | 'unknown';
	let records: MedicineCatalogItem[] = [];
	let search = '';
	let filter: Filter = 'all';
	let loading = true;
	let error = '';
	let loadingProgress = '';

	onMount(async () => {
		try {
			loadingProgress = 'Loading all pages…';
			records = await medicines.listAll();
			loadingProgress = '';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load the cabinet';
		} finally {
			loading = false;
		}
	});

	$: query = search.trim().toLowerCase();
	$: allCount = records.length;
	$: expiredCount = records.filter((item) => item.expiry_state === 'expired').length;
	$: expiringCount = records.filter((item) => item.expiry_state === 'expiring').length;
	$: currentCount = records.filter((item) => item.expiry_state === 'current').length;
	$: unknownCount = records.filter((item) => item.expiry_state === 'unknown').length;
	$: filtered = records
		.filter((item) => filter === 'all' || item.expiry_state === filter)
		.filter((item) => {
			if (!query) return true;
			return [
				item.name,
				item.active_substances.join(' '),
				item.short_purpose ?? '',
				item.cip13 ?? '',
				item.cis ?? '',
			]
				.join(' ')
				.toLowerCase()
				.includes(query);
		})
		.sort(
			(a, b) =>
				(a.expiry_state === 'expired' ? -1 : 0) - (b.expiry_state === 'expired' ? -1 : 0) ||
				a.name.localeCompare(b.name)
		);
</script>

<svelte:head><title>Medicine cabinet</title></svelte:head>

<main class="mx-auto max-w-4xl space-y-6 p-4">
	<header class="space-y-2">
		<p class="text-caption text-primary-400">Medicine Cabinet</p>
		<h1 class="text-2xl font-semibold text-neutral-100">Your medicines</h1>
		<p class="text-body-sm text-neutral-300">Homebox remains the inventory source of truth.</p>
	</header>
	<label class="block space-y-2 text-body-sm text-neutral-200" for="medicine-search">
		<span>Search name, active substance, purpose, CIP13 or CIS</span>
		<input
			id="medicine-search"
			class="min-h-touch w-full rounded-lg border border-neutral-700 bg-neutral-900 p-3"
			bind:value={search}
			placeholder="Search medicines"
		/>
	</label>
	<nav aria-label="Expiry filters" class="flex gap-2 overflow-x-auto pb-1">
		{#each [['all', 'All'], ['expired', 'Expired'], ['expiring', 'Expiring soon'], ['current', 'Current'], ['unknown', 'Expiry unknown']] as option (option[0])}
			<button
				type="button"
				class:font-semibold={filter === option[0]}
				class="min-h-touch shrink-0 rounded-full border border-neutral-700 px-3 text-caption text-neutral-200"
				onclick={() => (filter = option[0] as Filter)}
			>
				{option[1]} ({option[0] === 'all'
					? allCount
					: option[0] === 'expired'
						? expiredCount
						: option[0] === 'expiring'
							? expiringCount
							: option[0] === 'current'
								? currentCount
								: unknownCount})
			</button>
		{/each}
	</nav>
	{#if loading}<p class="text-neutral-300">Loading cabinet…</p>
	{:else if error}<p role="alert" class="text-error-400">{error}</p>
	{:else if loadingProgress}<p class="text-neutral-300">{loadingProgress}</p>
	{:else if filtered.length === 0}<p
			class="rounded-lg border border-neutral-800 p-6 text-neutral-300"
		>
			No medicines match this view.
		</p>
	{:else}
		<section aria-label="Medicine items" class="grid gap-3 sm:grid-cols-2">
			{#each filtered as item (item.homebox_item_id)}
				<a
					class="block rounded-xl border border-neutral-800 bg-neutral-900 p-4 transition hover:border-primary-500"
					href={resolve(`/medicines/${item.homebox_item_id}`)}
				>
					<div class="flex gap-3">
						{#if item.package_photo_url}<img
								loading="lazy"
								src={item.package_photo_url}
								alt="Package for {item.name}"
								class="h-20 w-20 rounded-lg object-cover"
							/>{:else}<div
								class="flex h-20 w-20 items-center justify-center rounded-lg bg-neutral-800 text-caption text-neutral-500"
							>
								No photo
							</div>{/if}
						<div class="min-w-0">
							<h2 class="font-medium text-neutral-100">{item.name}</h2>
							<p class="text-body-sm text-neutral-400">
								{item.active_substances.join(', ') || 'Active substance unknown'}
							</p>
							<p class="mt-2 text-caption text-neutral-300">
								{item.expiry_date ?? 'Expiry unknown'} · {item.remaining_level ?? 'Level unknown'}
							</p>
						</div>
					</div>
				</a>
			{/each}
		</section>
	{/if}
</main>
