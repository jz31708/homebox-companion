<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { medicines, type MedicineCatalogItem } from '$lib/api/medicines';

	let item: MedicineCatalogItem | null = null;
	let loading = true;
	let error = '';
	let retrying = false;

	onMount(async () => {
		try {
			const itemId = page.params.itemId;
			if (!itemId) throw new Error('Medicine item id is missing');
			item = await medicines.get(itemId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load medicine';
		} finally {
			loading = false;
		}
	});

	async function retryNotice() {
		if (!item) return;
		retrying = true;
		try {
			await medicines.refreshNotice(item.homebox_item_id);
			item = await medicines.get(item.homebox_item_id);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Notice retry failed';
		} finally {
			retrying = false;
		}
	}
</script>

<svelte:head><title>{item?.name ?? 'Medicine detail'}</title></svelte:head>

<main class="mx-auto max-w-3xl space-y-6 p-4">
	{#if loading}<p class="text-neutral-300">Loading medicine…</p>
	{:else if error}<p role="alert" class="text-error-400">{error}</p>
	{:else if item}
		<a class="text-body-sm text-primary-300" href={resolve('/medicines')}>← Back to cabinet</a>
		<header class="space-y-2">
			<h1 class="text-2xl font-semibold text-neutral-100">{item.name}</h1>
			<p class="text-neutral-300">
				{item.active_substances.join(', ') || 'Active substance unknown'}
			</p>
			<p class="text-body-sm text-neutral-400">
				{item.expiry_date ?? 'Expiry unknown'} · {item.remaining_level ?? 'Level unknown'}
			</p>
		</header>
		{#if item.package_photo_url}<img
				src={item.package_photo_url}
				alt="Package for {item.name}"
				class="max-h-96 w-full rounded-xl object-contain"
			/>{/if}
		<section class="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
			<h2 class="font-semibold text-neutral-100">Official notice</h2>
			{#if item.official_notice_url}<a
					class="block text-primary-300"
					href={item.official_notice_url}
					target="_blank"
					rel="noreferrer">Open official notice</a
				>{:else}<p class="text-neutral-400">Notice unavailable</p>{/if}
			{#if item.notice_attachment_url}<a
					class="block text-primary-300"
					href={item.notice_attachment_url}
					target="_blank"
					rel="noreferrer">Open attached PDF</a
				>{:else if item.cis}<button
					type="button"
					class="min-h-touch rounded-lg border border-neutral-700 px-3 text-neutral-200"
					disabled={retrying}
					onclick={retryNotice}>{retrying ? 'Retrying…' : 'Retry notice snapshot'}</button
				>{/if}
		</section>
	{/if}
</main>
