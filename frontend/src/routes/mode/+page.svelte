<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { locationStore } from '$lib/stores/locations.svelte';
	import { showToast } from '$lib/stores/ui.svelte';
	import { scanWorkflow } from '$lib/workflows/scan.svelte';
	import { bulkSweepWorkflow } from '$lib/workflows/bulkSweep.svelte';
	import { medicineIntakeWorkflow } from '$lib/workflows/medicineIntake.svelte';
	import Button from '$lib/components/Button.svelte';
	import StepIndicator from '$lib/components/StepIndicator.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import { Camera, Layers3, Mic, CheckCircle2, Pill, CalendarDays } from 'lucide-svelte';

	onMount(() => {
		if (!locationStore.selected) goto(resolve('/location'));
	});

	function classicCapture() {
		if (!locationStore.selected) {
			showToast('Select a location first', 'warning');
			return;
		}
		goto(resolve('/capture'));
	}

	function bulkSweep() {
		if (!locationStore.selected) {
			showToast('Select a location first', 'warning');
			return;
		}
		bulkSweepWorkflow.start(
			locationStore.selected.id,
			locationStore.selected.name,
			locationStore.selectedPath
		);
		if (scanWorkflow.state.parentItemId && scanWorkflow.state.parentItemName) {
			bulkSweepWorkflow.setParentItem(
				scanWorkflow.state.parentItemId,
				scanWorkflow.state.parentItemName
			);
		}
		goto(resolve('/bulk-capture'));
	}

	function medicineIntake() {
		if (!locationStore.selected) {
			showToast('Select a location first', 'warning');
			return;
		}
		medicineIntakeWorkflow.start(
			locationStore.selected.id,
			locationStore.selected.name,
			locationStore.selectedPath
		);
		goto(resolve('/medicine-capture'));
	}
</script>

<svelte:head>
	<title>Choose Capture Mode - Homebox Companion</title>
</svelte:head>

<div class="animate-in">
	<StepIndicator currentStep={2} />
	<BackLink href="/location" label="Back to location" />

	<h2 class="mb-1 text-h2 text-neutral-100">Choose Capture Mode</h2>
	<p class="mb-6 text-body-sm text-neutral-400">
		Items will be added to {locationStore.selectedPath}
	</p>

	<div class="grid gap-4">
		<button
			type="button"
			class="rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-left transition-all hover:border-primary-500/70 hover:bg-neutral-800"
			onclick={classicCapture}
		>
			<div class="mb-3 flex items-center gap-3">
				<div class="rounded-lg bg-primary-500/15 p-3 text-primary-300">
					<Camera size={24} strokeWidth={1.5} />
				</div>
				<div>
					<h3 class="font-semibold text-neutral-100">Classic Capture</h3>
					<p class="text-body-sm text-neutral-400">
						One item or one small group, carefully reviewed.
					</p>
				</div>
			</div>
			<div class="flex items-center gap-2 text-body-sm text-neutral-500">
				<CheckCircle2 size={16} strokeWidth={1.5} />
				<span>Best for serial numbers, close-ups, and precise edits.</span>
			</div>
		</button>

		<button
			type="button"
			class="rounded-xl border border-primary-500 bg-neutral-900 p-4 text-left shadow-md ring-2 ring-primary-500/20 transition-all hover:bg-neutral-800"
			onclick={bulkSweep}
		>
			<div class="mb-3 flex items-center gap-3">
				<div class="rounded-lg bg-primary-500/20 p-3 text-primary-300">
					<Layers3 size={24} strokeWidth={1.5} />
				</div>
				<div>
					<h3 class="font-semibold text-neutral-100">Bulk Sweep</h3>
					<p class="text-body-sm text-neutral-400">
						Many photos, live narration, editable transcript.
					</p>
				</div>
			</div>
			<div class="flex items-center gap-2 text-body-sm text-neutral-300">
				<Mic size={16} strokeWidth={1.5} />
				<span>Walk a shelf or room, then approve evidence-backed candidates.</span>
			</div>
		</button>

		<button
			type="button"
			class="rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-left transition-all hover:border-primary-500/70 hover:bg-neutral-800"
			onclick={medicineIntake}
		>
			<div class="mb-3 flex items-center gap-3">
				<div class="text-success-300 rounded-lg bg-success-500/15 p-3">
					<Pill size={24} strokeWidth={1.5} />
				</div>
				<div>
					<h3 class="font-semibold text-neutral-100">Medicine Intake</h3>
					<p class="text-body-sm text-neutral-400">
						One medicine, several fast photos, expiry and doses.
					</p>
				</div>
			</div>
			<div class="flex items-center gap-2 text-body-sm text-neutral-500">
				<CalendarDays size={16} strokeWidth={1.5} />
				<span>Barcode is optional; review AI-filled details before saving.</span>
			</div>
		</button>
	</div>

	<div class="mt-6">
		<Button variant="secondary" full onclick={() => goto(resolve('/location'))}
			>Change Location</Button
		>
	</div>
</div>
