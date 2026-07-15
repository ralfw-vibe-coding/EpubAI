import type { ReactorDeps } from '../deps';

/**
 * Reactor: change the user's preferred translation target language
 * (PATCH /account). Network required — this is account state owned by the
 * backend, not a local preference. On success, the cached session is
 * updated in place so the new language is reflected immediately without a
 * re-login.
 */
export async function setTranslationLanguage(
	deps: Pick<ReactorDeps, 'http' | 'auth'>,
	lang: string
): Promise<void> {
	const translationLanguage = await deps.http.updateAccountSettings(lang);
	const session = deps.auth.get();
	if (session) deps.auth.set({ ...session, translationLanguage });
}
