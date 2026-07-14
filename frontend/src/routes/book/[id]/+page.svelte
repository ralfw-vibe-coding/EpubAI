<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { BookDetail } from '../../../domain/types';
	import { getProcessor, isAuthenticated } from '../../../portal/runtime';

	const bookId = $derived($page.params.id ?? '');

	let detail = $state<BookDetail | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let borrowing = $state(false);

	// Edit flow: view -> edit (title/author/tags) -> save.
	let editing = $state(false);
	let saving = $state(false);
	let titleDraft = $state('');
	let authorDraft = $state('');
	let tagsDraft = $state<string[]>([]);
	let tagInput = $state('');

	// Delete flow: two-step confirmation.
	let confirmingDelete = $state(false);
	let deleting = $state(false);

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
		} catch (e) {
			error = e instanceof Error ? e.message : 'Buch konnte nicht geladen werden.';
		} finally {
			loading = false;
		}
	}

	async function borrow() {
		if (borrowing) return;
		borrowing = true;
		error = null;
		try {
			await getProcessor().borrowBook(bookId);
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Ausleihen fehlgeschlagen.';
		} finally {
			borrowing = false;
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
	}

	function cancelEdit() {
		editing = false;
		tagInput = '';
	}

	function addTagFromInput() {
		const tag = tagInput.trim();
		if (tag && !tagsDraft.includes(tag)) {
			tagsDraft = [...tagsDraft, tag];
		}
		tagInput = '';
	}

	function removeTag(tag: string) {
		tagsDraft = tagsDraft.filter((t) => t !== tag);
	}

	function onTagKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addTagFromInput();
		}
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
			<div
				class="flex h-40 w-28 flex-none items-center justify-center bg-[var(--color-accent)] text-3xl font-extrabold text-[var(--color-bg)]"
			>
				{detail.title.slice(0, 1).toUpperCase()}
			</div>
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
								placeholder="Tag eingeben, Enter zum Hinzufügen"
								class="border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2"
							/>
						</div>
					</div>
				{:else}
					<h1 class="font-[var(--font-heading)] text-2xl font-extrabold tracking-tight">{detail.title}</h1>
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
				{/if}
			</div>
		</div>

		<div class="mt-6">
			{#if editing}
				<div class="flex gap-3">
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
			{:else}
				<button
					onclick={startEdit}
					class="border border-[var(--color-divider)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-semibold transition hover:border-[var(--color-accent)]"
				>
					Bearbeiten
				</button>
			{/if}
		</div>

		{#if !editing}
			<div class="mt-8">
				{#if detail.isLocal}
					<button
						onclick={() => goto(`/read/${bookId}`)}
						class="w-full bg-[var(--color-accent)] px-4 py-3 text-left font-semibold text-[var(--color-bg)]"
					>
						Lesen →
					</button>
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
