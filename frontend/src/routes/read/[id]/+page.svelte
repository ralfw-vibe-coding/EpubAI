<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import ePub, { type Book, type Rendition } from 'epubjs';
	import { getProcessor, isAuthenticated } from '../../../portal/runtime';

	const bookId = $derived($page.params.id ?? '');

	let viewer: HTMLDivElement;
	let book: Book | null = null;
	let rendition: Rendition | null = null;

	let loading = $state(true);
	let error = $state<string | null>(null);
	let percent = $state(0);
	let currentCfi = '';

	onMount(async () => {
		if (!isAuthenticated()) {
			await goto('/login', { replaceState: true });
			return;
		}
		try {
			const { data, progress } = await getProcessor().openBookForReading(bookId);

			book = ePub(data);
			rendition = book.renderTo(viewer, {
				width: '100%',
				height: '100%',
				flow: 'paginated',
				spread: 'none',
				allowScriptedContent: true
			});

			// Clear the loading overlay as soon as the first content is rendered
			// (belt-and-suspenders alongside the display() await below).
			rendition.on('rendered', () => {
				loading = false;
			});

			// Resume at the stored position, or start at the beginning.
			await rendition.display(progress?.cfi || undefined);
			if (progress) percent = progress.percent;
			loading = false;

			// Build a location index in the background for a percentage read-out.
			book.ready
				.then(() => book!.locations.generate(1600))
				.then(() => {
					if (currentCfi) percent = pct(currentCfi);
				})
				.catch(() => undefined);

			rendition.on('relocated', (location: { start: { cfi: string } }) => {
				currentCfi = location.start.cfi;
				percent = pct(currentCfi);
				void save();
			});

			document.addEventListener('visibilitychange', onVisibility);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Buch konnte nicht geöffnet werden.';
			loading = false;
		}
	});

	function pct(cfi: string): number {
		try {
			const frac = book?.locations?.percentageFromCfi(cfi);
			return frac && frac > 0 ? Math.round(frac * 100) : percent;
		} catch {
			return percent;
		}
	}

	async function save() {
		if (!currentCfi) return;
		try {
			await getProcessor().saveReadingProgress(bookId, currentCfi, percent);
		} catch {
			// Local-first best effort; ignore transient failures.
		}
	}

	function onVisibility() {
		if (document.visibilityState === 'hidden') void save();
	}

	function next() {
		void rendition?.next();
	}
	function prev() {
		void rendition?.prev();
	}

	// Touch swipe navigation (buttons remain as a fallback).
	let touchX = 0;
	function onTouchStart(e: TouchEvent) {
		touchX = e.changedTouches[0].clientX;
	}
	function onTouchEnd(e: TouchEvent) {
		const dx = e.changedTouches[0].clientX - touchX;
		if (Math.abs(dx) < 40) return;
		if (dx < 0) next();
		else prev();
	}

	onDestroy(() => {
		document.removeEventListener('visibilitychange', onVisibility);
		void save();
		rendition?.destroy();
		book?.destroy();
	});
</script>

<div class="relative flex h-dvh flex-col bg-[var(--color-neutral-100)]">
	<header
		class="flex items-center justify-between border-b-2 border-[var(--color-divider)] bg-[var(--color-bg)] px-4 py-2"
	>
		<button onclick={() => goto(`/book/${bookId}`)} class="text-[var(--color-accent-700)]">
			← Schließen
		</button>
		<span class="text-xs text-[var(--color-neutral-700)]">{percent}%</span>
	</header>

	{#if error}
		<p class="m-4 bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">{error}</p>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative flex-1 overflow-hidden"
		ontouchstart={onTouchStart}
		ontouchend={onTouchEnd}
	>
		<div bind:this={viewer} class="h-full w-full"></div>

		{#if loading}
			<div class="absolute inset-0 grid place-items-center text-[var(--color-neutral-700)]">
				Lädt…
			</div>
		{/if}

		<!-- Tap/click fallbacks for page turning on non-touch devices. -->
		<button
			aria-label="Vorherige Seite"
			onclick={prev}
			class="absolute inset-y-0 left-0 w-1/5 opacity-0"
		></button>
		<button
			aria-label="Nächste Seite"
			onclick={next}
			class="absolute inset-y-0 right-0 w-1/5 opacity-0"
		></button>
	</div>

	<div
		class="flex-none border-t-2 border-[var(--color-divider)] bg-[var(--color-bg)] px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
	>
		<div class="mb-2 h-1 w-full bg-[var(--color-neutral-300)]">
			<div class="h-full bg-[var(--color-accent)]" style="width: {percent}%"></div>
		</div>
		<div class="flex items-center justify-between">
			<button onclick={prev} class="px-2 py-1 text-sm text-[var(--color-accent-700)]">← Zurück</button>
			<span class="text-xs text-[var(--color-neutral-700)]">{percent}%</span>
			<button onclick={next} class="px-2 py-1 text-sm text-[var(--color-accent-700)]">Weiter →</button>
		</div>
	</div>
</div>
