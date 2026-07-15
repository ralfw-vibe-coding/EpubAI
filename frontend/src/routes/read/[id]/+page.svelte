<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import ePub, { type Book, type NavItem, type Rendition } from 'epubjs';
	import { List, Settings, X, Minus, Plus } from 'lucide-svelte';
	import { getProcessor, isAuthenticated } from '../../../portal/runtime';
	import {
		DEFAULT_PREFS,
		FONT_SIZES,
		MARGIN_OPTIONS,
		THEME_COLORS,
		THEME_OPTIONS,
		clampFontIndex,
		fontSizePx,
		parsePrefs,
		readerThemeStyles,
		STORAGE_KEY,
		type ReaderMargin,
		type ReaderPrefs,
		type ReaderTheme
	} from './preferences';

	const bookId = $derived($page.params.id ?? '');

	let viewer: HTMLDivElement;
	let book: Book | null = null;
	let rendition: Rendition | null = null;

	let loading = $state(true);
	let error = $state<string | null>(null);
	let percent = $state(0);
	// Both stay null until book.locations.generate() has completed; the template
	// shows nothing for the page read-out until then (see below).
	let currentPage = $state<number | null>(null);
	let totalPages = $state<number | null>(null);
	let currentCfi = '';
	let bookTitle = $state('');

	let toc = $state<NavItem[]>([]);
	let tocOpen = $state(false);
	let settingsOpen = $state(false);
	let prefs = $state<ReaderPrefs>({ ...DEFAULT_PREFS });

	onMount(async () => {
		if (!isAuthenticated()) {
			await goto('/login', { replaceState: true });
			return;
		}
		prefs = parsePrefs(localStorage.getItem(STORAGE_KEY));
		try {
			const { data, progress, title } = await getProcessor().openBookForReading(bookId);

			book = ePub(data);
			// Prefer the catalog title cached on the loan (kept in sync with edits,
			// no network call needed - offline-first). Only fall back to the EPUB's
			// own embedded metadata for old loans that predate this cache.
			if (title) {
				bookTitle = title;
			} else {
				book.loaded.metadata
					.then((meta) => {
						bookTitle = meta?.title ?? '';
					})
					.catch(() => undefined);
			}
			rendition = book.renderTo(viewer, {
				width: '100%',
				height: '100%',
				flow: 'paginated',
				spread: 'none',
				allowScriptedContent: true
			});

			// Apply the stored device preferences before the first paint so a
			// returning reader sees their last settings right away.
			applyPrefs();

			// Clear the loading overlay as soon as the first content is rendered
			// (belt-and-suspenders alongside the display() await below).
			rendition.on('rendered', () => {
				loading = false;
			});

			// Chapter list for the table-of-contents drawer.
			book.loaded.navigation
				.then((nav) => {
					toc = nav.toc;
				})
				.catch(() => undefined);

			// Resume at the stored position, or start at the beginning.
			await rendition.display(progress?.cfi || undefined);
			if (progress) {
				percent = progress.percent;
				// Show the page numbers from the last session immediately; they'll be
				// recomputed (and may shift slightly) once locations regenerate below.
				currentPage = progress.page;
				totalPages = progress.totalPages;
			}
			loading = false;

			// Build a location index in the background for a percentage + page read-out.
			book.ready
				.then(() => book!.locations.generate(1600))
				.then(() => {
					totalPages = book!.locations.length();
					if (currentCfi) {
						percent = pct(currentCfi);
						currentPage = pageOf(currentCfi);
					}
				})
				.catch(() => undefined);

			rendition.on('relocated', (location: { start: { cfi: string } }) => {
				currentCfi = location.start.cfi;
				percent = pct(currentCfi);
				currentPage = pageOf(currentCfi);
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

	/** 1-based page index from epub.js locations, or null until they're generated. */
	function pageOf(cfi: string): number | null {
		if (totalPages === null) return null;
		try {
			const index = book?.locations?.locationFromCfi(cfi);
			return typeof index === 'number' && index >= 0 ? index + 1 : currentPage;
		} catch {
			return currentPage;
		}
	}

	async function save() {
		if (!currentCfi) return;
		try {
			await getProcessor().saveReadingProgress(bookId, currentCfi, percent, currentPage, totalPages);
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

	function applyPrefs() {
		if (!rendition) return;
		rendition.themes.fontSize(fontSizePx(prefs.fontIndex));
		rendition.themes.default(readerThemeStyles(prefs.theme, prefs.margin));
	}

	function persistPrefs() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
		} catch {
			// Best effort; a full/blocked storage shouldn't break reading.
		}
	}

	function changeFont(step: number) {
		prefs = { ...prefs, fontIndex: clampFontIndex(prefs.fontIndex + step) };
		applyPrefs();
		persistPrefs();
	}

	function setMargin(margin: ReaderMargin) {
		prefs = { ...prefs, margin };
		applyPrefs();
		persistPrefs();
	}

	function setTheme(theme: ReaderTheme) {
		prefs = { ...prefs, theme };
		applyPrefs();
		persistPrefs();
	}

	function openChapter(href: string) {
		void rendition?.display(href);
		tocOpen = false;
	}

	onDestroy(() => {
		document.removeEventListener('visibilitychange', onVisibility);
		void save();
		rendition?.destroy();
		book?.destroy();
	});
</script>

<div class="min-h-dvh w-full bg-[var(--color-neutral-200)] flex justify-center">
<div class="relative flex h-dvh w-full max-w-[520px] flex-col bg-[var(--color-neutral-100)]">
	<header
		class="flex items-center justify-between border-b-2 border-[var(--color-divider)] bg-[var(--color-bg)] px-4 py-2"
	>
		<button onclick={() => goto(`/book/${bookId}`)} class="flex-none text-sm text-[var(--color-accent-700)]">
			← Schließen
		</button>
		<span class="min-w-0 flex-1 truncate px-3 text-sm font-medium text-[var(--color-text)]">{bookTitle}</span>
		<div class="flex flex-none items-center gap-1">
			<button
				onclick={() => (tocOpen = true)}
				aria-label="Inhaltsverzeichnis"
				class="p-1.5 text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)]"
			>
				<List size={20} />
			</button>
			<button
				onclick={() => (settingsOpen = true)}
				aria-label="Einstellungen"
				class="p-1.5 text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)]"
			>
				<Settings size={20} />
			</button>
		</div>
	</header>

	{#if error}
		<p class="m-4 bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">{error}</p>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative flex-1 overflow-hidden"
		style="background: {THEME_COLORS[prefs.theme].bg}"
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
			<span class="text-xs text-[var(--color-neutral-700)]">
				{percent}%{#if currentPage !== null && totalPages !== null} · Seite {currentPage} von {totalPages}{/if}
			</span>
			<button onclick={next} class="px-2 py-1 text-sm text-[var(--color-accent-700)]">Weiter →</button>
		</div>
	</div>

	{#if tocOpen}
		<button
			aria-label="Inhaltsverzeichnis schließen"
			onclick={() => (tocOpen = false)}
			class="absolute inset-0 z-20 bg-black/40"
		></button>
		<aside
			class="absolute inset-y-0 left-0 z-30 flex w-4/5 max-w-[320px] flex-col border-r-2 border-[var(--color-divider)] bg-[var(--color-bg)]"
		>
			<div class="flex items-center justify-between border-b-2 border-[var(--color-divider)] px-4 py-3">
				<span class="font-[var(--font-heading)] text-sm font-extrabold tracking-tight">Inhaltsverzeichnis</span>
				<button onclick={() => (tocOpen = false)} aria-label="Schließen" class="text-[var(--color-accent-700)]">
					<X size={20} />
				</button>
			</div>
			<nav class="flex-1 overflow-y-auto py-1">
				{#if toc.length === 0}
					<p class="px-4 py-3 text-sm text-[var(--color-neutral-700)]">Kein Inhaltsverzeichnis vorhanden.</p>
				{:else}
					{#each toc as item (item.href)}
						<button
							onclick={() => openChapter(item.href)}
							class="block w-full truncate px-4 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)]"
						>
							{item.label.trim()}
						</button>
						{#each item.subitems ?? [] as sub (sub.href)}
							<button
								onclick={() => openChapter(sub.href)}
								class="block w-full truncate py-2 pr-4 pl-8 text-left text-sm text-[var(--color-neutral-700)] hover:bg-[var(--color-surface)]"
							>
								{sub.label.trim()}
							</button>
						{/each}
					{/each}
				{/if}
			</nav>
		</aside>
	{/if}

	{#if settingsOpen}
		<button
			aria-label="Einstellungen schließen"
			onclick={() => (settingsOpen = false)}
			class="absolute inset-0 z-20 bg-black/40"
		></button>
		<section
			class="absolute inset-x-0 bottom-0 z-30 border-t-2 border-[var(--color-divider)] bg-[var(--color-bg)] px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
		>
			<div class="mb-3 flex items-center justify-between">
				<span class="font-[var(--font-heading)] text-sm font-extrabold tracking-tight">Einstellungen</span>
				<button onclick={() => (settingsOpen = false)} aria-label="Schließen" class="text-[var(--color-accent-700)]">
					<X size={20} />
				</button>
			</div>

			<div class="flex items-center justify-between py-2">
				<span class="text-sm text-[var(--color-neutral-700)]">Schriftgröße</span>
				<div class="flex items-center gap-3">
					<button
						onclick={() => changeFont(-1)}
						disabled={prefs.fontIndex === 0}
						aria-label="Kleiner"
						class="flex h-9 w-9 items-center justify-center border border-[var(--color-divider)] text-[var(--color-text)] disabled:opacity-40"
					>
						<Minus size={16} />
					</button>
					<span class="w-10 text-center text-sm tabular-nums text-[var(--color-text)]">{FONT_SIZES[prefs.fontIndex]}</span>
					<button
						onclick={() => changeFont(1)}
						disabled={prefs.fontIndex === FONT_SIZES.length - 1}
						aria-label="Größer"
						class="flex h-9 w-9 items-center justify-center border border-[var(--color-divider)] text-[var(--color-text)] disabled:opacity-40"
					>
						<Plus size={16} />
					</button>
				</div>
			</div>

			<div class="py-2">
				<span class="text-sm text-[var(--color-neutral-700)]">Ränder</span>
				<div class="mt-2 flex gap-2">
					{#each MARGIN_OPTIONS as option (option.value)}
						<button
							onclick={() => setMargin(option.value)}
							class="flex-1 border px-3 py-2 text-sm {prefs.margin === option.value
								? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-bg)]'
								: 'border-[var(--color-divider)] text-[var(--color-text)]'}"
						>
							{option.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="py-2">
				<span class="text-sm text-[var(--color-neutral-700)]">Modus</span>
				<div class="mt-2 flex gap-2">
					{#each THEME_OPTIONS as option (option.value)}
						<button
							onclick={() => setTheme(option.value)}
							class="flex-1 border px-3 py-2 text-sm {prefs.theme === option.value
								? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-bg)]'
								: 'border-[var(--color-divider)] text-[var(--color-text)]'}"
						>
							{option.label}
						</button>
					{/each}
				</div>
			</div>
		</section>
	{/if}
</div>
</div>
