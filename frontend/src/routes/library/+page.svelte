<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Check, Highlighter, StickyNote, Upload } from 'lucide-svelte';
	import type { BookDetail, CatalogBook } from '../../domain/types';
	import { getProcessor, isAuthenticated } from '../../portal/runtime';
	import { filterBooks, filterByLocal, tagsFrom, visibleBooks } from './filterBooks';
	import {
		LIBRARY_FILTERS_STORAGE_KEY,
		parseLibraryFilters,
		pruneMissingTags,
		serializeLibraryFilters,
		type LibraryFilters,
		type LibraryViewMode
	} from './filterState';

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

	// Drag-and-drop upload: counts nested dragenter/dragleave pairs (they fire
	// for every child element the pointer crosses, not just window-level
	// enter/exit) so the overlay doesn't flicker while dragging over the page.
	let dragDepth = $state(0);
	let isDraggingFile = $derived(dragDepth > 0);

	// Book covers that failed to load fall back to the color-swatch display
	// instead of a broken-image icon (Aufgabe 7).
	let brokenCovers = $state<Set<string>>(new Set());
	function markCoverBroken(bookId: string) {
		brokenCovers = new Set(brokenCovers).add(bookId);
	}

	// Die zuletzt eingestellte Ansicht gilt beim nächsten Öffnen wieder
	// (gerätelokal, siehe filterState.ts). Direkt bei der Initialisierung
	// gelesen statt in onMount: Die App läuft ohne SSR (+layout.ts), also ist
	// localStorage hier schon verfügbar - und der Zustand ist von der ersten
	// Darstellung an korrekt, ohne dass die Bibliothek kurz ungefiltert
	// aufblitzt oder ein Speicher-Effekt die Werte überschreibt, bevor sie
	// wiederhergestellt sind. Muss vor allem stehen, was daraus initialisiert
	// wird - const, also keine Hochziehung.
	const storedFilters = parseLibraryFilters(readStoredFilters());

	// Cover/Liste-Umschalter (Segmented Control) - Cover-Ansicht ist Standard.
	let viewMode = $state<LibraryViewMode>(storedFilters.viewMode);

	// Tag-Filter: distinct Tags aus allen geladenen Büchern, alphabetisch.
	// Aktive Tags werden ODER-verknüpft (Buch muss mindestens einen tragen).
	let activeTags = $state<Set<string>>(new Set(storedFilters.tags));

	// Suche (Titel/Autor, Teilstring, Groß-/Kleinschreibung egal) - UND mit den
	// aktiven Tags kombiniert.
	let searchQuery = $state(storedFilters.query);

	// Archiv einschließen: standardmäßig aus - archivierte Bücher sind dann
	// weder in der Liste noch in den Tag-Chips sichtbar. Ausgeliehen-Filter:
	// standardmäßig aus, zeigt bei Aktivierung nur auf diesem Gerät geliehene
	// Bücher. Reihenfolge wichtig: erst Archiv-Einbeziehung + Ausgeliehen-Filter
	// (-> sichtbare Menge), DANN allTags aus dieser Menge ableiten, DANN
	// Suche+Tags darauf anwenden.
	let includeArchived = $state(storedFilters.includeArchived);
	let onlyLocal = $state(storedFilters.onlyLocal);

	let visible = $derived(filterByLocal(visibleBooks(books, includeArchived), onlyLocal));
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

	// localStorage kann in bestimmten Datenschutz-/Speicherzuständen werfen -
	// gemerkte Filter sind Komfort, nie ein Grund, die Bibliothek nicht zu
	// zeigen. Gleiche Haltung wie bei den Reader-Einstellungen.
	function readStoredFilters(): string | null {
		try {
			return localStorage.getItem(LIBRARY_FILTERS_STORAGE_KEY);
		} catch {
			return null;
		}
	}

	$effect(() => {
		const filters: LibraryFilters = {
			query: searchQuery,
			tags: [...activeTags],
			includeArchived,
			onlyLocal,
			viewMode
		};
		try {
			localStorage.setItem(LIBRARY_FILTERS_STORAGE_KEY, serializeLibraryFilters(filters));
		} catch {
			// Best effort - siehe readStoredFilters().
		}
	});

	onMount(async () => {
		if (!isAuthenticated()) {
			await goto('/login', { replaceState: true });
			return;
		}
		window.addEventListener('dragenter', onWindowDragEnter);
		window.addEventListener('dragover', onWindowDragOver);
		window.addEventListener('dragleave', onWindowDragLeave);
		window.addEventListener('drop', onWindowDrop);
		// App-start sync of annotations into the local cache (best-effort: if
		// offline, the last synced cache stays as-is so the Reader still works).
		getProcessor()
			.syncAnnotations()
			.catch(() => undefined);
		// App-start sync of the reading position across devices (best-effort,
		// same as above): merges local and remote per book, greater progress
		// wins, and hands over any progress made while offline.
		getProcessor()
			.syncReadingProgress()
			.catch(() => undefined);
		await reload();
	});

	onDestroy(() => {
		window.removeEventListener('dragenter', onWindowDragEnter);
		window.removeEventListener('dragover', onWindowDragOver);
		window.removeEventListener('dragleave', onWindowDragLeave);
		window.removeEventListener('drop', onWindowDrop);
	});

	/** Only react to an actual file being dragged, never a dragged link/text/image. */
	function dragHasFiles(e: DragEvent): boolean {
		return Array.from(e.dataTransfer?.types ?? []).includes('Files');
	}

	function onWindowDragEnter(e: DragEvent) {
		if (!dragHasFiles(e)) return;
		e.preventDefault();
		dragDepth++;
	}

	function onWindowDragOver(e: DragEvent) {
		// preventDefault is what tells the browser "this is a valid drop
		// target" - without it, the drop event never fires and the browser
		// just opens the file itself.
		if (dragHasFiles(e)) e.preventDefault();
	}

	function onWindowDragLeave(e: DragEvent) {
		if (!dragHasFiles(e)) return;
		dragDepth = Math.max(0, dragDepth - 1);
	}

	async function onWindowDrop(e: DragEvent) {
		if (!dragHasFiles(e)) return;
		e.preventDefault();
		dragDepth = 0;
		const file = e.dataTransfer?.files?.[0];
		if (file) await uploadFile(file);
	}

	async function reload() {
		loading = true;
		error = null;
		try {
			books = await getProcessor().loadCatalog();
			// Gemerkte Tags, die es im Katalog nicht mehr gibt, hier wegräumen -
			// sonst bliebe ein Filter aktiv, für den gar kein Chip mehr angezeigt
			// wird (die Chips leiten sich aus den vorhandenen Büchern ab), und die
			// Bibliothek wirkte grundlos leer. Gegen ALLE Bücher geprüft, nicht die
			// gerade sichtbaren: ein aktiver Ausleihen-/Archiv-Filter darf die
			// gemerkten Tags nicht mit wegräumen.
			activeTags = pruneMissingTags(activeTags, tagsFrom(books));
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

	// Shared by both upload entry points (file picker and drag-and-drop):
	// upload it (which also creates the catalog entry) with a real progress
	// readout, then reload the catalog. A duplicate links to the existing
	// entry; any other failure shows an error.
	async function uploadFile(file: File) {
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

	async function onFileChosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		await uploadFile(file);
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

{#if isDraggingFile}
	<button
		type="button"
		onclick={startUpload}
		aria-label="EPUB hochladen"
		class="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-3 bg-[var(--color-bg)]/90 backdrop-blur-sm"
	>
		<div
			class="mx-6 flex flex-col items-center gap-3 border-2 border-dashed border-[var(--color-accent)] px-12 py-16 text-center"
		>
			<Upload size={40} class="text-[var(--color-accent)]" />
			<p class="font-[var(--font-heading)] text-lg font-extrabold">EPUB hier ablegen</p>
			<p class="text-sm text-[var(--color-neutral-700)]">oder klicken, um eine Datei auszuwählen</p>
		</div>
	</button>
{/if}

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

	<!-- Diagonal hatching over the whole cover for archived books (only ever
	     visible when "Archiv einschließen" is on) - decorative, so pointer
	     events pass through to the book button underneath; the archived state
	     itself is exposed to assistive tech via sr-only text. Two fixed-opacity
	     layers via color-mix (not a div-level `opacity`, which would just fade
	     both together and let a dark cover swallow the stripes again): a light
	     wash first to even out dark covers, then the stripes on top, so the
	     hatching stays legible no matter how dark or busy the cover art is. -->
	{#snippet archivedOverlay()}
		<div
			class="pointer-events-none absolute inset-0"
			style="background-image: repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-neutral-700) 55%, transparent) 0 3px, transparent 3px 12px); background-color: color-mix(in srgb, var(--color-bg) 65%, transparent);"
		>
			<span class="sr-only">Archiviert</span>
		</div>
	{/snippet}

	{#snippet annotationCounts(book: CatalogBook)}
		{#if book.highlightCount > 0 || book.noteCount > 0}
			<div class="mt-1 flex items-center gap-2 text-xs text-[var(--color-neutral-700)]">
				{#if book.highlightCount > 0}
					<span class="flex items-center gap-0.5">
						<Highlighter size={12} />
						{book.highlightCount}
					</span>
				{/if}
				{#if book.noteCount > 0}
					<span class="flex items-center gap-0.5">
						<StickyNote size={12} />
						{book.noteCount}
					</span>
				{/if}
			</div>
		{/if}
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
			<div class="flex flex-none items-center gap-2">
				<button
					onclick={() => (onlyLocal = !onlyLocal)}
					aria-pressed={onlyLocal}
					class="flex-none whitespace-nowrap border border-[var(--color-divider)] px-3 py-1 text-xs font-semibold {onlyLocal
						? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
						: 'bg-[var(--color-surface)]'}"
				>
					Ausgeliehen
				</button>
				<button
					onclick={() => (includeArchived = !includeArchived)}
					aria-pressed={includeArchived}
					class="flex-none whitespace-nowrap border border-[var(--color-divider)] px-3 py-1 text-xs font-semibold {includeArchived
						? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
						: 'bg-[var(--color-surface)]'}"
				>
					Archiv
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
							{#if book.archived}
								{@render archivedOverlay()}
							{/if}
						</div>
						<p class="mt-2 truncate text-sm font-medium">{book.title}</p>
						<p class="truncate text-xs text-[var(--color-neutral-700)]">{book.author}</p>
						{@render annotationCounts(book)}
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
								{#if book.archived}
									{@render archivedOverlay()}
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate font-medium">{book.title}</p>
								<p class="truncate text-sm text-[var(--color-neutral-700)]">{book.author}</p>
								{@render annotationCounts(book)}
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
