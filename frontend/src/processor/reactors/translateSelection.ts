import type { ReactorDeps } from '../deps';

/**
 * Reactor: translate a selected excerpt into the given target language
 * (POST /ai/translate). Network required — no local fallback for an AI
 * call — so this throws on failure and the Portal surfaces the error.
 */
export async function translateSelection(
	deps: Pick<ReactorDeps, 'http'>,
	text: string,
	lang: string
): Promise<string> {
	return deps.http.translateSelection(text, lang);
}
