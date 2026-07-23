<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		Pencil,
		Trash2,
		Upload,
		Archive,
		ArchiveRestore,
		Download,
		Highlighter,
		StickyNote,
		BookOpenText,
		Sparkles,
		Eye,
		X
	} from 'lucide-svelte';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import type { Annotation, BookDetail } from '../../../domain/types';
	import { getProcessor, isAuthenticated } from '../../../portal/runtime';
	import BookMetaFields from '$lib/BookMetaFields.svelte';
	import { colorHex } from '../../read/[id]/colors';
	import { filterAnnotations } from './filterAnnotations';

	const bookId = $derived($page.params.id ?? '');

	let detail = $state<BookDetail | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let borrowing = $state(false);
	let returning = $state(false);

	// Edit flow: view -> edit (title/author/tags) -> save. The editable fields
	// (incl. the tag autocomplete) live in the shared BookMetaFields component.
	let editing = $state(false);
	let saving = $state(false);
	let titleDraft = $state('');
	let authorDraft = $state('');
	let tagsDraft = $state<string[]>([]);

	// Delete flow: the trash icon itself morphs into a "?" confirm button on
	// first click; clicking it again actually deletes, clicking anywhere else
	// reverts it back to the trash icon (no separate confirm row/dialog).
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteButtonEl = $state<HTMLButtonElement | undefined>(undefined);

	$effect(() => {
		if (!confirmingDelete) return;
		function onWindowClick(e: MouseEvent) {
			if (deleteButtonEl && !deleteButtonEl.contains(e.target as Node)) {
				confirmingDelete = false;
			}
		}
		// Deferred by a tick so the very click that just set confirmingDelete
		// (the initial trash-icon click, still bubbling to window) can't
		// immediately revert it again.
		const timer = setTimeout(() => window.addEventListener('click', onWindowClick));
		return () => {
			clearTimeout(timer);
			window.removeEventListener('click', onWindowClick);
		};
	});

	// The cover image falls back to the color-swatch display if it fails to
	// load (broken/expired URL) instead of showing a broken-image icon.
	let coverBroken = $state(false);

	// Dossier (optional background knowledge for the book chat, §4.6/chat):
	// upload reads the chosen .txt/.md file as text client-side and hands it to
	// uploadDossier as-is; the input itself is hidden, triggered via the button.
	let dossierInput = $state<HTMLInputElement | undefined>(undefined);
	let dossierBusy = $state(false);
	let dossierError = $state<string | null>(null);

	// Dossier generation: a rough cost estimate is fetched once, non-blocking,
	// alongside the main load (never lets an estimate hiccup block the page).
	// Spends real money, so it gets the same tap-to-arm/tap-to-confirm morph
	// as the delete button, rather than firing on a single click.
	let dossierEstimateUsd = $state<number | null>(null);
	let confirmingGenerate = $state(false);
	let generating = $state(false);
	let generateButtonEl = $state<HTMLButtonElement | undefined>(undefined);

	// Dossier viewer: a bottom-sheet overlay (same pattern as the reader's AI
	// result/chat sheets) fetching the full text on demand rather than as part
	// of the main page load, since most visits never open it.
	let dossierOverlayOpen = $state(false);
	let dossierText = $state<string | null>(null);
	let dossierTextLoading = $state(false);
	let dossierTextError = $state<string | null>(null);
	let dossierHtml = $derived(dossierText ? DOMPurify.sanitize(marked.parse(dossierText, { async: false })) : '');

	$effect(() => {
		if (!confirmingGenerate) return;
		function onWindowClick(e: MouseEvent) {
			if (generateButtonEl && !generateButtonEl.contains(e.target as Node)) {
				confirmingGenerate = false;
			}
		}
		const timer = setTimeout(() => window.addEventListener('click', onWindowClick));
		return () => {
			clearTimeout(timer);
			window.removeEventListener('click', onWindowClick);
		};
	});

	// Archive toggle: mirrors the delete button's placement/style, no confirm
	// step needed since it is fully reversible.
	let archiveBusy = $state(false);

	// Notizen (annotations) export/import: export triggers a pure client-side
	// Blob download (no server involvement beyond the GET); import reads the
	// chosen file as text, JSON.parse's it, and hands the parsed object to
	// importAnnotations as-is (Vertrag: backend does all validation).
	let notesInput = $state<HTMLInputElement | undefined>(undefined);
	let notesBusy = $state(false);
	let notesError = $state<string | null>(null);
	let notesResult = $state<string | null>(null);

	// Markierungen & Notizen (§5b): read-only list of this book's locally
	// cached annotations, loaded from the OPFS cache only (no network) -
	// meaningful only while the book is borrowed (isLocal), since that's the
	// only time the local cache is guaranteed to hold this book's rows.
	let annotations = $state<Annotation[]>([]);
	let annotationsQuery = $state('');
	let annotationsPage = $state(1);
	let expandedAnnotationId = $state<string | null>(null);
	const ANNOTATIONS_PAGE_SIZE = 10;

	let filteredAnnotations = $derived(filterAnnotations(annotations, annotationsQuery));
	let annotationsPageCount = $derived(
		Math.max(1, Math.ceil(filteredAnnotations.length / ANNOTATIONS_PAGE_SIZE))
	);
	let pagedAnnotations = $derived(
		filteredAnnotations.slice(
			(annotationsPage - 1) * ANNOTATIONS_PAGE_SIZE,
			annotationsPage * ANNOTATIONS_PAGE_SIZE
		)
	);

	$effect(() => {
		annotationsQuery;
		annotationsPage = 1;
	});

	function formatAnnotationDate(iso: string): string {
		return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
	}

	function toggleAnnotationExpanded(id: string) {
		expandedAnnotationId = expandedAnnotationId === id ? null : id;
	}

	function openAnnotationInBook(a: Annotation) {
		goto(`/read/${bookId}?cfi=${encodeURIComponent(a.cfiRange)}`);
	}

	// Backend error codes (machine strings via HttpError.message) mapped to
	// clear German copy, same pattern as BORROW_ERROR_MESSAGES below.
	const IMPORT_ERROR_MESSAGES: Record<string, string> = {
		hash_mismatch: 'Diese Notizen passen nicht zu diesem Buch.',
		invalid_input: 'Ungültige Datei.',
		too_many_annotations: 'Diese Datei enthält zu viele Notizen.'
	};

	const ARCHIVE_ERROR_MESSAGES: Record<string, string> = {
		book_on_loan: 'Das Buch muss erst zurückgegeben werden, bevor es archiviert werden kann.'
	};

	const GENERATE_ERROR_MESSAGES: Record<string, string> = {
		text_missing: 'Für dieses Buch konnte kein Text extrahiert werden, ein Dossier kann nicht generiert werden.',
		generation_failed: 'Dossier-Generierung ist fehlgeschlagen. Bitte später erneut versuchen.'
	};

	onMount(async () => {
		if (!isAuthenticated()) {
			await goto('/login', { replaceState: true });
			return;
		}
		await load();
	});

	async function load() {
		loading = true;
		error = null;
		try {
			detail = await getProcessor().openBookDetail(bookId);
			coverBroken = false;
			// loadAnnotations returns them oldest-first (the local cache's storage
			// order); the list here shows newest first, so reverse for display only.
			annotations = detail.isLocal ? (await getProcessor().loadAnnotations(bookId)).slice().reverse() : [];
			if (detail.processingStatus === 'ready') {
				// Fire-and-forget: a failed/slow estimate must never block the page,
				// and just leaves the cost figure off the "Generieren" button.
				getProcessor()
					.estimateDossierCost(bookId)
					.then((res) => {
						dossierEstimateUsd = res.estimatedUsd;
					})
					.catch(() => {
						dossierEstimateUsd = null;
					});
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Buch konnte nicht geladen werden.';
		} finally {
			loading = false;
		}
	}

	// Backend errors arrive as short machine codes - map the ones borrow()
	// can produce to clear German copy so a failure reads as an actual
	// message, not a stray technical string (matches routes/login/+page.svelte).
	const BORROW_ERROR_MESSAGES: Record<string, string> = {
		file_missing: 'Die Buchdatei fehlt im Speicher und kann nicht geladen werden. Bitte das Buch neu hochladen.'
	};

	async function borrow() {
		if (borrowing || !detail) return;
		borrowing = true;
		error = null;
		try {
			await getProcessor().borrowBook(bookId, detail.title);
			await load();
		} catch (e) {
			const code = e instanceof Error ? e.message : '';
			error = BORROW_ERROR_MESSAGES[code] ?? 'Ausleihen fehlgeschlagen.';
		} finally {
			borrowing = false;
		}
	}

	async function returnBook() {
		if (returning) return;
		returning = true;
		error = null;
		try {
			await getProcessor().returnLoan(bookId);
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Zurückgeben fehlgeschlagen.';
		} finally {
			returning = false;
		}
	}

	function pickDossierFile() {
		dossierError = null;
		dossierInput?.click();
	}

	/** Rough USD figure for the KI-cost read-out — cents, German decimal comma, small floor. */
	function formatUsd(amount: number): string {
		if (amount < 0.005) return '$0,00';
		return '$' + amount.toFixed(2).replace('.', ',');
	}

	async function onDossierFileChosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow re-choosing the same file name after an error
		if (!file || dossierBusy) return;
		dossierBusy = true;
		dossierError = null;
		try {
			const text = await file.text();
			const updated = await getProcessor().uploadDossier(bookId, text);
			// uploadDossier returns a CatalogBook (no isLocal) — merge onto the
			// existing BookDetail rather than replacing it outright.
			if (detail) detail = { ...detail, ...updated };
		} catch (e) {
			dossierError = e instanceof Error ? e.message : 'Dossier konnte nicht hochgeladen werden.';
		} finally {
			dossierBusy = false;
		}
	}

	async function deleteDossier() {
		if (dossierBusy) return;
		dossierBusy = true;
		dossierError = null;
		try {
			await getProcessor().deleteDossier(bookId);
			if (detail) detail = { ...detail, hasDossier: false };
		} catch (e) {
			dossierError = e instanceof Error ? e.message : 'Dossier konnte nicht gelöscht werden.';
		} finally {
			dossierBusy = false;
		}
	}

	async function openDossierOverlay() {
		dossierOverlayOpen = true;
		dossierTextLoading = true;
		dossierTextError = null;
		try {
			const res = await getProcessor().getDossier(bookId);
			dossierText = res.text;
		} catch (e) {
			dossierTextError = e instanceof Error ? e.message : 'Dossier konnte nicht geladen werden.';
		} finally {
			dossierTextLoading = false;
		}
	}

	function closeDossierOverlay() {
		dossierOverlayOpen = false;
		dossierText = null;
		dossierTextError = null;
	}

	function onGenerateClick(e: MouseEvent) {
		e.stopPropagation();
		if (confirmingGenerate) void confirmGenerate();
		else {
			confirmingGenerate = true;
			dossierError = null;
		}
	}

	async function confirmGenerate() {
		if (generating) return;
		generating = true;
		dossierError = null;
		try {
			const updated = await getProcessor().generateDossier(bookId);
			if (detail) detail = { ...detail, ...updated };
		} catch (e) {
			const code = e instanceof Error ? e.message : '';
			dossierError = GENERATE_ERROR_MESSAGES[code] ?? 'Dossier konnte nicht generiert werden.';
		} finally {
			generating = false;
			confirmingGenerate = false;
		}
	}

	async function toggleArchive() {
		if (archiveBusy || !detail) return;
		archiveBusy = true;
		error = null;
		try {
			const updated = detail.archived
				? await getProcessor().unarchiveBook(bookId)
				: await getProcessor().archiveBook(bookId);
			if (detail) detail = { ...detail, ...updated };
		} catch (e) {
			const code = e instanceof Error ? e.message : '';
			error = ARCHIVE_ERROR_MESSAGES[code] ?? 'Archivieren fehlgeschlagen.';
		} finally {
			archiveBusy = false;
		}
	}

	async function exportNotes() {
		if (notesBusy || !detail) return;
		notesBusy = true;
		notesError = null;
		notesResult = null;
		try {
			const payload = await getProcessor().exportAnnotations(bookId);
			const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${detail.originalFilename ?? detail.title} - notes.json`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			notesError = e instanceof Error ? e.message : 'Notizen konnten nicht exportiert werden.';
		} finally {
			notesBusy = false;
		}
	}

	function pickNotesFile() {
		notesError = null;
		notesResult = null;
		notesInput?.click();
	}

	async function onNotesFileChosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow re-choosing the same file name after an error
		if (!file || notesBusy) return;
		notesBusy = true;
		notesError = null;
		notesResult = null;
		try {
			const text = await file.text();
			let payload: unknown;
			try {
				payload = JSON.parse(text);
			} catch {
				notesError = 'Ungültige Datei.';
				return;
			}
			const res = await getProcessor().importAnnotations(bookId, payload);
			notesResult =
				res.imported === 0 && res.skipped > 0
					? 'Alle Notizen aus dieser Datei sind bereits vorhanden – nichts Neues zu importieren.'
					: `${res.imported} Notizen importiert, ${res.skipped} übersprungen`;
		} catch (e) {
			const code = e instanceof Error ? e.message : '';
			notesError = IMPORT_ERROR_MESSAGES[code] ?? 'Notizen konnten nicht importiert werden.';
		} finally {
			notesBusy = false;
		}
	}

	function startEdit() {
		if (!detail) return;
		titleDraft = detail.title;
		authorDraft = detail.author;
		tagsDraft = [...detail.tags];
		error = null;
		editing = true;
	}

	function cancelEdit() {
		editing = false;
	}

	async function save() {
		if (saving) return;
		saving = true;
		error = null;
		try {
			await getProcessor().updateBookMetadata(bookId, {
				title: titleDraft.trim(),
				author: authorDraft.trim(),
				tags: tagsDraft
			});
			editing = false;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Speichern fehlgeschlagen.';
		} finally {
			saving = false;
		}
	}

	function askDelete() {
		confirmingDelete = true;
		error = null;
	}

	function onDeleteIconClick(e: MouseEvent) {
		// Stop this click from reaching the window listener above, which would
		// otherwise immediately revert the just-armed "?" back to the trash icon.
		e.stopPropagation();
		if (confirmingDelete) void confirmDelete();
		else askDelete();
	}

	async function confirmDelete() {
		if (deleting) return;
		deleting = true;
		error = null;
		try {
			await getProcessor().deleteBook(bookId);
			await goto('/library');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Löschen fehlgeschlagen.';
			deleting = false;
			confirmingDelete = false;
		}
	}
</script>

<header class="flex items-center gap-3 border-b-2 border-[var(--color-divider)] px-5 py-4">
	<button onclick={() => goto('/library')} class="text-[var(--color-accent-700)]">← Bibliothek</button>
</header>

<main class="mx-auto max-w-2xl px-5 py-8">
	{#if loading}
		<p class="text-[var(--color-neutral-700)]">Lädt…</p>
	{:else if error && !detail}
		<p class="bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">{error}</p>
	{:else if detail}
		<div class="flex gap-5">
			{#if detail.coverUrl && !coverBroken}
				<img
					src={detail.coverUrl}
					alt=""
					class="h-40 w-28 flex-none border border-[var(--color-divider)] object-cover"
					onerror={() => (coverBroken = true)}
				/>
			{:else}
				<div
					class="flex h-40 w-28 flex-none items-center justify-center bg-[var(--color-accent)] text-3xl font-extrabold text-[var(--color-bg)]"
				>
					{detail.title.slice(0, 1).toUpperCase()}
				</div>
			{/if}
			<div class="min-w-0 flex-1">
				{#if editing}
					<div class="flex flex-col gap-3">
						<BookMetaFields
							bind:title={titleDraft}
							bind:author={authorDraft}
							bind:tags={tagsDraft}
						/>
					</div>
				{:else}
					<div class="flex items-center gap-2">
						<h1 class="font-[var(--font-heading)] text-2xl font-extrabold tracking-tight">{detail.title}</h1>
						<button
							onclick={startEdit}
							aria-label="Metadaten bearbeiten"
							class="text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)]"
						>
							<Pencil size={18} />
						</button>
						<button
							bind:this={deleteButtonEl}
							onclick={onDeleteIconClick}
							disabled={deleting}
							aria-label={confirmingDelete
								? 'Wirklich löschen? Antippen zum Bestätigen'
								: 'Buch löschen'}
							class="flex h-[18px] w-[18px] flex-none items-center justify-center text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)] disabled:opacity-45"
						>
							{#if confirmingDelete}
								<span class="text-sm leading-none font-bold">?</span>
							{:else}
								<Trash2 size={18} />
							{/if}
						</button>
						<button
							onclick={toggleArchive}
							disabled={archiveBusy}
							aria-label={detail.archived ? 'Buch aktivieren' : 'Buch archivieren'}
							title={detail.archived ? 'Aktivieren' : 'Archivieren'}
							class="flex h-[18px] w-[18px] flex-none items-center justify-center text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)] disabled:opacity-45"
						>
							{#if detail.archived}
								<ArchiveRestore size={18} />
							{:else}
								<Archive size={18} />
							{/if}
						</button>
					</div>
					<p class="mt-1 text-[var(--color-neutral-700)]">{detail.author}</p>
					{#if detail.tags.length > 0}
						<div class="mt-2 flex flex-wrap gap-2">
							{#each detail.tags as tag (tag)}
								<span class="border border-[var(--color-divider)] bg-[var(--color-surface)] px-2 py-1 text-xs">
									{tag}
								</span>
							{/each}
						</div>
					{/if}
					<p class="mt-2 text-xs text-[var(--color-neutral-700)]">
						Status: {detail.isLocal ? 'auf diesem Gerät' : 'nicht ausgeliehen'}
						{#if detail.archived}
							&nbsp;/&nbsp; archiviert
						{/if}
						{#if detail.aiCostUsd > 0}
							&nbsp;/&nbsp; Chats: ≈ {formatUsd(detail.aiCostUsd)}
						{/if}
						{#if detail.dossierCostUsd > 0}
							&nbsp;/&nbsp; Dossier: ≈ {formatUsd(detail.dossierCostUsd)}
						{/if}
					</p>
					<p class="mt-1 flex items-center gap-3 text-xs text-[var(--color-neutral-700)]">
						<span class="flex items-center gap-1" title="Markierungen">
							<Highlighter size={14} />
							{detail.highlightCount}
						</span>
						<span class="flex items-center gap-1" title="Notizen">
							<StickyNote size={14} />
							{detail.noteCount}
						</span>
					</p>
					{#if detail.progress}
						<div class="mt-2 max-w-xs">
							<div class="h-1 w-full bg-[var(--color-neutral-300)]">
								<div class="h-full bg-[var(--color-accent)]" style="width: {detail.progress.percent}%"></div>
							</div>
							<p class="mt-1 text-xs text-[var(--color-neutral-700)]">
								{detail.progress.percent}%{#if detail.progress.page !== null && detail.progress.totalPages !== null}
									&nbsp;· Seite {detail.progress.page} von {detail.progress.totalPages}
								{/if}
							</p>
						</div>
					{/if}
				{/if}
			</div>
		</div>

		{#if editing}
			<div class="mt-6 flex gap-3">
				<button
					onclick={save}
					disabled={saving}
					class="flex-1 bg-[var(--color-accent)] px-4 py-2 text-center font-semibold text-[var(--color-bg)] disabled:opacity-45"
				>
					{saving ? 'Speichert…' : 'Speichern'}
				</button>
				<button
					onclick={cancelEdit}
					disabled={saving}
					class="flex-1 border border-[var(--color-divider)] px-4 py-2 text-center font-semibold"
				>
					Abbrechen
				</button>
			</div>
		{/if}

		{#if !editing}
			<div class="mt-8">
				{#if detail.isLocal}
					<div class="flex flex-col gap-3">
						<button
							onclick={() => goto(`/read/${bookId}`)}
							class="w-full bg-[var(--color-accent)] px-4 py-3 text-left font-semibold text-[var(--color-bg)]"
						>
							Lesen →
						</button>
						<button
							onclick={returnBook}
							disabled={returning}
							class="w-full border border-[var(--color-divider)] px-4 py-3 text-left font-semibold disabled:opacity-45"
						>
							{returning ? 'Wird zurückgegeben…' : 'Zurückgeben'}
						</button>
					</div>
				{:else}
					<button
						onclick={borrow}
						disabled={borrowing}
						class="w-full bg-[var(--color-accent)] px-4 py-3 text-left font-semibold text-[var(--color-bg)] disabled:opacity-45"
					>
						{borrowing ? 'Lade herunter…' : 'Ausleihen'}
					</button>
				{/if}
			</div>
		{/if}

		<div class="mt-8 border-t-2 border-[var(--color-divider)] pt-4">
			<h2 class="font-[var(--font-heading)] text-sm font-extrabold tracking-tight">Dossier</h2>
			<p class="mt-1 text-xs text-[var(--color-neutral-700)]">
				Ein Dossier gibt dem Chat zum Buch Hintergrundwissen zum ganzen Buch mit — optional; ohne
				Dossier stützen sich Antworten nur auf die Textstelle bzw. die Gliederung.
			</p>
			<input
				bind:this={dossierInput}
				onchange={onDossierFileChosen}
				type="file"
				accept=".txt,.md,text/plain,text/markdown"
				class="hidden"
			/>
			<div class="mt-2 flex items-center gap-2">
				{#if detail.hasDossier}
					<button
						onclick={openDossierOverlay}
						aria-label="Dossier ansehen"
						title="Ansehen"
						class="flex h-8 w-8 items-center justify-center border border-[var(--color-divider)] text-[var(--color-text)]"
					>
						<Eye size={16} />
					</button>
					<button
						onclick={pickDossierFile}
						disabled={dossierBusy}
						aria-label="Dossier ersetzen"
						title="Ersetzen"
						class="flex h-8 w-8 items-center justify-center border border-[var(--color-divider)] text-[var(--color-text)] disabled:opacity-45"
					>
						<Upload size={16} />
					</button>
					<button
						onclick={deleteDossier}
						disabled={dossierBusy}
						aria-label="Dossier löschen"
						title="Löschen"
						class="flex h-8 w-8 items-center justify-center border border-[var(--color-divider)] text-[var(--color-accent-700)] disabled:opacity-45"
					>
						<Trash2 size={16} />
					</button>
				{:else}
					<button
						onclick={pickDossierFile}
						disabled={dossierBusy}
						aria-label="Dossier hochladen"
						title={dossierBusy ? 'Wird hochgeladen…' : 'Dossier hochladen'}
						class="flex h-8 w-8 items-center justify-center border border-[var(--color-divider)] text-[var(--color-text)] disabled:opacity-45"
					>
						<Upload size={16} />
					</button>
				{/if}
				<button
					bind:this={generateButtonEl}
					onclick={onGenerateClick}
					disabled={generating}
					aria-label={detail.hasDossier ? 'Dossier neu generieren' : 'Dossier generieren'}
					title={detail.hasDossier ? 'Neu generieren' : 'Generieren'}
					class="flex h-8 items-center gap-1.5 border border-[var(--color-divider)] px-2 text-sm text-[var(--color-text)] disabled:opacity-45"
				>
					<Sparkles size={16} />
					{#if generating}
						…
					{:else if confirmingGenerate}
						{dossierEstimateUsd !== null ? `Sicher? ${formatUsd(dossierEstimateUsd)}` : 'Sicher?'}
					{:else if dossierEstimateUsd !== null}
						{formatUsd(dossierEstimateUsd)}
					{/if}
				</button>
			</div>
			{#if dossierError}
				<p class="mt-2 bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">
					{dossierError}
				</p>
			{/if}
		</div>

		{#if dossierOverlayOpen}
			<button
				aria-label="Dossier schließen"
				onclick={closeDossierOverlay}
				class="fixed inset-0 z-20 bg-black/40"
			></button>
			<section
				class="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-h-[85vh] max-w-2xl flex-col border-t-2 border-[var(--color-divider)] bg-[var(--color-bg)] px-5 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
			>
				<div class="mb-2 flex items-center justify-between">
					<span class="text-sm font-semibold">Dossier</span>
					<button onclick={closeDossierOverlay} aria-label="Schließen" class="text-[var(--color-accent-700)]">
						<X size={20} />
					</button>
				</div>
				{#if dossierTextLoading}
					<p class="py-4 text-center text-sm text-[var(--color-neutral-700)]">Lädt…</p>
				{:else if dossierTextError}
					<p class="bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">
						{dossierTextError}
					</p>
				{:else}
					<div
						class="overflow-y-auto text-sm text-[var(--color-text)] [&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-semibold [&_p]:mb-2 [&_strong]:font-semibold [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5"
					>
						{@html dossierHtml}
					</div>
				{/if}
			</section>
		{/if}

		<div class="mt-8 border-t-2 border-[var(--color-divider)] pt-4">
			<h2 class="font-[var(--font-heading)] text-sm font-extrabold tracking-tight">Notizen</h2>
			<p class="mt-1 text-xs text-[var(--color-neutral-700)]">
				Markierungen und Notizen zu diesem Buch als Datei sichern oder aus einer zuvor exportierten
				Datei wiederherstellen.
			</p>
			<input
				bind:this={notesInput}
				onchange={onNotesFileChosen}
				type="file"
				accept=".json,application/json"
				class="hidden"
			/>
			<div class="mt-2 flex items-center gap-3">
				<button
					onclick={exportNotes}
					disabled={notesBusy}
					class="flex items-center gap-1.5 border border-[var(--color-divider)] px-3 py-1.5 text-sm text-[var(--color-text)] disabled:opacity-45"
				>
					<Download size={16} /> Exportieren
				</button>
				<button
					onclick={pickNotesFile}
					disabled={notesBusy}
					class="flex items-center gap-1.5 border border-[var(--color-divider)] px-3 py-1.5 text-sm text-[var(--color-text)] disabled:opacity-45"
				>
					<Upload size={16} /> {notesBusy ? 'Wird verarbeitet…' : 'Importieren'}
				</button>
			</div>
			{#if notesResult}
				<p class="mt-2 text-sm text-[var(--color-neutral-700)]">{notesResult}</p>
			{/if}
			{#if notesError}
				<p class="mt-2 bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">
					{notesError}
				</p>
			{/if}
		</div>

		{#if detail.isLocal}
			<div class="mt-8 border-t-2 border-[var(--color-divider)] pt-4">
				<h2 class="font-[var(--font-heading)] text-sm font-extrabold tracking-tight">
					Markierungen &amp; Notizen
				</h2>

				{#if annotations.length === 0}
					<p class="mt-2 text-sm text-[var(--color-neutral-700)]">
						Noch keine Markierungen oder Notizen in diesem Buch.
					</p>
				{:else}
					<input
						type="search"
						bind:value={annotationsQuery}
						placeholder="Suche in Markierungen/Notizen…"
						aria-label="Suche in Markierungen/Notizen"
						class="mt-2 w-full border border-[var(--color-divider)] bg-[var(--color-surface)] px-3 py-1.5 text-sm sm:max-w-xs"
					/>

					{#if filteredAnnotations.length === 0}
						<p class="mt-3 text-sm text-[var(--color-neutral-700)]">Keine Treffer für diese Suche.</p>
					{:else}
						<ul class="mt-3 flex flex-col gap-2">
							{#each pagedAnnotations as a (a.id)}
								<li class="border border-[var(--color-divider)] bg-[var(--color-surface)]">
									<button
										onclick={() => toggleAnnotationExpanded(a.id)}
										class="flex w-full items-start gap-2 px-3 py-2 text-left text-sm"
									>
										<span
											class="mt-1 h-2.5 w-2.5 flex-none rounded-full"
											style="background-color: {colorHex(a.color)}"
										></span>
										{#if a.note === null}
											<Highlighter size={14} class="mt-0.5 flex-none text-[var(--color-neutral-700)]" />
										{:else}
											<StickyNote size={14} class="mt-0.5 flex-none text-[var(--color-neutral-700)]" />
										{/if}
										<span class="min-w-0 flex-1">
											<span class="block truncate">{a.excerpt}</span>
											{#if a.note}
												<span class="block truncate text-xs text-[var(--color-neutral-700)] italic">
													{a.note}
												</span>
											{/if}
										</span>
									</button>
									{#if expandedAnnotationId === a.id}
										<div class="flex flex-col gap-2 border-t border-[var(--color-divider)] px-3 py-2 text-sm">
											<p>{a.excerpt}</p>
											{#if a.note}
												<p class="whitespace-pre-wrap text-[var(--color-neutral-700)]">{a.note}</p>
											{/if}
											<div class="flex items-center justify-between">
												<p class="text-xs text-[var(--color-neutral-700)]">
													{formatAnnotationDate(a.createdAt)}
												</p>
												<button
													onclick={() => openAnnotationInBook(a)}
													aria-label="Im Buch öffnen"
													class="flex items-center text-[var(--color-accent-700)] transition hover:text-[var(--color-accent-800)]"
												>
													<BookOpenText size={16} />
												</button>
											</div>
										</div>
									{/if}
								</li>
							{/each}
						</ul>

						{#if annotationsPageCount > 1}
							<div class="mt-3 flex items-center justify-between">
								<button
									onclick={() => (annotationsPage = Math.max(1, annotationsPage - 1))}
									disabled={annotationsPage <= 1}
									class="border border-[var(--color-divider)] px-3 py-1 text-sm disabled:opacity-45"
								>
									Zurück
								</button>
								<p class="text-xs text-[var(--color-neutral-700)]">
									Seite {annotationsPage} von {annotationsPageCount}
								</p>
								<button
									onclick={() => (annotationsPage = Math.min(annotationsPageCount, annotationsPage + 1))}
									disabled={annotationsPage >= annotationsPageCount}
									class="border border-[var(--color-divider)] px-3 py-1 text-sm disabled:opacity-45"
								>
									Weiter
								</button>
							</div>
						{/if}
					{/if}
				{/if}
			</div>
		{/if}

		{#if error}
			<p class="mt-4 bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">{error}</p>
		{/if}
	{/if}
</main>
