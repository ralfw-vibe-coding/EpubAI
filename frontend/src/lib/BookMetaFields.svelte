<script lang="ts">
	import { getProcessor } from '../portal/runtime';

	// The shared Titel/Autor/Tags fields used by BOTH the upload-details form
	// (library) and the edit-details form (book detail). Kept as one component
	// so the two can't drift apart - the surrounding context (cover preview,
	// action buttons, layout) stays with each parent; only these editable
	// fields, including the tag autocomplete, are shared here.
	let {
		title = $bindable(),
		author = $bindable(),
		tags = $bindable()
	}: { title: string; author: string; tags: string[] } = $props();

	let tagInput = $state('');
	let tagInputFocused = $state(false);
	let knownTags = $state<string[]>([]);

	// Distinct tags across the user's own catalog, for the autocomplete
	// suggestions. Loaded eagerly when the fields mount (not lazily on first
	// focus) so the full list is already there the moment the tag field is
	// focused - the earlier lazy-on-focus version meant a freshly opened form
	// showed nothing until a catalog round-trip finished.
	$effect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const catalog = await getProcessor().loadCatalog();
				if (cancelled) return;
				const distinct = new Set<string>();
				for (const book of catalog) for (const tag of book.tags) distinct.add(tag);
				knownTags = [...distinct];
			} catch {
				// Suggestions are a convenience only; silently skip on failure.
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	function addTag(tag: string) {
		const trimmed = tag.trim();
		if (trimmed && !tags.includes(trimmed)) tags = [...tags, trimmed];
		tagInput = '';
	}

	function removeTag(tag: string) {
		tags = tags.filter((t) => t !== tag);
	}

	function onTagKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addTag(tagInput);
		}
	}

	function onTagInputBlur() {
		// Delay hiding so a click on a suggestion chip registers before the
		// list disappears (blur fires before the chip's click otherwise).
		setTimeout(() => {
			tagInputFocused = false;
		}, 150);
	}

	// Empty query -> the full list of not-yet-assigned known tags (so focusing
	// the field shows everything available); typing narrows it down.
	const tagSuggestions = $derived.by(() => {
		const query = tagInput.trim().toLowerCase();
		return knownTags.filter((tag) => tag.toLowerCase().includes(query) && !tags.includes(tag));
	});
</script>

<label class="flex flex-col gap-1 text-sm">
	<span class="text-[var(--color-neutral-700)]">Titel</span>
	<input
		bind:value={title}
		class="border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2"
	/>
</label>
<label class="flex flex-col gap-1 text-sm">
	<span class="text-[var(--color-neutral-700)]">Autor</span>
	<input
		bind:value={author}
		class="border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2"
	/>
</label>
<div class="flex flex-col gap-1 text-sm">
	<span class="text-[var(--color-neutral-700)]">Tags</span>
	<div class="flex flex-wrap gap-2">
		{#each tags as tag (tag)}
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
		onfocus={() => (tagInputFocused = true)}
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
