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
	import type { MedicinePhotoKind } from '$lib/types';
	import {
		Camera,
		CalendarDays,
		Hash,
		ImagePlus,
		PackageOpen,
		Sparkles,
		Trash2,
	} from 'lucide-svelte';

	const workflow = medicineIntakeWorkflow;
	let fileInput: HTMLInputElement;
	let pendingKind = $state<MedicinePhotoKind>('front');

	const kindLabels: Record<MedicinePhotoKind, string> = {
		front: 'Box/front',
		expiry: 'Expiry',
		doses: 'Doses',
		notice: 'Notice',
		other: 'Other',
	};

	onMount(() => {
		if (!workflow.state.locationId) goto(resolve('/location'));
	});

	function pick(kind: MedicinePhotoKind) {
		pendingKind = kind;
		fileInput.click();
	}

	function addFiles(files: FileList | null) {
		if (!files?.length) return;
		workflow.addPhotos(Array.from(files), pendingKind);
		if (fileInput) fileInput.value = '';
	}

	function setRemainingDoses(value: string) {
		const trimmed = value.trim();
		workflow.setRemainingDoses(trimmed === '' ? null : Math.max(0, Number(trimmed) || 0));
	}

	async function analyze() {
		const result = await workflow.analyze();
		if (result) goto(resolve('/medicine-review'));
		else if (workflow.state.error) showToast(workflow.state.error, 'error');
	}
</script>

<svelte:head>
	<title>Medicine Intake - Homebox Companion</title>
</svelte:head>

<div class="animate-in pb-36">
	<StepIndicator currentStep={2} />
	<BackLink href="/mode" label="Back to mode choice" />

	<h2 class="mb-1 text-h2 text-neutral-100">Medicine Intake</h2>
	<p class="mb-4 text-body-sm text-neutral-400">{workflow.state.locationPath}</p>

	<div class="mb-4 grid grid-cols-2 gap-3">
		<Button variant="primary" onclick={() => pick('front')}>
			<Camera size={18} strokeWidth={1.5} />
			<span>Box</span>
		</Button>
		<Button variant="secondary" onclick={() => pick('expiry')}>
			<CalendarDays size={18} strokeWidth={1.5} />
			<span>Expiry</span>
		</Button>
		<Button variant="secondary" onclick={() => pick('doses')}>
			<PackageOpen size={18} strokeWidth={1.5} />
			<span>Doses</span>
		</Button>
		<Button variant="secondary" onclick={() => pick('other')}>
			<ImagePlus size={18} strokeWidth={1.5} />
			<span>Other</span>
		</Button>
	</div>
	<input
		bind:this={fileInput}
		class="hidden"
		type="file"
		accept="image/*"
		capture="environment"
		multiple
		onchange={(event) => addFiles(event.currentTarget.files)}
	/>

	<section class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
		<div class="mb-3 flex items-center gap-2 text-neutral-100">
			<Hash size={18} strokeWidth={1.5} />
			<h3 class="font-semibold">Optional Code</h3>
		</div>
		<input
			class="input"
			placeholder="Barcode, CIP13, or text visible on the box"
			value={workflow.state.barcodeText}
			oninput={(event) => workflow.setBarcodeText(event.currentTarget.value)}
		/>
	</section>

	<section class="mb-4 grid gap-3 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
		<div class="grid grid-cols-2 gap-3">
			<label class="grid gap-1 text-body-sm text-neutral-300">
				<span>Expiry</span>
				<input
					class="input-sm"
					type="month"
					value={workflow.state.expiryDate}
					oninput={(event) => workflow.setExpiryDate(event.currentTarget.value)}
				/>
			</label>
			<label class="grid gap-1 text-body-sm text-neutral-300">
				<span>Opened</span>
				<input
					class="input-sm"
					type="date"
					value={workflow.state.openedDate}
					oninput={(event) => workflow.setOpenedDate(event.currentTarget.value)}
				/>
			</label>
		</div>
		<label class="grid gap-1 text-body-sm text-neutral-300">
			<span>Number of doses left</span>
			<input
				class="input-sm"
				type="number"
				min="0"
				inputmode="numeric"
				value={workflow.state.remainingDoses ?? ''}
				oninput={(event) => setRemainingDoses(event.currentTarget.value)}
			/>
		</label>
		<div class="grid grid-cols-5 gap-2">
			{#each ['full', 'half', 'low', 'empty', 'unknown'] as label (label)}
				<button
					type="button"
					class="rounded-lg border px-2 py-2 text-caption capitalize {workflow.state
						.remainingDoseLabel === label
						? 'border-primary-500 bg-primary-500/20 text-primary-200'
						: 'border-neutral-700 bg-neutral-800 text-neutral-300'}"
					onclick={() => workflow.setRemainingDoseLabel(label as any)}
				>
					{label === 'unknown' ? '?' : label}
				</button>
			{/each}
		</div>
	</section>

	<section class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
		<textarea
			class="input min-h-28"
			placeholder="Notes: what it is for, where it lives, opened today, keep cold..."
			value={workflow.state.note}
			oninput={(event) => workflow.setNote(event.currentTarget.value)}
		></textarea>
	</section>

	<div class="mb-4 flex items-center justify-between">
		<h3 class="font-semibold text-neutral-100">Photos ({workflow.state.photos.length})</h3>
		<span class="text-caption text-neutral-500">Box + expiry + doses works best</span>
	</div>

	<div class="grid grid-cols-2 gap-3">
		{#each workflow.state.photos as photo, index (photo.id)}
			<div class="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900">
				<div class="relative aspect-square bg-neutral-800">
					<img
						src={photo.previewUrl}
						alt="Medicine capture {index + 1}"
						class="h-full w-full object-cover"
					/>
					<span
						class="absolute left-2 top-2 rounded bg-neutral-950/80 px-2 py-1 text-caption text-neutral-200"
					>
						{kindLabels[photo.kind]}
					</span>
				</div>
				<div class="space-y-2 p-3">
					<select
						class="input-sm"
						value={photo.kind}
						onchange={(event) =>
							workflow.updatePhoto(photo.id, {
								kind: event.currentTarget.value as MedicinePhotoKind,
							})}
					>
						{#each Object.entries(kindLabels) as [value, label] (value)}
							<option {value}>{label}</option>
						{/each}
					</select>
					<input
						class="input-sm"
						placeholder="Quick note"
						value={photo.note}
						oninput={(event) => workflow.updatePhoto(photo.id, { note: event.currentTarget.value })}
					/>
					<div class="flex items-center justify-between gap-2">
						<label class="flex items-center gap-2 text-body-sm text-neutral-300">
							<input
								type="checkbox"
								checked={photo.ignored}
								onchange={(event) =>
									workflow.updatePhoto(photo.id, { ignored: event.currentTarget.checked })}
							/>
							Ignore
						</label>
						<button
							class="btn-icon"
							type="button"
							aria-label="Remove photo"
							onclick={() => workflow.removePhoto(photo.id)}
						>
							<Trash2 size={16} strokeWidth={1.5} />
						</button>
					</div>
				</div>
			</div>
		{/each}
	</div>

	{#if workflow.state.analysisProgress}
		<div class="mt-4">
			<AnalysisProgressBar
				current={workflow.state.analysisProgress.current}
				total={workflow.state.analysisProgress.total}
				message={workflow.state.analysisProgress.message}
			/>
		</div>
	{/if}
</div>

<div class="fixed-bottom-panel p-4">
	<Button variant="primary" full onclick={analyze}>
		<Sparkles size={18} strokeWidth={1.5} />
		<span>Analyze Medicine</span>
	</Button>
</div>
