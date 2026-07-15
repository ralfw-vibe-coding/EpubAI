<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import ePub, { type Book, type NavItem, type Rendition } from 'epubjs';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import {
		List,
		Settings,
		X,
		Minus,
		Plus,
		Highlighter,
		Trash2,
		Check,
		Languages,
		BookOpenText
	} from 'lucide-svelte';
	import type { Annotation, AnnotationColor } from '../../../domain/types';
	import { getProcessor, getSession, isAuthenticated } from '../../../portal/runtime';
	import { colorHex, HIGHLIGHT_COLORS, highlightStyles } from './colors';
	import { AVAILABLE_LANGUAGES } from './languages';
	import {
		DEFAULT_PREFS,
		FONT_SIZES,
		MARGIN_OPTIONS,
		MARGIN_PADDING,
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

	// Notizen & Markierungen: loaded from the local cache on open, kept in sync
	// with epub.js highlights. `selection` drives the floating color-swatch bar
	// shown after a text selection; `editing` drives the note-editor bottom sheet.
	let annotations = $state<Annotation[]>([]);
	let notesOpen = $state(false);
	let selection = $state<{ cfiRange: string; excerpt: string } | null>(null);
	let editing = $state<Annotation | null>(null);
	let noteDraft = $state('');
	let annotationError = $state<string | null>(null);
	let annotationErrorTimer: ReturnType<typeof setTimeout> | null = null;

	function showAnnotationError(message: string) {
		annotationError = message;
		if (annotationErrorTimer) clearTimeout(annotationErrorTimer);
		annotationErrorTimer = setTimeout(() => (annotationError = null), 4000);
	}

	// AI assist (§4.6): "Übersetzen"/"Nachschlagen" on the selection bar, and the
	// translation target language picked in Settings. `aiResult` drives the
	// bottom sheet showing the (loading/error/finished) result of either call.
	let translationLanguage = $state('de');
	let aiResult = $state<{
		kind: 'translate' | 'lookup';
		loading: boolean;
		text: string | null;
		error: string | null;
	} | null>(null);
	// Claude's translate/lookup responses are often Markdown (headers, bold,
	// lists - see §4.6 prompts in backend/src/providers/x/claude.ts) - render
	// it properly rather than showing the raw syntax. Sanitized because the
	// source text driving the prompt is the book's own content, not something
	// we authored ourselves.
	let aiResultHtml = $derived(
		aiResult?.text ? DOMPurify.sanitize(marked.parse(aiResult.text, { async: false })) : ''
	);

	async function translateExcerpt() {
		if (!selection) return;
		const excerpt = selection.excerpt;
		aiResult = { kind: 'translate', loading: true, text: null, error: null };
		try {
			const text = await getProcessor().translateSelection(excerpt, translationLanguage);
			aiResult = { kind: 'translate', loading: false, text, error: null };
		} catch {
			aiResult = {
				kind: 'translate',
				loading: false,
				text: null,
				error: 'Übersetzung fehlgeschlagen — keine Verbindung.'
			};
		}
	}

	async function lookupExcerpt() {
		if (!selection) return;
		const excerpt = selection.excerpt;
		aiResult = { kind: 'lookup', loading: true, text: null, error: null };
		try {
			const text = await getProcessor().lookupSelection(excerpt, translationLanguage);
			aiResult = { kind: 'lookup', loading: false, text, error: null };
		} catch {
			aiResult = {
				kind: 'lookup',
				loading: false,
				text: null,
				error: 'Nachschlagen fehlgeschlagen — keine Verbindung.'
			};
		}
	}

	async function setLanguage(lang: string) {
		const previous = translationLanguage;
		translationLanguage = lang;
		try {
			await getProcessor().setTranslationLanguage(lang);
		} catch {
			translationLanguage = previous;
			showAnnotationError('Sprache konnte nicht gespeichert werden — keine Verbindung.');
		}
	}

	/** Render one stored annotation as an epub.js highlight (click opens its note editor). */
	function applyHighlight(a: Annotation) {
		rendition?.annotations.add(
			'highlight',
			a.cfiRange,
			{},
			() => onHighlightClick(a.cfiRange),
			'epubai-highlight',
			highlightStyles(a.color)
		);
	}

	function onHighlightClick(cfiRange: string) {
		const a = annotations.find((x) => x.cfiRange === cfiRange);
		if (a) openNoteEditor(a);
	}

	/** Tapping a color swatch on the selection bar creates the highlight directly in that color. */
	async function createHighlight(color: AnnotationColor) {
		if (!selection) return;
		const sel = selection;
		selection = null;
		try {
			const created = await getProcessor().createAnnotation(
				bookId,
				sel.cfiRange,
				sel.excerpt,
				undefined,
				color
			);
			annotations = [...annotations, created];
			applyHighlight(created);
		} catch {
			showAnnotationError('Markierung konnte nicht gespeichert werden — keine Verbindung.');
		}
	}

	function openNoteEditor(a: Annotation) {
		editing = a;
		noteDraft = a.note ?? '';
	}

	async function saveNote() {
		if (!editing) return;
		const a = editing;
		const note = noteDraft.trim() ? noteDraft.trim() : null;
		const updated = await getProcessor().updateAnnotationNote(a, note);
		annotations = annotations.map((x) => (x.id === updated.id ? updated : x));
		editing = null;
	}

	/** Tapping a color swatch on the note editor changes an existing highlight's color immediately. */
	async function changeHighlightColor(color: AnnotationColor) {
		if (!editing) return;
		const a = editing;
		const updated = await getProcessor().updateAnnotationColor(a, color);
		annotations = annotations.map((x) => (x.id === updated.id ? updated : x));
		editing = updated;
		rendition?.annotations.remove(a.cfiRange, 'highlight');
		applyHighlight(updated);
	}

	async function deleteHighlight(a: Annotation) {
		await getProcessor().deleteAnnotation(a.id);
		annotations = annotations.filter((x) => x.id !== a.id);
		rendition?.annotations.remove(a.cfiRange, 'highlight');
		if (editing?.id === a.id) editing = null;
	}

	function jumpToAnnotation(a: Annotation) {
		void rendition?.display(a.cfiRange);
		notesOpen = false;
	}

	onMount(async () => {
		if (!isAuthenticated()) {
			await goto('/login', { replaceState: true });
			return;
		}
		prefs = parsePrefs(localStorage.getItem(STORAGE_KEY));
		translationLanguage = getSession()?.translationLanguage ?? 'de';
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
			// returning reader sees their last settings right away. The margin
			// is handled by our own container's padding (set reactively in the
			// template from `prefs`, already applied by now), which epub.js
			// measures itself on its first render - no explicit resize() needed
			// here (and rendition.manager doesn't exist yet to call it on).
			applyPrefs();

			// Clear the loading overlay as soon as the first content is rendered
			// (belt-and-suspenders alongside the display() await below).
			rendition.on('rendered', () => {
				loading = false;
			});

			// A highlight's on-screen position is computed once, synchronously,
			// the moment epub.js first attaches it to a freshly rendered section
			// (node_modules/epubjs/src/annotations.js's inject/attach, backed by
			// marks-pane's Mark.render - it never recomputes on its own). If that
			// happens before the section's layout has fully settled, the position
			// is baked in wrong and stays wrong; this only affects highlights
			// re-applied on mount, not ones made live while already reading and
			// settled. Re-apply (remove + re-add) every stored highlight a couple
			// of frames after each section renders, forcing a fresh, now-correct
			// position. Safe to call for sections that haven't rendered (yet) too
			// - remove()/add() just re-arm epub.js's own lazy per-section attach.
			rendition.on('rendered', () => {
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						for (const a of annotations) {
							rendition?.annotations.remove(a.cfiRange, 'highlight');
							applyHighlight(a);
						}
					});
				});
			});

			// Text selection inside the rendered EPUB → offer the "Markieren" action.
			rendition.on('selected', (cfiRange: string, contents: { window: Window }) => {
				const text = contents.window.getSelection()?.toString().trim() ?? '';
				if (!text) return;
				selection = { cfiRange, excerpt: text };
			});

			// epub.js only ever emits 'selected' for a *non-empty* selection - tapping
			// elsewhere to deselect (collapsing the range) fires no event of its own,
			// so the action bar would otherwise stay stuck. 'click' is forwarded for
			// every tap regardless, so use it to notice the selection is now gone.
			rendition.on('click', (_event: MouseEvent, contents: { window: Window }) => {
				const text = contents.window.getSelection()?.toString().trim() ?? '';
				if (!text) selection = null;
			});

			// Re-apply this book's stored highlights from the LOCAL cache (never a
			// network call here — offline-first Reader). Added before display() so
			// they attach as each section renders.
			try {
				annotations = await getProcessor().loadAnnotations(bookId);
				for (const a of annotations) applyHighlight(a);
			} catch {
				// Highlights are a non-critical enhancement; ignore load failures.
			}

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

	/**
	 * Click-to-turn-page for mouse users. Only fires for a click landing
	 * directly on the reading pane's own margin (its background, not a
	 * descendant) - the book content lives in a separate iframe document,
	 * whose clicks never bubble out to this handler, so this can't block
	 * text-selection drags inside the text. Deliberately margin-only: the
	 * book content spans multiple "pages" within one wide iframe, so a
	 * click's position inside it can't be mapped to a page-relative edge.
	 */
	function onMarginClick(e: MouseEvent) {
		if (e.target !== e.currentTarget) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const ratio = (e.clientX - rect.left) / rect.width;
		if (ratio < 0.5) prev();
		else next();
	}

	function applyPrefs() {
		if (!rendition) return;
		rendition.themes.fontSize(fontSizePx(prefs.fontIndex));
		rendition.themes.default(readerThemeStyles(prefs.theme));
	}

	// epub.js's resize() re-measures its container when called with no
	// arguments at runtime, but its bundled types incorrectly require
	// width/height - cast away just that mismatch.
	function forceResize() {
		(rendition as unknown as { resize(): void } | null)?.resize();
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

	// The margin shrinks our own container (see MARGIN_PADDING in
	// preferences.ts); epub.js only re-measures it on an explicit resize(),
	// and not before the padding change has actually reached the DOM.
	async function setMargin(margin: ReaderMargin) {
		prefs = { ...prefs, margin };
		persistPrefs();
		await tick();
		forceResize();
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
		if (annotationErrorTimer) clearTimeout(annotationErrorTimer);
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
				onclick={() => (notesOpen = true)}
				aria-label="Notizen & Markierungen"
				class="p-1.5 text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)]"
			>
				<Highlighter size={20} />
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
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="relative flex-1 overflow-hidden"
		style="background: {THEME_COLORS[prefs.theme].bg}; padding: 0 {MARGIN_PADDING[
			prefs.margin
		]}"
		ontouchstart={onTouchStart}
		ontouchend={onTouchEnd}
		onclick={onMarginClick}
	>
		<div bind:this={viewer} class="h-full w-full"></div>

		{#if loading}
			<div class="absolute inset-0 grid place-items-center text-[var(--color-neutral-700)]">
				Lädt…
			</div>
		{/if}

		{#if selection && !aiResult}
			<div class="absolute inset-x-0 bottom-4 z-40 flex justify-center">
				<div class="flex items-center gap-1.5 border-2 border-[var(--color-divider)] bg-[var(--color-bg)] px-2 py-1.5 shadow">
					{#each HIGHLIGHT_COLORS as color (color.value)}
						<button
							onclick={() => createHighlight(color.value)}
							aria-label={color.label}
							class="h-8 w-8 flex-none rounded-full border border-[var(--color-divider)]"
							style="background-color: {color.hex}"
						></button>
					{/each}
					<button
						onclick={translateExcerpt}
						aria-label="Übersetzen"
						class="ml-1 flex flex-none items-center gap-1 border-l-2 border-[var(--color-divider)] py-2 pl-2 text-sm text-[var(--color-accent-700)]"
					>
						<Languages size={16} /> Übersetzen
					</button>
					<button
						onclick={lookupExcerpt}
						aria-label="Nachschlagen"
						class="flex flex-none items-center gap-1 py-2 text-sm text-[var(--color-accent-700)]"
					>
						<BookOpenText size={16} /> Nachschlagen
					</button>
					<button
						onclick={() => (selection = null)}
						aria-label="Abbrechen"
						class="ml-1 flex-none border-l-2 border-[var(--color-divider)] py-2 pl-2 text-[var(--color-neutral-700)]"
					>
						<X size={16} />
					</button>
				</div>
			</div>
		{/if}

		{#if annotationError}
			<div class="absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
				<p class="bg-[var(--color-accent-100)] px-3 py-2 text-center text-sm text-[var(--color-accent-800)]">
					{annotationError}
				</p>
			</div>
		{/if}
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

			<div class="mt-2 border-t-2 border-[var(--color-divider)] py-3">
				<span class="text-sm text-[var(--color-neutral-700)]">Übersetzungssprache</span>
				<p class="mt-0.5 text-xs text-[var(--color-neutral-700)]">
					Die Sprache gilt für das Konto, d.h. alle Bücher und Geräte.
				</p>
				<div class="mt-2 flex flex-wrap gap-2">
					{#each AVAILABLE_LANGUAGES as option (option.value)}
						<button
							onclick={() => setLanguage(option.value)}
							class="border px-3 py-2 text-sm {translationLanguage === option.value
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

	{#if notesOpen}
		<button
			aria-label="Notizen schließen"
			onclick={() => (notesOpen = false)}
			class="absolute inset-0 z-20 bg-black/40"
		></button>
		<aside
			class="absolute inset-y-0 right-0 z-30 flex w-4/5 max-w-[340px] flex-col border-l-2 border-[var(--color-divider)] bg-[var(--color-bg)]"
		>
			<div class="flex items-center justify-between border-b-2 border-[var(--color-divider)] px-4 py-3">
				<span class="font-[var(--font-heading)] text-sm font-extrabold tracking-tight">
					Notizen & Markierungen
				</span>
				<button onclick={() => (notesOpen = false)} aria-label="Schließen" class="text-[var(--color-accent-700)]">
					<X size={20} />
				</button>
			</div>
			<div class="flex-1 overflow-y-auto py-1">
				{#if annotations.length === 0}
					<p class="px-4 py-3 text-sm text-[var(--color-neutral-700)]">
						Noch keine Markierungen. Text markieren, um eine anzulegen.
					</p>
				{:else}
					{#each annotations as a (a.id)}
						<div class="flex items-start gap-2 border-b border-[var(--color-divider)] px-4 py-3">
							<span
								aria-hidden="true"
								class="mt-1.5 h-3 w-3 flex-none rounded-full"
								style="background-color: {colorHex(a.color)}"
							></span>
							<button onclick={() => jumpToAnnotation(a)} class="min-w-0 flex-1 text-left">
								<p class="line-clamp-2 text-sm text-[var(--color-text)]">„{a.excerpt}“</p>
								{#if a.note}
									<p class="mt-1 line-clamp-2 text-xs text-[var(--color-neutral-700)]">{a.note}</p>
								{/if}
							</button>
							<button
								onclick={() => deleteHighlight(a)}
								aria-label="Markierung löschen"
								class="flex-none p-1 text-[var(--color-accent-700)]"
							>
								<Trash2 size={16} />
							</button>
						</div>
					{/each}
				{/if}
			</div>
		</aside>
	{/if}

	{#if editing}
		<button
			aria-label="Notiz schließen"
			onclick={() => (editing = null)}
			class="absolute inset-0 z-20 bg-black/40"
		></button>
		<section
			class="absolute inset-x-0 bottom-0 z-30 border-t-2 border-[var(--color-divider)] bg-[var(--color-bg)] px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
		>
			<div class="mb-3 flex items-center justify-between">
				<span class="font-[var(--font-heading)] text-sm font-extrabold tracking-tight">Notiz</span>
				<button onclick={() => (editing = null)} aria-label="Schließen" class="text-[var(--color-accent-700)]">
					<X size={20} />
				</button>
			</div>
			<p class="mb-2 line-clamp-3 text-sm text-[var(--color-neutral-700)]">„{editing.excerpt}“</p>
			<div class="mb-3 flex items-center gap-2.5">
				{#each HIGHLIGHT_COLORS as color (color.value)}
					<button
						onclick={() => changeHighlightColor(color.value)}
						aria-label={color.label}
						aria-pressed={editing.color === color.value}
						class="relative h-9 w-9 flex-none rounded-full transition {editing.color === color.value
							? 'ring-2 ring-offset-2 ring-[var(--color-text)] ring-offset-[var(--color-bg)]'
							: ''}"
						style="background-color: {color.hex}"
					>
						{#if editing.color === color.value}
							<span class="absolute inset-0 flex items-center justify-center rounded-full bg-black/20">
								<Check size={18} color="white" strokeWidth={3} />
							</span>
						{/if}
					</button>
				{/each}
			</div>
			<textarea
				bind:value={noteDraft}
				rows="4"
				placeholder="Notiz hinzufügen…"
				class="w-full resize-none border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
			></textarea>
			<div class="mt-3 flex items-center gap-2">
				<button
					onclick={saveNote}
					class="flex-1 bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--color-bg)]"
				>
					Speichern
				</button>
				<button
					onclick={() => editing && deleteHighlight(editing)}
					aria-label="Markierung löschen"
					class="flex items-center gap-1.5 border border-[var(--color-divider)] px-4 py-2.5 text-sm text-[var(--color-accent-700)]"
				>
					<Trash2 size={16} /> Löschen
				</button>
			</div>
		</section>
	{/if}

	{#if aiResult}
		<button
			aria-label="Schließen"
			onclick={() => (aiResult = null)}
			class="absolute inset-0 z-20 bg-black/40"
		></button>
		<section
			class="absolute inset-x-0 bottom-0 z-30 border-t-2 border-[var(--color-divider)] bg-[var(--color-bg)] px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
		>
			<div class="mb-3 flex items-center justify-between">
				<span class="font-[var(--font-heading)] text-sm font-extrabold tracking-tight">
					{aiResult.kind === 'translate' ? 'Übersetzung' : 'Worterklärung'}
				</span>
				<button onclick={() => (aiResult = null)} aria-label="Schließen" class="text-[var(--color-accent-700)]">
					<X size={20} />
				</button>
			</div>
			{#if aiResult.loading}
				<p class="py-4 text-center text-sm text-[var(--color-neutral-700)]">Einen Moment…</p>
			{:else if aiResult.error}
				<p class="bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">
					{aiResult.error}
				</p>
			{:else}
				<div
					class="max-h-[40vh] overflow-y-auto text-sm text-[var(--color-text)] [&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-semibold [&_p]:mb-2 [&_strong]:font-semibold [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5"
				>
					{@html aiResultHtml}
				</div>
			{/if}
		</section>
	{/if}
</div>
</div>
