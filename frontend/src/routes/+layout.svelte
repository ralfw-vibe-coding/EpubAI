<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import '../app.css';
	import { requestPersistentStorage } from '../providers/x/storage-persist';
	import { getProcessor, isAuthenticated } from '../portal/runtime';

	let { children } = $props();

	/**
	 * Die Anmeldung ab der letzten NUTZUNG ablaufen lassen statt ab der
	 * Anmeldung: Beim Öffnen der App wird der Token gegen einen frischen
	 * getauscht (siehe processor/reactors/refreshSession.ts).
	 *
	 * Hier im Wurzel-Layout, weil es die einzige Stelle ist, die jeder Weg in
	 * die App durchläuft - egal ob Bibliothek, Buchdetails oder ein direkt
	 * geöffneter Reader-Link.
	 *
	 * Und zusätzlich bei jedem Sichtbarwerden, nicht nur beim Start: Als
	 * eigenständige App vom Home-Screen läuft die Seite auf iOS weiter und
	 * wird beim Zurückwechseln nur wieder eingeblendet - onMount feuert dann
	 * NICHT. Ohne diesen zweiten Auslöser bliebe die Frist bei jemandem, der
	 * die App nie ganz beendet, für immer auf dem Stand des ersten Starts.
	 * Wie oft das feuert, ist unkritisch: Der Reactor erneuert frühestens eine
	 * Stunde nach Ausstellung des Tokens.
	 */
	function renewSession() {
		if (!isAuthenticated()) return;
		void getProcessor().refreshSession();
	}

	function onVisible() {
		if (document.visibilityState === 'visible') renewSession();
	}

	onMount(() => {
		// Ask for persistent storage once at app start (eviction protection, §4.4).
		void requestPersistentStorage();
		renewSession();
		document.addEventListener('visibilitychange', onVisible);
	});

	onDestroy(() => {
		document.removeEventListener('visibilitychange', onVisible);
	});
</script>

<div class="min-h-[var(--app-height)]">
	{@render children()}
</div>
