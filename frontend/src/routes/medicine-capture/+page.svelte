<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import { medicineIntakeWorkflow } from '$lib/workflows/medicineIntake.svelte';
	import { showToast } from '$lib/stores/ui.svelte';
	import Button from '$lib/components/Button.svelte';
	import StepIndicator from '$lib/components/StepIndicator.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import AnalysisProgressBar from '$lib/components/AnalysisProgressBar.svelte';
	import type { MedicinePhotoKind } from '$lib/types';
	import { Barcode, Camera, Hash, ImagePlus, Sparkles, Trash2, VideoOff } from 'lucide-svelte';

	const workflow = medicineIntakeWorkflow;
	let videoElement = $state<HTMLVideoElement>();
	let fileInput: HTMLInputElement;
	let stream: MediaStream | null = null;
	let cameraError = $state<string | null>(null);
	let cameraStarting = $state(false);
	let scannerMode = $state(false);
	let scannerStatus = $state('');
	let barcodeDetector: any = null;
	let scanTimer: number | null = null;

	const kindLabels: Record<MedicinePhotoKind, string> = {
		front: 'Label',
		barcode: 'Barcode',
		expiry: 'Expiry',
		doses: 'Doses',
		notice: 'Notice',
		other: 'Other',
	};

	onMount(() => {
		if (!workflow.state.locationId) goto(resolve('/location'));
		startCamera();
	});

	onDestroy(() => {
		stopBarcodeLoop();
		stopCamera();
	});

	async function startCamera() {
		cameraError = null;
		cameraStarting = true;
		try {
			if (!window.isSecureContext) {
				throw new Error('Camera needs HTTPS. Use companion.lan on your phone.');
			}
			stream = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: { ideal: 'environment' },
					width: { ideal: 1280 },
					height: { ideal: 720 },
				},
				audio: false,
			});
			if (videoElement) {
				videoElement.srcObject = stream;
				await videoElement.play();
			}
		} catch (error) {
			cameraError = error instanceof Error ? error.message : 'Camera unavailable.';
			showToast(cameraError, 'warning');
		} finally {
			cameraStarting = false;
		}
	}

	function stopCamera() {
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
	}

	function currentFrameBlob(): Promise<Blob> {
		return new Promise((resolve, reject) => {
			if (!videoElement?.videoWidth || !videoElement?.videoHeight) {
				reject(new Error('Camera is not ready yet.'));
				return;
			}
			const canvas = document.createElement('canvas');
			canvas.width = videoElement.videoWidth;
			canvas.height = videoElement.videoHeight;
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				reject(new Error('Canvas unavailable.'));
				return;
			}
			ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error('Could not capture photo.'))),
				'image/jpeg',
				0.92
			);
		});
	}

	async function capturePhoto(kind: MedicinePhotoKind = 'other') {
		try {
			const blob = await currentFrameBlob();
			const file = new File([blob], `medicine-${Date.now()}.jpg`, { type: 'image/jpeg' });
			workflow.addPhotos([file], kind);
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Could not capture photo', 'error');
		}
	}

	function addFiles(files: FileList | null) {
		if (!files?.length) return;
		workflow.addPhotos(Array.from(files), 'other');
		if (fileInput) fileInput.value = '';
	}

	function setRemainingDoses(value: string) {
		const trimmed = value.trim();
		workflow.setRemainingDoses(trimmed === '' ? null : Math.max(0, Number(trimmed) || 0));
	}

	async function startBarcodeScan() {
		scannerMode = true;
		scannerStatus = 'Point the box barcode at the frame.';
		if (!('BarcodeDetector' in window)) {
			scannerStatus = 'Barcode scanner not supported here. Take a barcode photo instead.';
			await capturePhoto('barcode');
			return;
		}
		try {
			const Detector = (window as any).BarcodeDetector;
			barcodeDetector = new Detector({
				formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'data_matrix', 'qr_code'],
			});
			runBarcodeLoop();
		} catch (error) {
			scannerStatus = 'Barcode scanner could not start. Take a barcode photo instead.';
			console.warn(error);
		}
	}

	function stopBarcodeLoop() {
		if (scanTimer !== null) window.clearTimeout(scanTimer);
		scanTimer = null;
	}

	async function runBarcodeLoop() {
		if (!scannerMode || !barcodeDetector || !videoElement) return;
		try {
			const results = await barcodeDetector.detect(videoElement);
			const code = results?.[0]?.rawValue;
			if (code) {
				workflow.setBarcodeText(code);
				await capturePhoto('barcode');
				scannerStatus = `Scanned ${code}`;
				scannerMode = false;
				stopBarcodeLoop();
				showToast('Barcode scanned', 'success');
				return;
			}
		} catch (error) {
			console.warn(error);
			scannerStatus = 'Scanning failed. Try a barcode photo.';
			scannerMode = false;
			stopBarcodeLoop();
			return;
		}
		scanTimer = window.setTimeout(runBarcodeLoop, 350);
	}

	async function barcodePhotoFallback() {
		await capturePhoto('barcode');
		scannerMode = false;
		scannerStatus = 'Barcode photo saved for AI/OCR.';
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

	<section class="mb-4 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950">
		<div class="relative aspect-[4/3] bg-neutral-900">
			{#if cameraError}
				<div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
					<VideoOff size={36} strokeWidth={1.5} class="text-neutral-500" />
					<p class="text-body-sm text-neutral-300">{cameraError}</p>
					<Button variant="secondary" onclick={() => fileInput.click()}>
						<ImagePlus size={18} strokeWidth={1.5} />
						<span>Add Photos</span>
					</Button>
				</div>
			{:else}
				<video
					bind:this={videoElement}
					class="h-full w-full object-cover"
					playsinline
					muted
					autoplay
				>
					<track kind="captions" />
				</video>
				<div class="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-primary-400/80 shadow-[0_0_0_999px_rgba(0,0,0,0.20)]"></div>
				{#if cameraStarting}
					<div class="absolute inset-0 flex items-center justify-center bg-neutral-950/50">
						<p class="text-body-sm text-neutral-200">Starting camera...</p>
					</div>
				{/if}
			{/if}
		</div>
		<div class="grid gap-3 p-3">
			<div class="grid grid-cols-2 gap-3">
				<Button variant="primary" onclick={() => capturePhoto('other')}>
					<Camera size={18} strokeWidth={1.5} />
					<span>Take Photo</span>
				</Button>
				{#if scannerMode}
					<Button
						variant="secondary"
						onclick={() => {
							scannerMode = false;
							stopBarcodeLoop();
						}}
					>
						<Barcode size={18} strokeWidth={1.5} />
						<span>Stop Scan</span>
					</Button>
				{:else}
					<Button variant="secondary" onclick={startBarcodeScan}>
						<Barcode size={18} strokeWidth={1.5} />
						<span>Scan Code</span>
					</Button>
				{/if}
			</div>
			{#if scannerMode || scannerStatus}
				<div class="flex items-center justify-between gap-3 rounded-lg bg-neutral-900 px-3 py-2">
					<p class="text-body-sm text-neutral-300">{scannerStatus}</p>
					{#if scannerMode}
						<button
							type="button"
							class="text-body-sm text-primary-300"
							onclick={barcodePhotoFallback}
						>
							Use Photo
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</section>

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
			<h3 class="font-semibold">Code</h3>
		</div>
		<input
			class="input"
			placeholder="Scanned barcode, CIP13, or text visible on the box"
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
			<span>Doses left</span>
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
			class="input min-h-24"
			placeholder="Notes: opened today, keep cold, almost empty..."
			value={workflow.state.note}
			oninput={(event) => workflow.setNote(event.currentTarget.value)}
		></textarea>
	</section>

	<div class="mb-4 flex items-center justify-between">
		<h3 class="font-semibold text-neutral-100">Photos ({workflow.state.photos.length})</h3>
		<button type="button" class="text-body-sm text-primary-300" onclick={() => fileInput.click()}>
			Add from gallery
		</button>
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
