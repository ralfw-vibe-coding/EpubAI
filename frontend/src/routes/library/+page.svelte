<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { CatalogBook } from '../../domain/types';
	import { getProcessor, isAuthenticated } from '../../portal/runtime';

	let books = $state<CatalogBook[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Upload flow, one phase at a time:
	//   idle -> uploading (progress bar) -> edit (editable title/author, confirm)
	//                                     -> duplicate (link to existing book)
	//                                     -> error
	type UploadPhase = 'idle' | 'uploading' | 'edit' | 'duplicate' | 'error';
	let phase = $state<UploadPhase>('idle');
	let progress = $state(0);
	let uploadError = $state<string | null>(null);
	let editTitle = $state('');
	let editAuthor = $state('');
	let fileHash = $state('');
	let duplicateBookId = $state<string | null>(null);
	let adding = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	onMount(async () => {
		if (!isAuthenticated()) {
			await goto('/login', { replaceState: true });
			return;
		}
		await reload();
	});

	async function reload() {
		loading = true;
		error = null;
		try {
			books = await getProcessor().loadCatalog();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Katalog konnte nicht geladen werden.';
		} finally {
			loading = false;
		}
	}

	async function signOut() {
		await getProcessor().signOut();
		await goto('/login', { replaceState: true });
	}

	// Step 1: "+ Hochladen" goes straight to the native file picker - no
	// intermediate panel to open first (that extra click was confusing).
	function startUpload() {
		if (fileInput) fileInput.value = '';
		fileInput?.click();
	}

	function resetUpload() {
		phase = 'idle';
		progress = 0;
		uploadError = null;
		editTitle = '';
		editAuthor = '';
		fileHash = '';
		duplicateBookId = null;
		if (fileInput) fileInput.value = '';
	}

	// Step 2/3: a file was chosen -> upload it with a real progress readout.
	async function onFileChosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		phase = 'uploading';
		progress = 0;
		uploadError = null;
		try {
			const res = await getProcessor().uploadEpub(file, file.name, (pct) => {
				progress = pct;
			});
			if ('duplicate' in res) {
				duplicateBookId = res.existingBookId;
				phase = 'duplicate';
			} else {
				editTitle = res.detectedMeta.title;
				editAuthor = res.detectedMeta.author;
				fileHash = res.fileHash;
				phase = 'edit';
			}
		} catch (e2) {
			uploadError = e2 instanceof Error ? e2.message : 'Upload fehlgeschlagen.';
			phase = 'error';
		}
	}

	// Step 4: confirm the (possibly corrected) details.
	async function confirmAdd() {
		const title = editTitle.trim();
		const author = editAuthor.trim();
		if (!title || !author || adding) return;
		adding = true;
		uploadError = null;
		try {
			await getProcessor().confirmAddBook(title, author, fileHash);
			resetUpload();
			await reload();
		} catch (e) {
			uploadError = e instanceof Error ? e.message : 'Hinzufügen fehlgeschlagen.';
		} finally {
			adding = false;
		}
	}
</script>

<header
	class="sticky top-0 z-10 flex items-center justify-between border-b-2 border-[var(--color-divider)] bg-[var(--color-bg)]/95 px-5 py-4 backdrop-blur"
>
	<h1 class="font-[var(--font-heading)] text-xl font-extrabold tracking-tight">Bibliothek</h1>
	<div class="flex items-center gap-4">
		<button
			onclick={startUpload}
			class="border border-[var(--color-divider)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-semibold transition hover:border-[var(--color-accent)]"
		>
			+ Hochladen
		</button>
		<button onclick={signOut} class="text-sm text-[var(--color-accent-700)] underline">Abmelden</button>
	</div>
</header>

<!-- Hidden always; the visible "+ Hochladen" button triggers it directly. -->
<input
	bind:this={fileInput}
	type="file"
	accept=".epub"
	onchange={onFileChosen}
	class="hidden"
/>

<main class="mx-auto max-w-2xl px-5 py-6">
	{#if phase !== 'idle'}
		<div class="mb-6 flex flex-col gap-3 border border-[var(--color-divider)] bg-[var(--color-surface)] p-5">
			<div class="flex items-center justify-between">
				<h2 class="font-[var(--font-heading)] text-base font-extrabold">Buch hochladen</h2>
				<button onclick={resetUpload} class="text-sm text-[var(--color-accent-700)] underline">
					Schließen
				</button>
			</div>

			{#if phase === 'uploading'}
				<p class="text-sm text-[var(--color-neutral-700)]">Wird hochgeladen… {progress}%</p>
				<div class="h-1 w-full bg-[var(--color-neutral-300)]">
					<div class="h-full bg-[var(--color-accent)]" style="width: {progress}%"></div>
				</div>
			{:else if phase === 'duplicate'}
				<p class="text-sm text-[var(--color-neutral-700)]">
					Bereits in deiner Bibliothek —
					<a href={`/book/${duplicateBookId}`} class="text-[var(--color-accent-700)] underline">
						zum bestehenden Eintrag
					</a>
				</p>
			{:else if phase === 'edit'}
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-[var(--color-neutral-700)]">Titel</span>
					<input
						bind:value={editTitle}
						class="border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-[var(--color-neutral-700)]">Autor</span>
					<input
						bind:value={editAuthor}
						class="border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2"
					/>
				</label>
				<button
					onclick={confirmAdd}
					disabled={adding || !editTitle.trim() || !editAuthor.trim()}
					class="w-full bg-[var(--color-accent)] px-4 py-3 text-left font-semibold text-[var(--color-bg)] disabled:opacity-45"
				>
					{adding ? 'Wird gespeichert…' : 'Speichern'}
				</button>
			{/if}

			{#if uploadError}
				<p class="bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">
					{uploadError}
				</p>
			{/if}
		</div>
	{/if}

	{#if loading}
		<p class="text-[var(--color-neutral-700)]">Lädt…</p>
	{:else if error}
		<p class="bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">{error}</p>
	{:else if books.length === 0}
		<p class="text-[var(--color-neutral-700)]">Noch keine Bücher im Katalog.</p>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each books as book (book.id)}
				<li>
					<button
						onclick={() => goto(`/book/${book.id}`)}
						class="flex w-full items-center gap-4 border border-[var(--color-divider)] bg-[var(--color-surface)] px-4 py-4 text-left transition hover:border-[var(--color-accent)]"
					>
						<div
							class="flex h-16 w-12 flex-none items-center justify-center bg-[var(--color-accent)] text-lg font-extrabold text-[var(--color-bg)]"
						>
							{book.title.slice(0, 1).toUpperCase()}
						</div>
						<div class="min-w-0">
							<p class="truncate font-medium">{book.title}</p>
							<p class="truncate text-sm text-[var(--color-neutral-700)]">{book.author}</p>
							{#if book.processingStatus !== 'ready'}
								<p class="mt-1 text-xs text-[var(--color-accent-700)]">
									{book.processingStatus === 'failed'
										? 'Verarbeitung fehlgeschlagen'
										: 'wird verarbeitet…'}
								</p>
							{/if}
						</div>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</main>
