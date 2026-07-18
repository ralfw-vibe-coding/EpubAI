<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Check } from 'lucide-svelte';
	import type { BookDetail, CatalogBook } from '../../domain/types';
	import { getProcessor, isAuthenticated } from '../../portal/runtime';
	import { filterBooks, tagsFrom, visibleBooks } from './filterBooks';

	let books = $state<BookDetail[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Upload flow, one phase at a time. Selecting a file uploads AND creates the
	// book in one step (metadata as-is, edited later on the book detail page) -
	// there is no intermediate "confirm details" step:
	//   idle -> uploading (progress bar) -> back to idle once the catalog reloads
	//                                     -> duplicate (link to existing book)
	//                                     -> error
	type UploadPhase = 'idle' | 'uploading' | 'duplicate' | 'error';
	let phase = $state<UploadPhase>('idle');
	let progress = $state(0);
	let uploadError = $state<string | null>(null);
	let duplicateBookId = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

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

	// Suche (Titel/Autor, Teilstring, Groß-/Kleinschreibung egal) - UND mit den
	// aktiven Tags kombiniert.
	let searchQuery = $state('');

	// Archiv einschließen: standardmäßig aus - archivierte Bücher sind dann
	// weder in der Liste noch in den Tag-Chips sichtbar. Reihenfolge wichtig:
	// erst Archiv-Einbeziehung (-> sichtbare Menge), DANN allTags aus dieser
	// Menge ableiten, DANN Suche+Tags darauf anwenden.
	let includeArchived = $state(false);

	let visible = $derived(visibleBooks(books, includeArchived));
	let allTags = $derived(tagsFrom(visible));
	let filteredBooks = $derived(filterBooks(visible, searchQuery, activeTags));

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
		// App-start sync of annotations into the local cache (best-effort: if
		// offline, the last synced cache stays as-is so the Reader still works).
		getProcessor()
			.syncAnnotations()
			.catch(() => undefined);
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
		duplicateBookId = null;
		if (fileInput) fileInput.value = '';
	}

	// A file was chosen -> upload it (which also creates the catalog entry) with
	// a real progress readout, then reload the catalog. A duplicate links to the
	// existing entry; any other failure shows an error.
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
				resetUpload();
				await reload();
			}
		} catch (e2) {
			uploadError = e2 instanceof Error ? e2.message : 'Upload fehlgeschlagen.';
			phase = 'error';
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
			{/if}

			{#if uploadError}
				<p class="bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">
					{uploadError}
				</p>
			{/if}
		</div>
	{/if}

	{#snippet localBadge()}
		<span
			class="absolute right-1 bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-bg)]"
			aria-label="Auf diesem Gerät ausgeliehen"
			title="Auf diesem Gerät ausgeliehen"
		>
			<Check size={12} strokeWidth={3} />
		</span>
	{/snippet}

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
		<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<input
				type="search"
				bind:value={searchQuery}
				placeholder="Suche nach Titel oder Autor…"
				aria-label="Suche nach Titel oder Autor"
				class="w-full border border-[var(--color-divider)] bg-[var(--color-surface)] px-3 py-1.5 text-sm sm:max-w-xs"
			/>
			<label class="flex flex-none items-center gap-2 text-sm text-[var(--color-neutral-700)]">
				<input type="checkbox" bind:checked={includeArchived} class="h-4 w-4" />
				Archiv einschließen
			</label>
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

		{#if filteredBooks.length === 0}
			<p class="text-[var(--color-neutral-700)]">Keine Bücher gefunden.</p>
		{:else if viewMode === 'cover'}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
				{#each filteredBooks as book (book.id)}
					<button onclick={() => goto(`/book/${book.id}`)} class="flex flex-col text-left">
						<div class="relative">
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
							{#if book.isLocal}
								{@render localBadge()}
							{/if}
						</div>
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
							<div class="relative flex-none">
								{#if book.coverUrl && !brokenCovers.has(book.id)}
									<img
										src={book.coverUrl}
										alt=""
										class="aspect-[2/3] h-28 border border-[var(--color-divider)] object-cover"
										onerror={() => markCoverBroken(book.id)}
									/>
								{:else}
									<div
										class="flex aspect-[2/3] h-28 items-center justify-center bg-[var(--color-accent)] text-lg font-extrabold text-[var(--color-bg)]"
									>
										{book.title.slice(0, 1).toUpperCase()}
									</div>
								{/if}
								{#if book.isLocal}
									{@render localBadge()}
								{/if}
							</div>
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
