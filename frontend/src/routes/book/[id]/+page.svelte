<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { Pencil, Trash2, Upload, FileText } from 'lucide-svelte';
	import type { BookDetail } from '../../../domain/types';
	import { getProcessor, isAuthenticated } from '../../../portal/runtime';
	import BookMetaFields from '$lib/BookMetaFields.svelte';

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
			<div class="mt-2 flex items-center gap-3">
				{#if detail.hasDossier}
					<span class="flex items-center gap-1.5 text-sm text-[var(--color-text)]">
						<FileText size={16} /> Dossier vorhanden
					</span>
					<button
						onclick={deleteDossier}
						disabled={dossierBusy}
						class="flex items-center gap-1.5 border border-[var(--color-divider)] px-3 py-1.5 text-sm text-[var(--color-accent-700)] disabled:opacity-45"
					>
						<Trash2 size={16} /> Löschen
					</button>
					<button
						onclick={pickDossierFile}
						disabled={dossierBusy}
						class="flex items-center gap-1.5 border border-[var(--color-divider)] px-3 py-1.5 text-sm text-[var(--color-text)] disabled:opacity-45"
					>
						<Upload size={16} /> Ersetzen
					</button>
				{:else}
					<button
						onclick={pickDossierFile}
						disabled={dossierBusy}
						class="flex items-center gap-1.5 border border-[var(--color-divider)] px-3 py-1.5 text-sm text-[var(--color-text)] disabled:opacity-45"
					>
						<Upload size={16} /> {dossierBusy ? 'Wird hochgeladen…' : 'Dossier hochladen'}
					</button>
				{/if}
			</div>
			{#if dossierError}
				<p class="mt-2 bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">
					{dossierError}
				</p>
			{/if}

			<p class="mt-4 text-xs text-[var(--color-neutral-700)]">
				KI-Kosten dieses Buchs bisher: ≈ {formatUsd(detail.aiCostUsd)}
				<span class="text-[var(--color-neutral-500)]">(Chats; grobe Richtung)</span>
			</p>
		</div>

		{#if error}
			<p class="mt-4 bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">{error}</p>
		{/if}
	{/if}
</main>
