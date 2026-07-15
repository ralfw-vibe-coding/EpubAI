<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { Pencil } from 'lucide-svelte';
	import type { BookDetail } from '../../../domain/types';
	import { getProcessor, isAuthenticated } from '../../../portal/runtime';

	const bookId = $derived($page.params.id ?? '');

	let detail = $state<BookDetail | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let borrowing = $state(false);
	let returning = $state(false);

	// Edit flow: view -> edit (title/author/tags) -> save.
	let editing = $state(false);
	let saving = $state(false);
	let titleDraft = $state('');
	let authorDraft = $state('');
	let tagsDraft = $state<string[]>([]);
	let tagInput = $state('');
	let tagInputFocused = $state(false);

	// Tag suggestions: distinct tags across the whole catalog, loaded once
	// (lazily, on first edit / first tag-field focus) and then filtered
	// client-side as the user types.
	let knownTags = $state<string[]>([]);
	let knownTagsLoaded = false;

	// Delete flow: two-step confirmation.
	let confirmingDelete = $state(false);
	let deleting = $state(false);

	// The cover image falls back to the color-swatch display if it fails to
	// load (broken/expired URL) instead of showing a broken-image icon.
	let coverBroken = $state(false);

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

	async function borrow() {
		if (borrowing || !detail) return;
		borrowing = true;
		error = null;
		try {
			await getProcessor().borrowBook(bookId, detail.title);
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Ausleihen fehlgeschlagen.';
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

	function startEdit() {
		if (!detail) return;
		titleDraft = detail.title;
		authorDraft = detail.author;
		tagsDraft = [...detail.tags];
		tagInput = '';
		error = null;
		editing = true;
		loadKnownTags();
	}

	function cancelEdit() {
		editing = false;
		tagInput = '';
	}

	// Distinct tags used anywhere in the user's own catalog, for the
	// autocomplete suggestions below the tag input. Loaded at most once per
	// page visit (idempotent — safe to call again from the input's focus
	// handler).
	async function loadKnownTags() {
		if (knownTagsLoaded) return;
		knownTagsLoaded = true;
		try {
			const catalog = await getProcessor().loadCatalog();
			const distinct = new Set<string>();
			for (const book of catalog) {
				for (const tag of book.tags) distinct.add(tag);
			}
			knownTags = [...distinct];
		} catch {
			// Suggestions are a convenience only; silently skip on failure.
		}
	}

	function addTag(tag: string) {
		const trimmed = tag.trim();
		if (trimmed && !tagsDraft.includes(trimmed)) {
			tagsDraft = [...tagsDraft, trimmed];
		}
		tagInput = '';
	}

	function removeTag(tag: string) {
		tagsDraft = tagsDraft.filter((t) => t !== tag);
	}

	function onTagKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addTag(tagInput);
		}
	}

	function onTagInputFocus() {
		tagInputFocused = true;
		loadKnownTags();
	}

	function onTagInputBlur() {
		// Delay hiding so a click on a suggestion chip registers before the
		// list disappears (blur fires before the chip's click otherwise).
		setTimeout(() => {
			tagInputFocused = false;
		}, 150);
	}

	// Empty query -> the full list of not-yet-assigned known tags (so focusing
	// the field shows everything available); typing narrows it down. No cap -
	// the wrapping container scrolls if the list is long (see markup below).
	const tagSuggestions = $derived.by(() => {
		const query = tagInput.trim().toLowerCase();
		return knownTags.filter(
			(tag) => tag.toLowerCase().includes(query) && !tagsDraft.includes(tag)
		);
	});

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

	function cancelDelete() {
		confirmingDelete = false;
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
						<label class="flex flex-col gap-1 text-sm">
							<span class="text-[var(--color-neutral-700)]">Titel</span>
							<input
								bind:value={titleDraft}
								class="border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2"
							/>
						</label>
						<label class="flex flex-col gap-1 text-sm">
							<span class="text-[var(--color-neutral-700)]">Autor</span>
							<input
								bind:value={authorDraft}
								class="border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2"
							/>
						</label>
						<div class="flex flex-col gap-1 text-sm">
							<span class="text-[var(--color-neutral-700)]">Tags</span>
							<div class="flex flex-wrap gap-2">
								{#each tagsDraft as tag (tag)}
									<span
										class="flex items-center gap-1 border border-[var(--color-divider)] bg-[var(--color-bg)] px-2 py-1 text-xs"
									>
										{tag}
										<button
											onclick={() => removeTag(tag)}
											aria-label={`Tag ${tag} entfernen`}
											class="text-[var(--color-accent-700)]"
										>
											×
										</button>
									</span>
								{/each}
							</div>
							<input
								bind:value={tagInput}
								onkeydown={onTagKeydown}
								onfocus={onTagInputFocus}
								onblur={onTagInputBlur}
								placeholder="Tag eingeben, Enter zum Hinzufügen"
								class="border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2"
							/>
							{#if tagInputFocused}
								{#if tagSuggestions.length > 0}
									<div class="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
										{#each tagSuggestions as suggestion (suggestion)}
											<button
												type="button"
												onclick={() => addTag(suggestion)}
												class="border border-[var(--color-divider)] bg-[var(--color-surface)] px-2 py-1 text-xs transition hover:border-[var(--color-accent)]"
											>
												{suggestion}
											</button>
										{/each}
									</div>
								{:else if tagInput.trim()}
									<p class="text-xs text-[var(--color-neutral-700)]">
										kein Treffer — Enter zum Anlegen von „{tagInput.trim()}“
									</p>
								{/if}
							{/if}
						</div>
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

		{#if error}
			<p class="mt-4 bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">{error}</p>
		{/if}

		<div class="mt-12 border-t border-[var(--color-divider)] pt-6">
			{#if confirmingDelete}
				<div class="flex items-center gap-3">
					<p class="text-sm font-semibold text-[var(--color-accent-800)]">Wirklich entfernen?</p>
					<button
						onclick={confirmDelete}
						disabled={deleting}
						class="bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-[var(--color-bg)] disabled:opacity-45"
					>
						{deleting ? 'Wird entfernt…' : 'Ja, entfernen'}
					</button>
					<button
						onclick={cancelDelete}
						disabled={deleting}
						class="border border-[var(--color-divider)] px-3 py-1.5 text-sm font-semibold"
					>
						Abbrechen
					</button>
				</div>
			{:else}
				<button onclick={askDelete} class="text-sm text-[var(--color-accent-700)] underline">
					Aus Katalog entfernen…
				</button>
			{/if}
		</div>
	{/if}
</main>
