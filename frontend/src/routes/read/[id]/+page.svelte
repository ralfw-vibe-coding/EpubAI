<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { fade, slide } from 'svelte/transition';
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
		BookOpenText,
		MessagesSquare,
		BookmarkPlus,
		Eye,
		Pencil,
		Search,
		ArrowLeft
	} from 'lucide-svelte';
	import type { Annotation, AnnotationColor } from '../../../domain/types';
	import type { ChatMessage } from '../../../processor/ports';
	import { getProcessor, getSession, isAuthenticated } from '../../../portal/runtime';
	import { colorHex, HIGHLIGHT_COLORS, highlightStyles } from './colors';
	import { normalizeTag } from './tags';
	import { isSwipeGesture } from './swipe';
	import { searchBook, highlightExcerpt, type BookSearchResult, MAX_BOOK_SEARCH_RESULTS } from './bookSearch';
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

	// Immersive reading: header/footer claim screen space the reader is
	// otherwise all text. They auto-hide after a few seconds of inactivity and
	// come back on a tap - same pattern as most reading apps' fullscreen mode.
	const CHROME_AUTO_HIDE_MS = 3000;
	const CHROME_TRANSITION_MS = 200;
	let chromeVisible = $state(true);
	let chromeHideTimer: ReturnType<typeof setTimeout> | undefined;

	function scheduleChromeHide() {
		if (chromeHideTimer) clearTimeout(chromeHideTimer);
		chromeHideTimer = setTimeout(() => {
			chromeVisible = false;
			// toggleChrome() (manual tap) already nudges epub.js to re-measure
			// after hiding the header/footer - the auto-hide timer was missing
			// the same nudge, so the page stayed laid out for the smaller
			// with-chrome viewport and clipped its last line once the footer's
			// space became available.
			setTimeout(forceResize, CHROME_TRANSITION_MS + 20);
		}, CHROME_AUTO_HIDE_MS);
	}

	function showChrome() {
		chromeVisible = true;
		scheduleChromeHide();
	}

	// Hiding/showing the header/footer resizes the reading pane (they're
	// normal flex-column siblings, not an overlay) - epub.js only re-measures
	// its container on an explicit resize(), so nudge it once the slide
	// transition has settled (mirrors setMargin's tick()+forceResize() pattern).
	function toggleChrome() {
		if (chromeVisible) {
			chromeVisible = false;
			if (chromeHideTimer) clearTimeout(chromeHideTimer);
		} else {
			showChrome();
		}
		setTimeout(forceResize, CHROME_TRANSITION_MS + 20);
	}
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

	// Volltextsuche im Buch: results/query survive closing the panel (only
	// `searchOpen` toggles), so reopening it shows the same hit list rather
	// than forcing a re-search - explicit trigger only (Enter/Icon), never
	// live-as-you-type, since a full-book search reads every chapter.
	let searchOpen = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<BookSearchResult[] | null>(null);
	let searching = $state(false);
	let searchError = $state<string | null>(null);
	// The CFI range of the search match currently highlighted on the page (a
	// transient epub.js annotation, not a real saved highlight) - tracked so a
	// second jump can remove the previous one instead of accumulating marks.
	let searchHighlightCfi: string | null = null;

	// Browser-style back history: every deliberate jump away from the current
	// spot - TOC, Suche, eine Notiz/Markierung antippen, oder ein interner
	// Link (Fußnote) im Buchtext - pushes the position jumped FROM here first.
	// Plain page-turning (prev/next/Wischen) never pushes: that's reading
	// forward, not "going somewhere else". No forward-stack (not asked for) -
	// "Zurück" only ever pops, it's a one-way trip back through the stops.
	let navHistory = $state<string[]>([]);

	// Notizen & Markierungen: loaded from the local cache on open, kept in sync
	// with epub.js highlights. `selection` drives the floating color-swatch bar
	// shown after a text selection; `editing` drives the note-editor bottom sheet.
	let annotations = $state<Annotation[]>([]);
	let notesOpen = $state(false);
	let selection = $state<{ cfiRange: string; excerpt: string } | null>(null);
	let editing = $state<Annotation | null>(null);
	let noteDraft = $state('');
	// Free-form tag chips being edited alongside the note (the same `#flashcard`
	// mechanism, user-editable for any note). `tagInput` is the pending text.
	let noteDraftTags = $state<string[]>([]);
	let tagInput = $state('');
	// Note editor: preview (rendered Markdown) vs edit (raw textarea). Defaults to
	// preview only when reopening a pre-existing note that already has text.
	let notePreviewMode = $state(false);
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
	// Account-level default highlight color for vocabulary flashcards (Settings).
	let flashcardColor = $state<AnnotationColor>('yellow');
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
	// The note editor's Markdown preview (annotation notes are Markdown too).
	let noteDraftHtml = $derived(
		noteDraft.trim() ? DOMPurify.sanitize(marked.parse(noteDraft, { async: false })) : ''
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

	/**
	 * Chat sheet (§4.6/chat): two entry points share one state — "Kontext-Chat"
	 * from the selection bar (carries the excerpt + reading progress so the
	 * backend can disambiguate a repeated passage) and "Buch-Chat" from the
	 * toolbar (no selection, just the book as a whole). History is kept only in
	 * this page's state and sent in full on every turn — the backend is
	 * stateless — and is gone once the sheet closes (by design).
	 */
	let chat = $state<{
		kind: 'context' | 'book';
		selectionExcerpt: string | null;
		messages: ChatMessage[];
		input: string;
		loading: boolean;
		error: string | null;
		/** From the latest reply; null until the first answer arrives. */
		dossierUsed: boolean | null;
		/** Running Claude cost of this chat session, summed over its replies (USD). */
		sessionCostUsd: number;
	} | null>(null);

	// The book-wide chat continues across close/reopen within the reading
	// session (a running conversation about the book); the selection chat always
	// starts fresh. Held separately so closing the sheet doesn't discard it - and
	// the reader can wipe it via "Leeren".
	let bookConversation = $state<{
		messages: ChatMessage[];
		dossierUsed: boolean | null;
		sessionCostUsd: number;
	} | null>(null);

	/** Chat replies are Markdown too (same backend prompts as translate/lookup) — render like `aiResultHtml`. */
	function chatMessageHtml(content: string): string {
		return DOMPurify.sanitize(marked.parse(content, { async: false }));
	}

	/** Rough USD figure for the cost read-outs — cents, German decimal comma, small floor. */
	function formatUsd(amount: number): string {
		if (amount < 0.005) return '< $0,01';
		return '$' + amount.toFixed(2).replace('.', ',');
	}

	// The chat input grows with its content up to ~5 lines, then scrolls.
	let chatInputEl = $state<HTMLTextAreaElement | undefined>(undefined);
	const CHAT_INPUT_MAX_PX = 120;
	function autoGrowChatInput() {
		const el = chatInputEl;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = Math.min(el.scrollHeight, CHAT_INPUT_MAX_PX) + 'px';
	}

	function openContextChat() {
		if (!selection) return;
		chat = {
			kind: 'context',
			selectionExcerpt: selection.excerpt,
			messages: [],
			input: '',
			loading: false,
			error: null,
			dossierUsed: null,
			sessionCostUsd: 0
		};
	}

	function openBookChat() {
		// Resume the running book conversation if there is one.
		chat = {
			kind: 'book',
			selectionExcerpt: null,
			messages: bookConversation?.messages ?? [],
			input: '',
			loading: false,
			error: null,
			dossierUsed: bookConversation?.dossierUsed ?? null,
			sessionCostUsd: bookConversation?.sessionCostUsd ?? 0
		};
	}

	/** Wipe the running book conversation (the "Leeren" button). */
	function clearBookChat() {
		bookConversation = null;
		if (chat && chat.kind === 'book') {
			chat = { ...chat, messages: [], dossierUsed: null, sessionCostUsd: 0, error: null };
		}
	}

	function closeChat() {
		// Book chat continues next time it's opened; the selection chat does not.
		if (chat && chat.kind === 'book') {
			bookConversation = {
				messages: chat.messages,
				dossierUsed: chat.dossierUsed,
				sessionCostUsd: chat.sessionCostUsd
			};
		}
		chat = null;
	}

	async function sendChatMessage() {
		if (!chat || chat.loading) return;
		const text = chat.input.trim();
		if (!text) return;
		const current = chat;
		const messages: ChatMessage[] = [...current.messages, { role: 'user', content: text }];
		chat = { ...current, messages, input: '', loading: true, error: null };
		void tick().then(autoGrowChatInput); // input cleared → shrink back to one line
		try {
			// `percent` is 0..100 for the on-screen read-out; the contract wants 0..1.
			const reply = await getProcessor().chatAboutBook(
				bookId,
				messages,
				chat.kind === 'context' ? (chat.selectionExcerpt ?? undefined) : undefined,
				chat.kind === 'context' ? percent / 100 : undefined
			);
			if (!chat) return;
			chat = {
				...chat,
				messages: [...chat.messages, { role: 'assistant', content: reply.text }],
				loading: false,
				dossierUsed: reply.dossierUsed,
				sessionCostUsd: chat.sessionCostUsd + reply.costUsd
			};
		} catch {
			if (!chat) return;
			chat = { ...chat, loading: false, error: 'Antwort fehlgeschlagen — keine Verbindung.' };
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

	// Tracks the note/tags as last saved (or as loaded), so the Speichern button
	// can stay disabled until there's actually something new to save - that
	// disabled state is itself the "did my last save take?" feedback the button
	// otherwise didn't give.
	let originalNoteDraft = $state('');
	let originalNoteDraftTags = $state<string[]>([]);
	let savingNote = $state(false);
	let noteJustSaved = $state(false);
	let noteSavedFlashTimer: ReturnType<typeof setTimeout> | null = null;
	const NOTE_SAVED_FLASH_MS = 1500;
	// The local save (SQLite-via-OPFS-worker) normally completes in well under a
	// second; if the worker connection is wedged (e.g. a stale leader tab), the
	// call can otherwise hang forever with the button stuck on "Speichert…" and
	// no way to know it failed. Cap it so a stuck save surfaces as an error.
	const SAVE_TIMEOUT_MS = 5000;

	function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) => setTimeout(() => reject(new Error('save timed out')), ms))
		]);
	}

	function sameTags(a: string[], b: string[]): boolean {
		if (a.length !== b.length) return false;
		const sortedA = [...a].sort();
		const sortedB = [...b].sort();
		return sortedA.every((t, i) => t === sortedB[i]);
	}

	let noteDirty = $derived(
		noteDraft.trim() !== originalNoteDraft.trim() || !sameTags(noteDraftTags, originalNoteDraftTags)
	);

	function openNoteEditor(a: Annotation, justCreated = false) {
		editing = a;
		noteDraft = a.note ?? '';
		noteDraftTags = [...a.tags];
		originalNoteDraft = noteDraft;
		originalNoteDraftTags = [...a.tags];
		tagInput = '';
		noteJustSaved = false;
		if (noteSavedFlashTimer) clearTimeout(noteSavedFlashTimer);
		// Land in the rendered preview only when reopening a pre-existing note that
		// already has text; a just-created note (or an empty one) opens raw.
		notePreviewMode = !justCreated && a.note !== null && a.note.trim() !== '';
	}

	function addTagFromInput() {
		const tag = normalizeTag(tagInput);
		if (tag && !noteDraftTags.includes(tag)) noteDraftTags = [...noteDraftTags, tag];
		tagInput = '';
	}

	function removeNoteTag(tag: string) {
		noteDraftTags = noteDraftTags.filter((t) => t !== tag);
	}

	/**
	 * Saving no longer closes the sheet (matches changeHighlightColor, which
	 * also saves in place) - the Speichern button disabling itself, plus the
	 * brief "Gespeichert" flash, are the confirmation that the click did
	 * something. A failure now surfaces an error instead of leaving the editor
	 * looking unchanged with no clue whether the save actually happened.
	 */
	async function saveNote() {
		if (!editing || !noteDirty || savingNote) return;
		const a = editing;
		const note = noteDraft.trim() ? noteDraft.trim() : null;
		const tags = noteDraftTags;
		savingNote = true;
		try {
			const updated = await withTimeout(getProcessor().updateAnnotationNote(a, note, tags), SAVE_TIMEOUT_MS);
			annotations = annotations.map((x) => (x.id === updated.id ? updated : x));
			if (editing?.id === updated.id) {
				editing = updated;
				originalNoteDraft = noteDraft;
				originalNoteDraftTags = [...tags];
			}
			noteJustSaved = true;
			if (noteSavedFlashTimer) clearTimeout(noteSavedFlashTimer);
			noteSavedFlashTimer = setTimeout(() => (noteJustSaved = false), NOTE_SAVED_FLASH_MS);
		} catch (error) {
			// Unlike createHighlight/setDefaultFlashcardColor/etc., this save is
			// local-first (SQLite-via-OPFS-worker) - the backend push already fails
			// silently on its own (best-effort, self-heals on next sync), so an
			// error here is a local write problem, never a network one. Saying
			// "keine Verbindung" would just be wrong. The real cause goes to the
			// console - the toast stays user-friendly, but the diagnostic must
			// not be swallowed.
			console.error('[saveNote] fehlgeschlagen:', error);
			showAnnotationError('Notiz konnte nicht gespeichert werden. Bitte erneut versuchen.');
		} finally {
			savingNote = false;
		}
	}

	/** Save the current translation as a highlighted "flashcard" annotation, then edit it. */
	async function rememberAsVocab() {
		if (!selection || !aiResult?.text) return;
		const sel = selection;
		const translation = aiResult.text;
		const color = (getSession()?.defaultFlashcardColor ?? 'yellow') as AnnotationColor;
		try {
			const created = await getProcessor().createAnnotation(
				bookId,
				sel.cfiRange,
				sel.excerpt,
				translation,
				color,
				['flashcard']
			);
			annotations = [...annotations, created];
			applyHighlight(created);
			selection = null;
			aiResult = null;
			openNoteEditor(created, true);
		} catch {
			showAnnotationError('Vokabel konnte nicht gespeichert werden — keine Verbindung.');
		}
	}

	async function setFlashcardColor(color: AnnotationColor) {
		const previous = flashcardColor;
		flashcardColor = color;
		try {
			await getProcessor().setDefaultFlashcardColor(color);
		} catch {
			flashcardColor = previous;
			showAnnotationError('Standardfarbe konnte nicht gespeichert werden — keine Verbindung.');
		}
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

	/** Push the current spot onto the back-history - call right before any deliberate jump away from it. */
	function pushHistory() {
		if (currentCfi) navHistory = [...navHistory, currentCfi];
	}

	function jumpToAnnotation(a: Annotation) {
		pushHistory();
		void rendition?.display(a.cfiRange);
		notesOpen = false;
	}

	/** Clears the previous search-match highlight (if any) before re-adding it at a new CFI. */
	function setSearchHighlight(cfi: string) {
		if (searchHighlightCfi) rendition?.annotations.remove(searchHighlightCfi, 'highlight');
		rendition?.annotations.add('highlight', cfi, {}, undefined, 'epubai-search-highlight', highlightStyles('yellow'));
		searchHighlightCfi = cfi;
	}

	function clearSearchHighlight() {
		if (!searchHighlightCfi) return;
		rendition?.annotations.remove(searchHighlightCfi, 'highlight');
		searchHighlightCfi = null;
	}

	/** Pops the last history entry and jumps there - a no-op with an empty stack. */
	function jumpBack() {
		if (navHistory.length === 0) return;
		const target = navHistory[navHistory.length - 1];
		navHistory = navHistory.slice(0, -1);
		clearSearchHighlight();
		void rendition?.display(target);
	}

	async function runBookSearch() {
		const q = searchQuery.trim();
		if (!q || !book || searching) return;
		searching = true;
		searchError = null;
		try {
			searchResults = await searchBook(book, q);
		} catch {
			searchError = 'Suche fehlgeschlagen.';
			searchResults = null;
		} finally {
			searching = false;
		}
	}

	/** "Suche löschen": clears query, results and any on-page match highlight - not just the input text. */
	function clearSearch() {
		searchQuery = '';
		searchResults = null;
		searchError = null;
		clearSearchHighlight();
	}

	async function jumpToSearchResult(r: BookSearchResult) {
		pushHistory();
		searchOpen = false;
		await rendition?.display(r.cfi);
		setSearchHighlight(r.cfi);
	}

	onMount(async () => {
		if (!isAuthenticated()) {
			await goto('/login', { replaceState: true });
			return;
		}
		prefs = parsePrefs(localStorage.getItem(STORAGE_KEY));
		translationLanguage = getSession()?.translationLanguage ?? 'de';
		flashcardColor = (getSession()?.defaultFlashcardColor as AnnotationColor) ?? 'yellow';
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
			// A tap that isn't dismissing a selection toggles the immersive chrome
			// instead - the same tap gesture would be surprising if it did both.
			rendition.on('click', (_event: MouseEvent, contents: { window: Window }) => {
				const text = contents.window.getSelection()?.toString().trim() ?? '';
				if (text) return;
				if (selection) {
					selection = null;
				} else {
					toggleChrome();
				}
			});

			// Swipe-to-turn-page over the book's own content (see onContentTouchStart/
			// onContentTouchEnd for why this can't just be a DOM listener on our container).
			rendition.on('touchstart', onContentTouchStart);
			rendition.on('touchend', onContentTouchEnd);

			// Internal links (footnotes, cross-references) already navigate on tap -
			// epub.js's own Rendition.handleLinks wires that up unconditionally, we
			// don't call display() for it ourselves. This is a second, independent
			// listener on the same per-section 'linkClicked' event, registered here
			// purely to push the tapped-FROM position onto the back-history before
			// that navigation lands - reading currentCfi synchronously inside this
			// handler is still the pre-jump value, since handleLinks's display()
			// call is async and 'relocated' (which updates currentCfi) hasn't fired
			// yet at this point in the same event tick. `contents.on` isn't in
			// epub.js's own .d.ts (same gap as Section.find(), see bookSearch.ts),
			// hence the local inline type instead of importing Contents for this.
			rendition.hooks.content.register((contents: { on(event: string, cb: (href: string) => void): void }) => {
				contents.on('linkClicked', () => pushHistory());
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

			// A `?cfi=` query param (e.g. from the book detail page's annotations
			// list, "open in reader") jumps straight to that spot; otherwise resume
			// at the stored reading position, or start at the beginning. Same
			// display() call either way - a deep-linked CFI is just as valid a
			// target as a resumed one (both are real CFIs from this exact book).
			const deepLinkCfi = $page.url.searchParams.get('cfi');
			await rendition.display(deepLinkCfi || progress?.cfi || undefined);
			if (progress) {
				percent = progress.percent;
				// Show the page numbers from the last session immediately; they'll be
				// recomputed (and may shift slightly) once locations regenerate below.
				currentPage = progress.page;
				totalPages = progress.totalPages;
			}
			loading = false;
			scheduleChromeHide();

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

	// A page turn otherwise happens instantly, easy to miss entirely on a quick
	// swipe. This is deliberately NOT a page-curl/flip - just a thin bar
	// sweeping across the pane, timed so the actual page swap lands roughly
	// when the bar passes the middle, giving a "before/after" feel without
	// simulating a real page. Direction matches the swipe that caused it: a
	// leftward drag ("next") sweeps right-to-left, a rightward drag ("prev")
	// sweeps left-to-right.
	const PAGE_TURN_SWEEP_MS = 320;
	const PAGE_TURN_SWAP_DELAY_MS = 140;
	let pageTurnAnim = $state<'next' | 'prev' | null>(null);

	function triggerPageTurn(direction: 'next' | 'prev', turn: () => void) {
		pageTurnAnim = direction;
		setTimeout(turn, PAGE_TURN_SWAP_DELAY_MS);
		setTimeout(() => {
			pageTurnAnim = null;
		}, PAGE_TURN_SWEEP_MS);
		// Turning pages is activity too - if the chrome is already visible, keep
		// it up a while longer rather than letting it vanish mid-flip. If it's
		// already hidden, a swipe to turn the page shouldn't summon it back.
		if (chromeVisible) scheduleChromeHide();
	}

	function next() {
		triggerPageTurn('next', () => void rendition?.next());
	}
	function prev() {
		triggerPageTurn('prev', () => void rendition?.prev());
	}

	// Touch swipe navigation (buttons remain as a fallback).
	// Swiping over the page margin (our own container, outside the book's
	// rendered iframe) - plain DOM touch events work fine here since there's
	// no selectable text in the margin to interfere with.
	let touchX = 0;
	let touchY = 0;
	let touchTime = 0;
	function onTouchStart(e: TouchEvent) {
		touchX = e.changedTouches[0].clientX;
		touchY = e.changedTouches[0].clientY;
		touchTime = Date.now();
	}
	function onTouchEnd(e: TouchEvent) {
		const t = e.changedTouches[0];
		const dx = t.clientX - touchX;
		const dy = t.clientY - touchY;
		if (!isSwipeGesture(dx, dy, Date.now() - touchTime)) return;
		if (dx < 0) next();
		else prev();
	}

	// Swiping over the book's own rendered content lives in a separate iframe
	// per section - touch events never bubble out of it to the container
	// above, so this needs epub.js's own per-Contents event forwarding (same
	// mechanism the 'selected'/'click' handlers below rely on). Guarded so it
	// never fires as a side effect of selecting text: besides the quick/
	// mostly-horizontal check, a swipe never fires if the touch ended with an
	// active (non-empty) selection in that iframe - that gesture was
	// selecting a passage, not turning the page.
	let contentTouchX = 0;
	let contentTouchY = 0;
	let contentTouchTime = 0;
	function onContentTouchStart(e: TouchEvent) {
		const t = e.changedTouches[0];
		contentTouchX = t.clientX;
		contentTouchY = t.clientY;
		contentTouchTime = Date.now();
	}
	function onContentTouchEnd(e: TouchEvent, contents: { window: Window }) {
		const t = e.changedTouches[0];
		const dx = t.clientX - contentTouchX;
		const dy = t.clientY - contentTouchY;
		if (!isSwipeGesture(dx, dy, Date.now() - contentTouchTime)) return;
		if ((contents.window.getSelection()?.toString() ?? '') !== '') return;
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
		pushHistory();
		void rendition?.display(href);
		tocOpen = false;
	}

	onDestroy(() => {
		document.removeEventListener('visibilitychange', onVisibility);
		if (annotationErrorTimer) clearTimeout(annotationErrorTimer);
		if (chromeHideTimer) clearTimeout(chromeHideTimer);
		if (noteSavedFlashTimer) clearTimeout(noteSavedFlashTimer);
		void save();
		rendition?.destroy();
		book?.destroy();
	});
</script>

<div class="min-h-dvh w-full bg-[var(--color-neutral-200)] flex justify-center">
<div class="relative flex h-dvh w-full max-w-[520px] flex-col bg-[var(--color-neutral-100)]">
	{#if chromeVisible}
	<header
		transition:slide={{ duration: CHROME_TRANSITION_MS }}
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
				onclick={() => (searchOpen = true)}
				aria-label="Suche im Buch"
				class="p-1.5 text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)]"
			>
				<Search size={20} />
			</button>
			<button
				onclick={() => (notesOpen = true)}
				aria-label="Notizen & Markierungen"
				class="p-1.5 text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)]"
			>
				<Highlighter size={20} />
			</button>
			<button
				onclick={openBookChat}
				aria-label="Chat zum Buch"
				class="p-1.5 text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)]"
			>
				<MessagesSquare size={20} />
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
	{/if}

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

		{#if pageTurnAnim}
			<div class="page-turn-sweep {pageTurnAnim}"></div>
		{/if}

		{#if loading}
			<div class="absolute inset-0 grid place-items-center text-[var(--color-neutral-700)]">
				Lädt…
			</div>
		{/if}

		{#if selection && !aiResult && !chat}
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
						class="ml-1 flex h-9 w-9 flex-none items-center justify-center border-l-2 border-[var(--color-divider)] text-[var(--color-accent-700)]"
					>
						<Languages size={18} />
					</button>
					<button
						onclick={lookupExcerpt}
						aria-label="Nachschlagen"
						class="flex h-9 w-9 flex-none items-center justify-center text-[var(--color-accent-700)]"
					>
						<BookOpenText size={18} />
					</button>
					<button
						onclick={openContextChat}
						aria-label="Chat zur Selektion"
						class="flex h-9 w-9 flex-none items-center justify-center text-[var(--color-accent-700)]"
					>
						<MessagesSquare size={18} />
					</button>
					<button
						onclick={() => (selection = null)}
						aria-label="Abbrechen"
						class="ml-1 flex h-9 w-9 flex-none items-center justify-center border-l-2 border-[var(--color-divider)] text-[var(--color-neutral-700)]"
					>
						<X size={18} />
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

		{#if navHistory.length > 0 && !selection && !aiResult && !chat && !annotationError}
			<div class="absolute inset-x-0 bottom-4 z-40 flex justify-center">
				<div class="flex items-center border-2 border-[var(--color-divider)] bg-[var(--color-bg)] shadow">
					<button
						onclick={jumpBack}
						class="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--color-accent-700)]"
					>
						<ArrowLeft size={16} /> Zurück zur vorherigen Stelle
					</button>
					<button
						onclick={() => (navHistory = [])}
						aria-label="Verlauf löschen"
						title="Verlauf löschen"
						class="flex-none border-l-2 border-[var(--color-divider)] p-1.5 text-[var(--color-neutral-700)]"
					>
						<X size={16} />
					</button>
				</div>
			</div>
		{/if}
	</div>

	{#if chromeVisible}
	<div
		transition:slide={{ duration: CHROME_TRANSITION_MS }}
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
	{/if}

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

	{#if searchOpen}
		<button
			aria-label="Suche schließen"
			onclick={() => (searchOpen = false)}
			class="absolute inset-0 z-20 bg-black/40"
		></button>
		<aside
			class="absolute inset-y-0 right-0 z-30 flex w-4/5 max-w-[340px] flex-col border-l-2 border-[var(--color-divider)] bg-[var(--color-bg)]"
		>
			<div class="flex items-center justify-between border-b-2 border-[var(--color-divider)] px-4 py-3">
				<span class="font-[var(--font-heading)] text-sm font-extrabold tracking-tight">Suche im Buch</span>
				<button onclick={() => (searchOpen = false)} aria-label="Schließen" class="text-[var(--color-accent-700)]">
					<X size={20} />
				</button>
			</div>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					void runBookSearch();
				}}
				class="flex flex-none items-center gap-2 border-b border-[var(--color-divider)] px-4 py-3"
			>
				<input
					type="search"
					bind:value={searchQuery}
					placeholder="Suchbegriff…"
					aria-label="Suchbegriff"
					class="w-full border border-[var(--color-divider)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
				/>
				<button
					type="submit"
					aria-label="Suchen"
					disabled={searching || !searchQuery.trim()}
					class="flex-none p-1.5 text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)] disabled:opacity-40"
				>
					<Search size={18} />
				</button>
				{#if searchQuery || searchResults !== null}
					<button
						type="button"
						onclick={clearSearch}
						aria-label="Suche löschen"
						title="Suche löschen"
						class="flex-none p-1.5 text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)]"
					>
						<X size={18} />
					</button>
				{/if}
			</form>
			<div class="flex-1 overflow-y-auto py-1">
				{#if searching}
					<p class="px-4 py-3 text-sm text-[var(--color-neutral-700)]">Durchsuche das Buch…</p>
				{:else if searchError}
					<p class="bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">
						{searchError}
					</p>
				{:else if searchResults === null}
					<p class="px-4 py-3 text-sm text-[var(--color-neutral-700)]">
						Suchbegriff eingeben und Enter drücken.
					</p>
				{:else if searchResults.length === 0}
					<p class="px-4 py-3 text-sm text-[var(--color-neutral-700)]">Keine Treffer.</p>
				{:else}
					<p class="px-4 py-2 text-xs text-[var(--color-neutral-700)]">
						{searchResults.length}{searchResults.length >= MAX_BOOK_SEARCH_RESULTS ? '+' : ''} Treffer
					</p>
					{#each searchResults as r, i (i)}
						<button
							onclick={() => jumpToSearchResult(r)}
							class="block w-full border-b border-[var(--color-divider)] px-4 py-3 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)]"
						>
							„{@html DOMPurify.sanitize(highlightExcerpt(r.excerpt, searchQuery))}“
						</button>
					{/each}
				{/if}
			</div>
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

			<div class="border-t-2 border-[var(--color-divider)] py-3">
				<span class="text-sm text-[var(--color-neutral-700)]">Standardfarbe für Vokabelkarten</span>
				<p class="mt-0.5 text-xs text-[var(--color-neutral-700)]">
					Farbe neuer Vokabel-Markierungen aus „Als Vokabel merken“. Gilt für das Konto.
				</p>
				<div class="mt-2 flex items-center gap-2.5">
					{#each HIGHLIGHT_COLORS as color (color.value)}
						<button
							onclick={() => setFlashcardColor(color.value)}
							aria-label={color.label}
							aria-pressed={flashcardColor === color.value}
							class="relative h-9 w-9 flex-none rounded-full transition {flashcardColor === color.value
								? 'ring-2 ring-offset-2 ring-[var(--color-text)] ring-offset-[var(--color-bg)]'
								: ''}"
							style="background-color: {color.hex}"
						>
							{#if flashcardColor === color.value}
								<span class="absolute inset-0 flex items-center justify-center rounded-full bg-black/20">
									<Check size={18} color="white" strokeWidth={3} />
								</span>
							{/if}
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
				<div class="flex items-center gap-2">
					<span class="font-[var(--font-heading)] text-sm font-extrabold tracking-tight">Notiz</span>
					{#if noteDraft.trim() !== ''}
						<button
							onclick={() => (notePreviewMode = !notePreviewMode)}
							aria-label={notePreviewMode ? 'Notiz bearbeiten' : 'Vorschau'}
							title={notePreviewMode ? 'Bearbeiten' : 'Vorschau'}
							class="p-1 text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)]"
						>
							{#if notePreviewMode}
								<Pencil size={16} />
							{:else}
								<Eye size={16} />
							{/if}
						</button>
					{/if}
				</div>
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
			<div class="mb-3">
				{#if noteDraftTags.length > 0}
					<div class="mb-2 flex flex-wrap gap-1.5">
						{#each noteDraftTags as tag (tag)}
							<span
								class="flex items-center gap-1 border border-[var(--color-divider)] bg-[var(--color-surface)] py-0.5 pr-1 pl-2 text-xs text-[var(--color-text)]"
							>
								#{tag}
								<button
									onclick={() => removeNoteTag(tag)}
									aria-label={`Tag ${tag} entfernen`}
									class="flex items-center text-[var(--color-neutral-700)] hover:text-[var(--color-accent-700)]"
								>
									<X size={12} />
								</button>
							</span>
						{/each}
					</div>
				{/if}
				<input
					bind:value={tagInput}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							addTagFromInput();
						}
					}}
					placeholder="Tag hinzufügen… (Enter)"
					aria-label="Tag hinzufügen"
					class="w-full border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-1.5 text-sm text-[var(--color-text)]"
				/>
			</div>
			{#if notePreviewMode}
				<div
					class="max-h-[40vh] min-h-[6rem] overflow-y-auto border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] [&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-semibold [&_p]:mb-2 [&_strong]:font-semibold [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5"
				>
					{@html noteDraftHtml}
				</div>
			{:else}
				<textarea
					bind:value={noteDraft}
					rows="4"
					placeholder="Notiz hinzufügen…"
					class="w-full resize-none border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
				></textarea>
			{/if}
			<div class="mt-3 flex items-center gap-2">
				<button
					onclick={saveNote}
					disabled={!noteDirty || savingNote}
					class="flex-1 bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--color-bg)] transition disabled:opacity-40"
				>
					{savingNote ? 'Speichert…' : 'Speichern'}
				</button>
				{#if noteJustSaved}
					<span
						transition:fade={{ duration: 200 }}
						class="flex items-center gap-1 text-sm text-[var(--color-neutral-700)]"
					>
						<Check size={16} /> Gespeichert
					</span>
				{/if}
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
				<div class="flex items-center gap-3">
					{#if aiResult.kind === 'translate' && !aiResult.loading && !aiResult.error}
						<button
							onclick={rememberAsVocab}
							aria-label="Als Vokabel merken"
							title="Als Vokabel merken"
							class="text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)]"
						>
							<BookmarkPlus size={20} />
						</button>
					{/if}
					<button onclick={() => (aiResult = null)} aria-label="Schließen" class="text-[var(--color-accent-700)]">
						<X size={20} />
					</button>
				</div>
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

	{#if chat}
		<button
			aria-label="Chat schließen"
			onclick={closeChat}
			class="absolute inset-0 z-20 bg-black/40"
		></button>
		<section
			class="absolute inset-x-0 bottom-0 z-30 flex max-h-[85vh] flex-col border-t-2 border-[var(--color-divider)] bg-[var(--color-bg)] px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
		>
			<div class="mb-2 flex flex-none items-center justify-between">
				<span class="font-[var(--font-heading)] text-sm font-extrabold tracking-tight">
					{chat.kind === 'context' ? 'Chat zur Textstelle' : 'Chat zum Buch'}{#if chat.sessionCostUsd > 0}<span
							class="ml-1 text-xs font-normal text-[var(--color-neutral-700)]"
							>(≈ {formatUsd(chat.sessionCostUsd)})</span
						>{/if}
				</span>
				<div class="flex items-center gap-3">
					{#if chat.kind === 'book' && chat.messages.length > 0}
						<button
							onclick={clearBookChat}
							disabled={chat.loading}
							class="text-xs text-[var(--color-neutral-700)] underline disabled:opacity-45"
						>
							Leeren
						</button>
					{/if}
					<button onclick={closeChat} aria-label="Schließen" class="text-[var(--color-accent-700)]">
						<X size={20} />
					</button>
				</div>
			</div>

			{#if chat.selectionExcerpt}
				<blockquote
					class="mb-2 flex-none border-l-2 border-[var(--color-divider)] pl-2 text-xs text-[var(--color-neutral-700)]"
				>
					<p class="line-clamp-3">„{chat.selectionExcerpt}“</p>
				</blockquote>
			{/if}

			<div class="min-h-0 flex-1 space-y-2 overflow-y-auto py-1">
				{#if chat.messages.length === 0 && !chat.loading}
					<p class="text-sm text-[var(--color-neutral-700)]">
						{chat.kind === 'context'
							? 'Stelle eine Frage zu dieser Textstelle.'
							: 'Stelle eine Frage zum Buch.'}
					</p>
				{/if}
				{#each chat.messages as m, i (i)}
					<div class="flex {m.role === 'user' ? 'justify-end' : 'justify-start'}">
						{#if m.role === 'assistant'}
							<div
								class="max-w-[85%] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] [&_p]:mb-1 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
							>
								{@html chatMessageHtml(m.content)}
							</div>
						{:else}
							<div class="max-w-[85%] bg-[var(--color-accent)] px-3 py-2 text-sm text-[var(--color-bg)]">
								{m.content}
							</div>
						{/if}
					</div>
				{/each}
				{#if chat.loading}
					<p class="text-sm text-[var(--color-neutral-700)]">Einen Moment…</p>
				{/if}
			</div>

			{#if chat.dossierUsed === false}
				<p class="flex-none pt-1 text-xs text-[var(--color-neutral-700)] italic">
					{chat.kind === 'context'
						? 'Ohne Dossier — Antworten stützen sich nur auf die Textstelle und ihre Umgebung.'
						: 'Ohne Dossier — bekannt ist nur die Gliederung des Buchs.'}
				</p>
			{/if}

			{#if chat.error}
				<p class="mt-1 flex-none bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">
					{chat.error}
				</p>
			{/if}

			<form
				onsubmit={(e) => {
					e.preventDefault();
					void sendChatMessage();
				}}
				class="mt-2 flex flex-none items-end gap-2"
			>
				<textarea
					bind:this={chatInputEl}
					bind:value={chat.input}
					rows="1"
					placeholder="Frage stellen… (Umschalt+Enter für neue Zeile)"
					disabled={chat.loading}
					oninput={autoGrowChatInput}
					onkeydown={(e) => {
						// Enter sends; Shift+Enter inserts a newline (multi-line prompts).
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							if (chat && !chat.loading && chat.input.trim()) void sendChatMessage();
						}
					}}
					class="min-h-[2.5rem] min-w-0 flex-1 resize-none overflow-y-auto border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
				></textarea>
				<button
					type="submit"
					disabled={chat.loading || !chat.input.trim()}
					aria-label="Senden"
					class="flex-none bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-bg)] disabled:opacity-45"
				>
					Senden
				</button>
			</form>
		</section>
	{/if}
</div>
</div>

<style>
	/* Page-turn cue (see triggerPageTurn) - a bar sweeping the full height of
	   the reading pane, not a page-curl/flip simulation. */
	.page-turn-sweep {
		position: absolute;
		inset: 0 auto 0 0;
		width: 3px;
		background: var(--color-accent);
		box-shadow: 0 0 12px 2px var(--color-accent);
		opacity: 0.7;
		pointer-events: none;
		z-index: 15;
	}
	.page-turn-sweep.next {
		animation: page-turn-sweep-rtl 320ms ease-in-out;
	}
	.page-turn-sweep.prev {
		animation: page-turn-sweep-ltr 320ms ease-in-out;
	}
	@keyframes page-turn-sweep-rtl {
		from {
			left: 100%;
		}
		to {
			left: 0%;
		}
	}
	@keyframes page-turn-sweep-ltr {
		from {
			left: 0%;
		}
		to {
			left: 100%;
		}
	}
</style>
