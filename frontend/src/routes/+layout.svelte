<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { requestPersistentStorage } from '../providers/x/storage-persist';

	let { children } = $props();

	onMount(() => {
		// Ask for persistent storage once at app start (eviction protection, §4.4).
		void requestPersistentStorage();
	});
</script>

<div class="min-h-dvh">
	{@render children()}
</div>
