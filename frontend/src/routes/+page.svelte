<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isAuthenticated } from '../portal/runtime';

	onMount(() => {
		goto(isAuthenticated() ? '/library' : '/login', { replaceState: true });
	});
</script>

<div class="grid min-h-dvh place-items-center text-[var(--color-neutral-700)]">
	<p>Lädt…</p>
</div>
