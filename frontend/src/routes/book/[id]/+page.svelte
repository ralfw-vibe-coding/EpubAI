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
			<div class="min-w-0">
				<h1 class="font-[var(--font-heading)] text-2xl font-extrabold tracking-tight">{detail.title}</h1>
				<p class="mt-1 text-[var(--color-neutral-700)]">{detail.author}</p>
				<p class="mt-2 text-xs text-[var(--color-neutral-700)]">
					Status: {detail.isLocal ? 'auf diesem Gerät' : 'nicht ausgeliehen'}
				</p>
			</div>
		</div>

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

		{#if error}
			<p class="mt-4 bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">{error}</p>
		{/if}
	{/if}
</main>
