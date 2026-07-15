<script lang="ts">
	import { goto } from '$app/navigation';
	import { getProcessor } from '../../portal/runtime';

	type Step = 'email' | 'code';

	let step = $state<Step>('email');
	let email = $state('');
	let code = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	// Backend errors arrive as short machine codes (e.g. "invalid_code") -
	// map the ones this page can produce to clear German copy so a failure
	// reads as an actual message, not a stray technical string.
	const AUTH_ERROR_MESSAGES: Record<string, string> = {
		invalid_email: 'Bitte eine gültige E-Mail-Adresse eingeben.',
		invalid_code:
			'Code ungültig oder abgelaufen. Bitte erneut eingeben oder eine neue Anfrage stellen.',
		email_send_failed: 'Code konnte nicht per E-Mail verschickt werden. Bitte später erneut versuchen.'
	};

	function friendlyAuthError(e: unknown, fallback: string): string {
		const message = e instanceof Error ? e.message : '';
		return AUTH_ERROR_MESSAGES[message] ?? fallback;
	}

	async function sendCode() {
		if (!email || busy) return;
		busy = true;
		error = null;
		try {
			await getProcessor().requestLoginCode(email.trim());
			step = 'code';
		} catch (e) {
			error = friendlyAuthError(e, 'Konnte den Code nicht anfordern.');
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
			error = friendlyAuthError(e, 'Code ungültig.');
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
		<!-- svelte-ignore a11y_autofocus -->
		<input
			id="email"
			type="email"
			autocomplete="email"
			autofocus
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
		<!-- Masked (dots instead of characters) via -webkit-text-security rather than
		     type="password": that combined with autocomplete="one-time-code" made iOS/Safari
		     switch to a numeric-only OTP keyboard, blocking letters and >6-char entry entirely -
		     exactly what §4.2b requires NOT to happen. This masks visually without changing
		     type/inputmode/autocomplete behavior at all; browsers that don't support the
		     (WebKit-only) property just show the text in the clear, which is an acceptable
		     fallback since masking here is a convenience, not a security requirement. -->
		<!-- svelte-ignore a11y_autofocus -->
		<input
			id="code"
			type="text"
			inputmode="text"
			autocomplete="one-time-code"
			autocapitalize="none"
			autocorrect="off"
			spellcheck="false"
			autofocus
			bind:value={code}
			onkeydown={(e) => e.key === 'Enter' && verify()}
			placeholder="Code eingeben"
			style="-webkit-text-security: disc;"
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
