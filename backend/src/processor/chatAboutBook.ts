import { authorizeBookAccess } from "../domain/bookRpu.js";
import { bookOutline, contextWindow } from "../domain/bookTextRpu.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as r2 from "../providers/x/r2.js";
import * as claude from "../providers/x/claude.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";
import { dossierKey, ensureBookText } from "./shared/bookText.js";

export interface ChatAboutBookInput {
  bookId: unknown;
  selection?: unknown;
  progressPercent?: unknown;
  messages: unknown;
}

export type ChatAboutBookBody = { text: string; dossierUsed: boolean } | { error: string };

interface ValidTurn {
  role: "user" | "assistant";
  content: string;
}

/** The whole conversation, or null if the client sent something the API would reject. */
function parseMessages(value: unknown): ValidTurn[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const turns: ValidTurn[] = [];
  for (const raw of value) {
    const turn = raw as { role?: unknown; content?: unknown };
    if (turn?.role !== "user" && turn?.role !== "assistant") return null;
    if (typeof turn.content !== "string" || turn.content.trim().length === 0) return null;
    turns.push({ role: turn.role, content: turn.content });
  }
  // Claude requires the conversation to open with a user turn; rejecting here
  // turns a 400 from the API into a 400 of our own, with a reason.
  if (turns[0]!.role !== "user") return null;
  return turns;
}

/**
 * Reactor for POST /ai/chat - a conversation grounded in one book
 * (Requirements 4.6 "Chat/Q&A pro Buch").
 *
 * Serves both entry points, and the difference is only how much it can send:
 * with a `selection` (chat about a passage) the model gets the surrounding
 * excerpt; without one (chat about the book) it gets the outline and, if the
 * reader added one, the dossier.
 *
 * Deliberately NOT the whole book text: at 220.000-700.000 tokens a book, that
 * is ~$0,74 a question against ~$0,04 for outline + excerpt. The dossier is
 * how the reader buys back the depth, and it stays optional - a chat without
 * one works, it just knows less, and says so.
 *
 * Stateless: the client owns the conversation and resends it every turn.
 */
export async function chatAboutBook(
  authorizationHeader: string | undefined,
  input: ChatAboutBookInput
): Promise<ReactorResult<ChatAboutBookBody>> {
  if (typeof input.bookId !== "string" || input.bookId.trim().length === 0) {
    return ok(400, { error: "invalid_input" });
  }
  const messages = parseMessages(input.messages);
  if (!messages) return ok(400, { error: "invalid_input" });

  const selection =
    typeof input.selection === "string" && input.selection.trim().length > 0 ? input.selection : null;
  const progressPercent =
    typeof input.progressPercent === "number" && Number.isFinite(input.progressPercent)
      ? input.progressPercent
      : undefined;

  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  const book = await bookRepo.findById(input.bookId);
  if (!authorizeBookAccess(book, userId)) return ok(404, { error: "not_found" });

  const bookText = await ensureBookText(userId, book);
  if (!bookText) return ok(502, { error: "text_missing" });

  const dossier = await r2.getText(dossierKey(userId, book.currentFileHash));

  try {
    const text = await claude.chatAboutBook({
      title: book.title,
      author: book.author,
      outline: bookOutline(bookText),
      dossier,
      selection,
      context: selection ? contextWindow(bookText, selection, progressPercent) : null,
      messages
    });
    return ok(200, { text, dossierUsed: dossier !== null });
  } catch (err) {
    console.error("[chat] Claude call failed:", err);
    return ok(502, { error: "chat_failed" });
  }
}
