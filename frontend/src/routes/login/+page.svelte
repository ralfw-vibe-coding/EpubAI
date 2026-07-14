<script lang="ts">
	import { goto } from '$app/navigation';
	import { getProcessor } from '../../portal/runtime';

	type Step = 'email' | 'code';

	let step = $state<Step>('email');
	let email = $state('');
	let code = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function sendCode() {
		if (!email || busy) return;
		busy = true;
		error = null;
		try {
			await getProcessor().requestLoginCode(email.trim());
			step = 'code';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Konnte den Code nicht anfordern.';
		} finally {
			busy = false;
		}
	}

	async function verify() {
		if (!code || busy) return;
		busy = true;
		error = null;
		try {
			await getProcessor().verifyLoginCode(email.trim(), code.trim());
			await goto('/library', { replaceState: true });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Code ungültig.';
		} finally {
			busy = false;
		}
	}
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
	<div class="mb-10 border-b-2 border-[var(--color-divider)] pb-3">
		<h1 class="font-[var(--font-heading)] text-3xl font-extrabold tracking-tight">EpubAI</h1>
		<p class="mt-1 text-sm text-[var(--color-neutral-700)]">Deine Bibliothek zum Lesen</p>
	</div>

	{#if step === 'email'}
		<label class="mb-2 block text-xs font-semibold tracking-wide uppercase" for="email">E-Mail</label>
		<input
			id="email"
			type="email"
			autocomplete="email"
			bind:value={email}
			onkeydown={(e) => e.key === 'Enter' && sendCode()}
			placeholder="du@beispiel.de"
			class="mb-4 w-full border border-[var(--color-divider)] bg-[var(--color-surface)] px-4 py-3 text-base outline-none focus:border-[var(--color-accent)]"
		/>
		<button
			onclick={sendCode}
			disabled={busy || !email}
			class="w-full bg-[var(--color-accent)] px-4 py-3 text-left font-semibold text-[var(--color-bg)] disabled:opacity-45"
		>
			{busy ? 'Sende…' : 'Code anfordern →'}
		</button>
	{:else}
		<p class="mb-4 text-sm text-[var(--color-neutral-700)]">
			Code an <span class="font-medium text-[var(--color-text)]">{email}</span> gesendet.
		</p>
		<label class="mb-2 block text-xs font-semibold tracking-wide uppercase" for="code">Einmal-Code</label>
		<!-- Alphanumeric, arbitrary length; deliberately NOT a numeric/6-digit field (§4.2b). -->
		<input
			id="code"
			type="text"
			inputmode="text"
			autocomplete="one-time-code"
			autocapitalize="none"
			autocorrect="off"
			spellcheck="false"
			bind:value={code}
			onkeydown={(e) => e.key === 'Enter' && verify()}
			placeholder="Code eingeben"
			class="mb-4 w-full border border-[var(--color-divider)] bg-[var(--color-surface)] px-4 py-3 text-base tracking-wide outline-none focus:border-[var(--color-accent)]"
		/>
		<button
			onclick={verify}
			disabled={busy || !code}
			class="w-full bg-[var(--color-accent)] px-4 py-3 text-left font-semibold text-[var(--color-bg)] disabled:opacity-45"
		>
			{busy ? 'Prüfe…' : 'Anmelden →'}
		</button>
		<button
			onclick={() => {
				step = 'email';
				code = '';
				error = null;
			}}
			class="mt-3 w-full text-left text-sm text-[var(--color-accent-700)] underline"
		>
			Andere E-Mail
		</button>
	{/if}

	{#if error}
		<p class="mt-4 bg-[var(--color-accent-100)] px-3 py-2 text-sm text-[var(--color-accent-800)]">
			{error}
		</p>
	{/if}
</main>
