import type { ReactorDeps } from '../deps';

/**
 * Reactor: explain/look up a selected word or phrase (POST /ai/lookup).
 * Network required — no local fallback for an AI call — so this throws on
 * failure and the Portal surfaces the error.
 */
export async function lookupSelection(
	deps: Pick<ReactorDeps, 'http'>,
	text: string,
	lang: string
): Promise<string> {
	return deps.http.lookupSelection(text, lang);
}
