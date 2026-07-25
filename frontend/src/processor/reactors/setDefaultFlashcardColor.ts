import type { ReactorDeps } from '../deps';

/**
 * Reactor: change the user's default highlight color for vocabulary flashcards
 * (PATCH /account). Network required — this is account state owned by the
 * backend, not a local preference. On success, the cached session is updated
 * in place so the new color is reflected immediately without a re-login.
 */
export async function setDefaultFlashcardColor(
	deps: Pick<ReactorDeps, 'http' | 'auth'>,
	color: string
): Promise<void> {
	const { defaultFlashcardColor } = await deps.http.updateAccountSettings({
		defaultFlashcardColor: color
	});
	const session = deps.auth.get();
	if (session) deps.auth.set({ ...session, defaultFlashcardColor });
}
