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
	let coverKey = $state<string | undefined>(undefined);
	let coverPreviewUrl = $state<string | undefined>(undefined);
	let coverPreviewBroken = $state(false);
	let duplicateBookId = $state<string | null>(null);
	let adding = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	// Tags for the book being added, same autocomplete pattern as the book-detail
	// edit screen: full list of already-used tags on focus, narrowed while typing.
	let editTagsDraft = $state<string[]>([]);
	let editTagInput = $state('');
	let editTagInputFocused = $state(false);
	let editKnownTags = $state<string[]>([]);
	let editKnownTagsLoaded = false;

	async function loadEditKnownTags() {
		if (editKnownTagsLoaded) return;
		editKnownTagsLoaded = true;
		try {
			const catalog = await getProcessor().loadCatalog();
			const distinct = new Set<string>();
			for (const b of catalog) {
				for (const tag of b.tags) distinct.add(tag);
			}
			editKnownTags = [...distinct];
		} catch {
			// Suggestions are a convenience only; silently skip on failure.
		}
	}

	function addEditTag(tag: string) {
		const trimmed = tag.trim();
		if (trimmed && !editTagsDraft.includes(trimmed)) {
			editTagsDraft = [...editTagsDraft, trimmed];
		}
		editTagInput = '';
	}

	function removeEditTag(tag: string) {
		editTagsDraft = editTagsDraft.filter((t) => t !== tag);
	}

	function onEditTagKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addEditTag(editTagInput);
		}
	}

	function onEditTagInputFocus() {
		editTagInputFocused = true;
		loadEditKnownTags();
	}

	function onEditTagInputBlur() {
		setTimeout(() => {
			editTagInputFocused = false;
		}, 150);
	}

	const editTagSuggestions = $derived.by(() => {
		const query = editTagInput.trim().toLowerCase();
		return editKnownTags.filter(
			(tag) => tag.toLowerCase().includes(query) && !editTagsDraft.includes(tag)
		);
	});

	// Book covers that failed to load fall back to the color-swatch display
	// instead of a broken-image icon (Aufgabe 7).
	let brokenCovers = $state<Set<string>>(new Set());
	function markCoverBroken(bookId: string) {
		brokenCovers = new Set(brokenCovers).add(bookId);
	}

	// Cover/Liste-Umschalter (Segmented Control) - Cover-Ansicht ist Standard.
	let viewMode = $state<'cover' | 'list'>('cover');

	// Tag-Filter: distinct Tags aus allen geladenen Büchern, alphabetisch.
	// Aktive Tags werden ODER-verknüpft (Buch muss mindestens einen tragen).
	let activeTags = $state<Set<string>>(new Set());

	let allTags = $derived(
		Array.from(new Set(books.flatMap((b) => b.tags))).sort((a, b) => a.localeCompare(b, 'de'))
	);
	let filteredBooks = $derived(
		activeTags.size === 0 ? books : books.filter((b) => b.tags.some((t) => activeTags.has(t)))
	);

	function toggleTag(tag: string) {
		const next = new Set(activeTags);
		if (next.has(tag)) {
			next.delete(tag);
		} else {
			next.add(tag);
		}
		activeTags = next;
	}

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
		coverKey = undefined;
		coverPreviewUrl = undefined;
		coverPreviewBroken = false;
		duplicateBookId = null;
		editTagsDraft = [];
		editTagInput = '';
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
				coverKey = res.coverKey;
				coverPreviewUrl = res.coverPreviewUrl;
				coverPreviewBroken = false;
				editTagsDraft = [];
				editTagInput = '';
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
			await getProcessor().confirmAddBook(title, author, fileHash, coverKey, editTagsDraft);
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
				{#if coverPreviewUrl && !coverPreviewBroken}
					<img
						src={coverPreviewUrl}
						alt=""
						class="h-24 w-16 flex-none border border-[var(--color-divider)] object-cover"
						onerror={() => (coverPreviewBroken = true)}
					/>
				{/if}
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
				<div class="flex flex-col gap-1 text-sm">
					<span class="text-[var(--color-neutral-700)]">Tags</span>
					<div class="flex flex-wrap gap-2">
						{#each editTagsDraft as tag (tag)}
							<span
								class="flex items-center gap-1 border border-[var(--color-divider)] bg-[var(--color-bg)] px-2 py-1 text-xs"
							>
								{tag}
								<button
									onclick={() => removeEditTag(tag)}
									aria-label={`Tag ${tag} entfernen`}
									class="text-[var(--color-accent-700)]"
								>
									×
								</button>
							</span>
						{/each}
					</div>
					<input
						bind:value={editTagInput}
						onkeydown={onEditTagKeydown}
						onfocus={onEditTagInputFocus}
						onblur={onEditTagInputBlur}
						placeholder="Tag eingeben, Enter zum Hinzufügen"
						class="border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2"
					/>
					{#if editTagInputFocused}
						{#if editTagSuggestions.length > 0}
							<div class="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
								{#each editTagSuggestions as suggestion (suggestion)}
									<button
										type="button"
										onclick={() => addEditTag(suggestion)}
										class="border border-[var(--color-divider)] bg-[var(--color-surface)] px-2 py-1 text-xs transition hover:border-[var(--color-accent)]"
									>
										{suggestion}
									</button>
								{/each}
							</div>
						{:else if editTagInput.trim()}
							<p class="text-xs text-[var(--color-neutral-700)]">
								kein Treffer — Enter zum Anlegen von „{editTagInput.trim()}“
							</p>
						{/if}
					{/if}
				</div>
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

	{#snippet progressDisplay(book: CatalogBook)}
		{#if book.progress}
			<div class="mt-1.5">
				<div class="h-1 w-full bg-[var(--color-neutral-300)]">
					<div class="h-full bg-[var(--color-accent)]" style="width: {book.progress.percent}%"></div>
				</div>
				<p class="mt-0.5 text-xs text-[var(--color-neutral-700)]">
					{book.progress.percent}%{#if book.progress.page !== null && book.progress.totalPages !== null}
						· Seite {book.progress.page}/{book.progress.totalPages}
					{/if}
				</p>
			</div>
		{/if}
	{/snippet}

	{#if loading}
		<p class="text-[var(--color-neutral-700)]">Lädt…</p>
	{:else if error}
		<p class="bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">{error}</p>
	{:else if books.length === 0}
		<p class="text-[var(--color-neutral-700)]">Noch keine Bücher im Katalog.</p>
	{:else}
		<div class="mb-4 flex items-center justify-between gap-4">
			<h2 class="sr-only">Ansicht</h2>
			<div class="seg flex border border-[var(--color-divider)]">
				<button
					onclick={() => (viewMode = 'cover')}
					class="seg-opt px-4 py-1.5 text-sm font-semibold {viewMode === 'cover'
						? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
						: 'bg-[var(--color-surface)]'}"
				>
					Cover
				</button>
				<button
					onclick={() => (viewMode = 'list')}
					class="seg-opt px-4 py-1.5 text-sm font-semibold {viewMode === 'list'
						? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
						: 'bg-[var(--color-surface)]'}"
				>
					Liste
				</button>
			</div>
		</div>

		{#if allTags.length > 0}
			<div class="mb-4 flex gap-2 overflow-x-auto pb-1">
				{#each allTags as tag (tag)}
					<button
						onclick={() => toggleTag(tag)}
						class="flex-none whitespace-nowrap border border-[var(--color-divider)] px-3 py-1 text-xs font-semibold {activeTags.has(
							tag
						)
							? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
							: 'bg-[var(--color-surface)]'}"
					>
						{tag}
					</button>
				{/each}
			</div>
		{/if}

		{#if filteredBooks.length === 0}
			<p class="text-[var(--color-neutral-700)]">Keine Bücher mit diesen Tags.</p>
		{:else if viewMode === 'cover'}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
				{#each filteredBooks as book (book.id)}
					<button onclick={() => goto(`/book/${book.id}`)} class="flex flex-col text-left">
						{#if book.coverUrl && !brokenCovers.has(book.id)}
							<img
								src={book.coverUrl}
								alt=""
								class="aspect-[2/3] w-full border border-[var(--color-divider)] object-cover"
								onerror={() => markCoverBroken(book.id)}
							/>
						{:else}
							<div
								class="flex aspect-[2/3] w-full items-center justify-center bg-[var(--color-accent)] text-3xl font-extrabold text-[var(--color-bg)]"
							>
								{book.title.slice(0, 1).toUpperCase()}
							</div>
						{/if}
						<p class="mt-2 truncate text-sm font-medium">{book.title}</p>
						<p class="truncate text-xs text-[var(--color-neutral-700)]">{book.author}</p>
						{#if book.tags.length > 0}
							<div class="mt-1 flex flex-wrap gap-1">
								{#each book.tags as tag (tag)}
									<span class="border border-[var(--color-divider)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px]">
										{tag}
									</span>
								{/each}
							</div>
						{/if}
						{#if book.processingStatus !== 'ready'}
							<p class="mt-1 text-xs text-[var(--color-accent-700)]">
								{book.processingStatus === 'failed'
									? 'Verarbeitung fehlgeschlagen'
									: 'wird verarbeitet…'}
							</p>
						{/if}
						{@render progressDisplay(book)}
					</button>
				{/each}
			</div>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each filteredBooks as book (book.id)}
					<li>
						<button
							onclick={() => goto(`/book/${book.id}`)}
							class="flex w-full items-center gap-4 border border-[var(--color-divider)] bg-[var(--color-surface)] px-4 py-1.5 text-left transition hover:border-[var(--color-accent)]"
						>
							{#if book.coverUrl && !brokenCovers.has(book.id)}
								<img
									src={book.coverUrl}
									alt=""
									class="aspect-[2/3] h-28 flex-none border border-[var(--color-divider)] object-cover"
									onerror={() => markCoverBroken(book.id)}
								/>
							{:else}
								<div
									class="flex aspect-[2/3] h-28 flex-none items-center justify-center bg-[var(--color-accent)] text-lg font-extrabold text-[var(--color-bg)]"
								>
									{book.title.slice(0, 1).toUpperCase()}
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="truncate font-medium">{book.title}</p>
								<p class="truncate text-sm text-[var(--color-neutral-700)]">{book.author}</p>
								{#if book.tags.length > 0}
									<div class="mt-1 flex flex-wrap gap-1">
										{#each book.tags as tag (tag)}
											<span class="border border-[var(--color-divider)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[10px]">
												{tag}
											</span>
										{/each}
									</div>
								{/if}
								{#if book.processingStatus !== 'ready'}
									<p class="mt-1 text-xs text-[var(--color-accent-700)]">
										{book.processingStatus === 'failed'
											? 'Verarbeitung fehlgeschlagen'
											: 'wird verarbeitet…'}
									</p>
								{/if}
								{@render progressDisplay(book)}
							</div>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</main>
