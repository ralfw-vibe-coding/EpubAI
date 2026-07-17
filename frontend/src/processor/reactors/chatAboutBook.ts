import type { ChatMessage, ChatReply } from '../ports';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: ask a question about a book (POST /ai/chat), either about a
 * selected excerpt or the book as a whole. Network required — no local
 * fallback for an AI call — so this throws on failure and the Portal
 * surfaces the error.
 */
export async function chatAboutBook(
	deps: Pick<ReactorDeps, 'http'>,
	bookId: string,
	messages: ChatMessage[],
	selection?: string,
	progressPercent?: number
): Promise<ChatReply> {
	return deps.http.chatAboutBook(bookId, messages, selection, progressPercent);
}
