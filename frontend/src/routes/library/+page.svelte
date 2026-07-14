<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { CatalogBook } from '../../domain/types';
	import { getProcessor, isAuthenticated } from '../../portal/runtime';

	let books = $state<CatalogBook[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	onMount(async () => {
		if (!isAuthenticated()) {
			await goto('/login', { replaceState: true });
			return;
		}
		try {
			books = await getProcessor().loadCatalog();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Katalog konnte nicht geladen werden.';
		} finally {
			loading = false;
		}
	});

	async function signOut() {
		await getProcessor().signOut();
		await goto('/login', { replaceState: true });
	}
</script>

<header
	class="sticky top-0 z-10 flex items-center justify-between border-b-2 border-[var(--color-divider)] bg-[var(--color-bg)]/95 px-5 py-4 backdrop-blur"
>
	<h1 class="font-[var(--font-heading)] text-xl font-extrabold tracking-tight">Bibliothek</h1>
	<button onclick={signOut} class="text-sm text-[var(--color-accent-700)] underline">Abmelden</button>
</header>

<main class="mx-auto max-w-2xl px-5 py-6">
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
