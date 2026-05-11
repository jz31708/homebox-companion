<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onDestroy, onMount, tick } from 'svelte';
	import { medicineIntakeWorkflow } from '$lib/workflows/medicineIntake.svelte';
	import { showToast } from '$lib/stores/ui.svelte';
	import Button from '$lib/components/Button.svelte';
	import StepIndicator from '$lib/components/StepIndicator.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import AnalysisProgressBar from '$lib/components/AnalysisProgressBar.svelte';
	import type { MedicinePhotoKind } from '$lib/types';
	import {
		Barcode,
		Camera,
		AlertTriangle,
		CheckCircle2,
		Eye,
		ImagePlus,
		Loader2,
		Pencil,
		RotateCcw,
		Sparkles,
		Trash2,
		VideoOff,
		XCircle,
	} from 'lucide-svelte';

	const workflow = medicineIntakeWorkflow;
	let videoElement = $state<HTMLVideoElement>();
	let fileInput: HTMLInputElement;
	let cameraError = $state<string | null>(null);
	let cameraStarting = $state(false);
	let scannerMode = $state(false);
	let scannerStatus = $state('');
	let barcodeReader: any = null;
	let barcodeControls: { stop: () => void } | null = null;
	let editingCode = $state(false);
	let lookupInFlight = $state(false);
	let lastScannedCodes = new Map<string, number>();

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
		const releaseCamera = () => {
			stopBarcodeScan();
		};
		window.addEventListener('pagehide', releaseCamera);
		window.addEventListener('beforeunload', releaseCamera);
		return () => {
			window.removeEventListener('pagehide', releaseCamera);
			window.removeEventListener('beforeunload', releaseCamera);
			releaseCamera();
		};
	});

	onDestroy(() => {
		stopBarcodeScan();
	});

	function capturePhoto() {
		fileInput?.click();
	}

	function addFiles(files: FileList | null) {
		if (!files?.length) return;
		workflow.addPhotos(Array.from(files), 'other');
		if (fileInput) fileInput.value = '';
	}

	async function startBarcodeScan() {
		if (!window.isSecureContext) {
			showToast('Camera needs HTTPS. Use companion.lan on your phone.', 'warning');
			return;
		}
		cameraError = null;
		cameraStarting = true;
		stopBarcodeScan();
		scannerMode = true;
		scannerStatus = 'Point the box barcode at the frame.';
		try {
			await tick();
			if (!videoElement) {
				throw new Error('Scanner video did not mount. Try again or use Photos.');
			}
			const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
				import('@zxing/browser'),
				import('@zxing/library'),
			]);
			const hints = new Map();
			hints.set(DecodeHintType.TRY_HARDER, true);
			hints.set(DecodeHintType.POSSIBLE_FORMATS, [
				BarcodeFormat.DATA_MATRIX,
				BarcodeFormat.EAN_13,
				BarcodeFormat.EAN_8,
				BarcodeFormat.CODE_128,
				BarcodeFormat.CODE_39,
				BarcodeFormat.ITF,
				BarcodeFormat.QR_CODE,
				BarcodeFormat.UPC_A,
				BarcodeFormat.UPC_E,
			]);
			barcodeReader = new BrowserMultiFormatReader(hints, {
				delayBetweenScanAttempts: 120,
				delayBetweenScanSuccess: 1200,
			});
			const constraints = {
				video: {
					facingMode: { ideal: 'environment' },
					width: { ideal: 1920 },
					height: { ideal: 1080 },
					advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
				},
				audio: false,
			} as MediaStreamConstraints;
			barcodeControls = await barcodeReader.decodeFromConstraints(
				constraints,
				videoElement,
				(result: any, error: unknown) => {
					if (result) {
						const code = result.getText();
						void handleScannedCode(code);
					} else if (error && `${error}`.includes('NotAllowed')) {
						scannerStatus = 'Camera permission blocked.';
					}
				}
			);
		} catch (error) {
			cameraError =
				error instanceof Error && error.message
					? error.message
					: 'Scanner could not start. Try photos or type the code.';
			scannerMode = false;
			scannerStatus = cameraError;
			showToast(scannerStatus, 'warning');
			console.warn(error);
		} finally {
			cameraStarting = false;
		}
	}

	async function handleScannedCode(code: string) {
		const normalized = code.trim();
		const now = Date.now();
		if (!normalized || now - (lastScannedCodes.get(normalized) ?? 0) < 2500) return;
		lastScannedCodes.set(normalized, now);
		workflow.setBarcodeText(normalized);
		const queued = workflow.enqueueBarcode(normalized);
		scannerStatus =
			queued.status === 'ready'
				? `Already ready: ${normalized}`
				: queued.status === 'analyzing'
					? `Already looking up: ${normalized}`
					: `Looking up ${normalized}`;
		editingCode = false;
		showToast('Medicine added to inbox', 'success');
	}

	function stopBarcodeScan() {
		barcodeControls?.stop();
		barcodeControls = null;
		barcodeReader = null;
		scannerMode = false;
	}

	async function analyze() {
		const result = await workflow.analyze();
		if (result) goto(resolve('/medicine-review'));
		else if (workflow.state.error) showToast(workflow.state.error, 'error');
	}

	async function lookupTypedCode() {
		const code = workflow.state.barcodeText.trim();
		if (!code) return;
		lookupInFlight = true;
		const queued = workflow.enqueueBarcode(code);
		lookupInFlight = false;
		editingCode = false;
		scannerStatus = `Looking up ${queued.code}`;
		showToast('Medicine added to inbox', 'success');
	}

	function reviewQueuedScan(id: string) {
		if (workflow.openQueuedScan(id)) goto(resolve('/medicine-review'));
	}

	function reviewNextReady() {
		if (workflow.openNextReadyScan()) goto(resolve('/medicine-review'));
	}

	function queueLabel(status: string) {
		if (status === 'captured') return 'Captured';
		if (status === 'analyzing') return 'Looking it up';
		if (status === 'needs_review') return 'Needs review';
		if (status === 'blocked') return 'Blocked';
		if (status === 'ready') return 'Ready to review';
		if (status === 'submitted') return 'Saved';
		if (status === 'recovered') return 'Recovered';
		return 'Failed';
	}

	function reviewable(status: string) {
		return ['ready', 'needs_review', 'blocked', 'failed', 'recovered'].includes(status);
	}
</script>

<svelte:head>
	<title>Medicine Intake - Homebox Companion</title>
</svelte:head>

<div class="animate-in pb-36">
	<StepIndicator currentStep={2} />
	<BackLink href="/mode" label="Back to mode choice" />

	<h2 class="mb-1 text-h2 text-neutral-100">Medicine Mission</h2>
	<p class="mb-4 text-body-sm text-neutral-400">
		{workflow.state.locationPath} - scan each box, keep the evidence, then review only the candidates that need a decision.
	</p>

	<section class="mb-4 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950">
		<div class="relative aspect-[4/3] bg-neutral-900">
			{#if cameraError}
				<div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
					<VideoOff size={36} strokeWidth={1.5} class="text-neutral-500" />
					<p class="text-body-sm text-neutral-300">{cameraError}</p>
					<div class="grid w-full max-w-xs grid-cols-2 gap-2">
						<Button variant="secondary" onclick={startBarcodeScan}>
							<Barcode size={18} strokeWidth={1.5} />
							<span>Retry</span>
						</Button>
						<Button variant="secondary" onclick={() => fileInput.click()}>
							<ImagePlus size={18} strokeWidth={1.5} />
							<span>Photos</span>
						</Button>
					</div>
				</div>
			{:else if !scannerMode}
				<div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
					<Barcode size={36} strokeWidth={1.5} class="text-neutral-500" />
					<p class="text-body-sm text-neutral-300">Start barcode scan when you're ready.</p>
					<div class="grid w-full max-w-xs grid-cols-2 gap-2">
						<Button variant="primary" onclick={startBarcodeScan}>
							<Barcode size={18} strokeWidth={1.5} />
							<span>Scan</span>
						</Button>
						<Button variant="secondary" onclick={() => fileInput.click()}>
							<ImagePlus size={18} strokeWidth={1.5} />
							<span>Photos</span>
						</Button>
					</div>
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
				<Button variant="primary" onclick={capturePhoto}>
					<Camera size={18} strokeWidth={1.5} />
					<span>Add Photo</span>
				</Button>
				{#if scannerMode}
					<Button
						variant="secondary"
						onclick={() => {
							scannerMode = false;
							stopBarcodeScan();
						}}
					>
						<Barcode size={18} strokeWidth={1.5} />
						<span>Stop Scan</span>
					</Button>
				{:else}
					<Button variant="secondary" onclick={startBarcodeScan} disabled={lookupInFlight}>
						<Barcode size={18} strokeWidth={1.5} />
						<span>{lookupInFlight ? 'Adding' : 'Scan Labels'}</span>
					</Button>
				{/if}
			</div>
			<Button
				variant="secondary"
				full
				onclick={() => {
					editingCode = true;
					scannerStatus = '';
				}}
			>
					<Pencil size={18} strokeWidth={1.5} />
				<span>Type Code</span>
			</Button>
			{#if scannerMode || scannerStatus}
				<div class="flex items-center justify-between gap-3 rounded-lg bg-neutral-900 px-3 py-2">
					<p class="text-body-sm text-neutral-300">{scannerStatus}</p>
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

	{#if workflow.state.barcodeText || editingCode}
		<section class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
			<div class="mb-3 flex items-center justify-between gap-3">
				<div class="flex items-center gap-2 text-neutral-100">
					<Barcode size={18} strokeWidth={1.5} />
					<h3 class="font-semibold">Manual Code</h3>
				</div>
				<button
					type="button"
					class="inline-flex items-center gap-1 text-body-sm text-primary-300"
					onclick={() => (editingCode = !editingCode)}
				>
					<Pencil size={14} strokeWidth={1.5} />
					<span>{editingCode ? 'Done' : 'Edit'}</span>
				</button>
			</div>
			{#if editingCode}
				<input
					class="input"
					placeholder="Correct barcode or CIP13"
					value={workflow.state.barcodeText}
					oninput={(event) => workflow.setBarcodeText(event.currentTarget.value)}
				/>
			{:else}
				<p class="font-mono text-body text-neutral-200">{workflow.state.barcodeText}</p>
			{/if}
			<Button variant="secondary" full onclick={lookupTypedCode} disabled={lookupInFlight}>
				<Barcode size={18} strokeWidth={1.5} />
				<span>{lookupInFlight ? 'Adding' : 'Add to Inbox'}</span>
			</Button>
		</section>
	{/if}

	<section class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
		<div class="mb-3 flex items-center justify-between gap-3">
			<div>
				<h3 class="font-semibold text-neutral-100">Meds Found</h3>
				<p class="text-caption text-neutral-500">
					{workflow.state.queuedScans.length} captured, {workflow.state.queuedScans.filter(
						(scan) => reviewable(scan.status)
					).length} reviewable
				</p>
			</div>
			<Button
				variant="secondary"
				size="sm"
				onclick={reviewNextReady}
				disabled={!workflow.state.queuedScans.some((scan) => scan.status === 'ready')}
			>
				<Eye size={16} strokeWidth={1.5} />
				<span>Review</span>
			</Button>
		</div>

		{#if workflow.state.queuedScans.length === 0}
			<p class="rounded-lg bg-neutral-950 px-3 py-4 text-center text-body-sm text-neutral-500">
				Scan box barcodes or add label photos. Candidates stay here until saved or recovered.
			</p>
		{:else}
			<div class="grid gap-2">
				{#each workflow.state.queuedScans as scan (scan.id)}
					<div class="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
						<div class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="truncate text-body-sm font-semibold text-neutral-200">
									{scan.candidate?.name ?? scan.code}
								</p>
								<p class="truncate text-caption text-neutral-500">
									{scan.blockerReasons[0] ??
										scan.candidate?.generalUse ??
										scan.error ??
										queueLabel(scan.status)}
								</p>
								<p class="mt-1 text-caption text-neutral-600">
									{queueLabel(scan.status)}
									{#if scan.confidence !== null}
										- {Math.round(scan.confidence * 100)}% confidence
									{/if}
								</p>
							</div>
							<div class="flex items-center gap-2">
								{#if scan.status === 'analyzing' || scan.status === 'captured' || scan.status === 'recovered'}
									<Loader2 class="animate-spin text-primary-300" size={18} strokeWidth={1.5} />
								{:else if scan.status === 'ready' || scan.status === 'submitted'}
									<CheckCircle2 class="text-success-300" size={18} strokeWidth={1.5} />
								{:else if scan.status === 'needs_review' || scan.status === 'blocked'}
									<AlertTriangle class="text-warning-300" size={18} strokeWidth={1.5} />
								{:else if scan.status === 'failed'}
									<XCircle class="text-error-300" size={18} strokeWidth={1.5} />
								{:else}
									<CheckCircle2 class="text-neutral-500" size={18} strokeWidth={1.5} />
								{/if}
								{#if reviewable(scan.status)}
									<button
										type="button"
										class="btn-icon"
										aria-label="Review medicine candidate"
										onclick={() => reviewQueuedScan(scan.id)}
									>
										<Eye size={16} strokeWidth={1.5} />
									</button>
								{/if}
								{#if scan.status === 'failed'}
									<button
										type="button"
										class="btn-icon"
										aria-label="Recover failed candidate"
										onclick={() => workflow.retryQueuedScan(scan.id)}
									>
										<RotateCcw size={16} strokeWidth={1.5} />
									</button>
								{/if}
								<button
									type="button"
									class="btn-icon"
									aria-label="Remove queued scan"
									onclick={() => workflow.removeQueuedScan(scan.id)}
								>
									<Trash2 size={16} strokeWidth={1.5} />
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section class="mb-4 grid gap-3 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
		<div class="grid grid-cols-2 gap-3">
			<label class="grid gap-1 text-body-sm text-neutral-300">
				<span>Expiry, if visible</span>
				<input
					class="input-sm"
					type="month"
					value={workflow.state.expiryDate}
					oninput={(event) => workflow.setExpiryDate(event.currentTarget.value)}
				/>
			</label>
			<label class="grid gap-1 text-body-sm text-neutral-300">
				<span>Opened, if known</span>
				<input
					class="input-sm"
					type="date"
					value={workflow.state.openedDate}
					oninput={(event) => workflow.setOpenedDate(event.currentTarget.value)}
				/>
			</label>
		</div>
		<textarea
			class="input min-h-24"
			placeholder="Optional note: keep cold, almost empty, leaflet photo added..."
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
	{#if workflow.state.queuedScans.some((scan) => reviewable(scan.status))}
		<Button variant="primary" full onclick={reviewNextReady}>
			<Eye size={18} strokeWidth={1.5} />
			<span>Open Mission Review</span>
		</Button>
	{:else}
		<Button variant="primary" full onclick={analyze} disabled={workflow.state.photos.length === 0}>
			<Sparkles size={18} strokeWidth={1.5} />
			<span>{workflow.state.photos.length === 0 ? 'Scan or Add Photos' : 'Analyze Photos'}</span>
		</Button>
	{/if}
</div>
