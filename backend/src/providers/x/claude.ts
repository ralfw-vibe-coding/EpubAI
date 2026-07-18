import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../config.js";
import type { TokenUsage } from "../../domain/aiCostRpu.js";

// xProvider: Claude API for the two stateless AI reactors (translate/lookup).
// Untested like the other thin external-SDK wrappers (resend.ts, r2.ts) - not
// worth mocking a third-party client for. See Requirements 3.4/4.6: these are
// standalone Claude calls with no relation to the (separate, book-text-based)
// chat feature.
const client = new Anthropic({ apiKey: env.CLAUDE_API_KEY });

const MODEL = "claude-sonnet-5";

// The frontend only ever sends one of AVAILABLE_LANGUAGES's short codes
// (frontend/src/routes/read/[id]/languages.ts) - mapped to a full English
// name here because interpolating a bare 2-letter code into a sentence
// ("explain it in plain, concise fr") is too ambiguous for Claude to reliably
// pick up as the target language; a spelled-out name isn't. Falls back to the
// raw code for anything not in this fixed set, rather than failing outright.
const LANGUAGE_NAMES: Record<string, string> = {
  de: "German",
  en: "English",
  fr: "French",
  es: "Spanish",
  it: "Italian"
};

function languageName(lang: string): string {
  return LANGUAGE_NAMES[lang] ?? lang;
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export async function translateText(text: string, lang: string): Promise<string> {
  const target = languageName(lang);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: "disabled" },
    system:
      `Translate the following text into ${target}.\n\n` +
      `Write your ENTIRE response in ${target}. Every part of the output - the ` +
      "translation itself, any sense or usage descriptions, grammatical labels, and any " +
      `explanatory notes - must be written in ${target}. Do not switch back to the source ` +
      "language of the text at any point. The only text that may appear in another language is " +
      "the original word or phrase when you quote it as a headword for reference.\n\n" +
      "If it is a single word or a very short phrase, give a dictionary-style entry: the main " +
      "translation(s), and briefly note different senses or nuances if the word has more than " +
      `one common meaning - like a bilingual dictionary entry, with every description and sense ` +
      `label written in ${target}, not just one bare word. If it is a longer passage, give a ` +
      "natural, fluent translation of the whole passage instead.\n\n" +
      "Output only the translation/dictionary entry itself, with no extra framing like " +
      '"Here is the translation:".',
    messages: [{ role: "user", content: text }]
  });

  return extractText(response.content);
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatAboutBookInput {
  title: string;
  author: string;
  /** The book's structure (see bookTextRpu.bookOutline) - always present, cheap. */
  outline: string;
  /** The reader's optional, uploaded condensation of the whole book. */
  dossier: string | null;
  /** The passage around the selection. Null for a book-wide chat, or if the selection was not locatable. */
  context: string | null;
  /** What the reader marked. Null for a book-wide chat. */
  selection: string | null;
  /** The whole conversation so far; the backend is stateless, the client owns it. */
  messages: ChatTurn[];
}

// Everything the model must be honest about. Each rule is here because the
// alternative is a confident invention: the model is answering about a book it
// has mostly not read, from an excerpt, and it will happily paper over the gaps
// unless told not to.
const CHAT_INSTRUCTIONS =
  "You are helping a reader think about a book they are reading. They select a passage and ask " +
  "about it, or ask about the book as a whole.\n\n" +
  "WHAT YOU HAVE, AND WHAT YOU DO NOT\n" +
  "You do not have the book. You have at most: its outline; a dossier condensing the whole book, " +
  "but only if the reader has added one; and an excerpt - the selected passage plus roughly 10.000 " +
  "characters either side. The other several hundred pages, you have not read.\n" +
  "Never present a guess as knowledge. When the question needs something outside what you were " +
  'given, say so plainly and say what would settle it. A reader told "that turns on chapter 9, ' +
  'which I don\'t have here" is better served than one handed a confident invention.\n\n' +
  "The excerpt and the outline share the same markers: \"=== [n] ===\" opens a document of the book " +
  'and "#"/"##" are its own headings. Use them to work out where a passage sits in the whole.\n\n' +
  "FIGURES AND TABLES\n" +
  "This text was extracted from an EPUB. Figures, diagrams and many tables were embedded as images " +
  'and are missing from your text entirely. Where the text says "Table 3.1 shows..." you cannot see ' +
  "that table. Say so instead of inventing its contents.\n\n" +
  "LANGUAGE\n" +
  "Answer in the language of the reader's question. Use that language for the WHOLE answer - do not " +
  "drift into the book's language partway through, not even while discussing its content. Verbatim " +
  "quotations from the book stay in the original; everything you write yourself is in the question's " +
  "language.\n\n" +
  "STYLE\n" +
  "Answer the question that was asked, and lead with the answer. Be concrete and cite the book where " +
  "it supports you. Skip preamble; do not restate the question back at the reader.";

function bookBlock(input: ChatAboutBookInput): string {
  const parts = [`BOOK\nTitle: ${input.title}\nAuthor: ${input.author}`];
  if (input.outline.length > 0) {
    parts.push(`OUTLINE (the book's own structure)\n${input.outline}`);
  }
  if (!input.dossier) {
    // Without this, the model happily reconstructs the book's thesis from
    // chapter titles and presents the guess as if it had read the book - the
    // reader explicitly did not want that (see review feedback). The outline
    // locates a passage; it is not knowledge of the book's content.
    parts.push(
      "NO DOSSIER\n" +
        "The reader has not added a dossier, so for the book AS A WHOLE you have only the outline - " +
        "chapter titles, not their content. Do NOT reconstruct the book's thesis, argument or " +
        "message from chapter titles; that is speculation dressed up as knowledge, and it is exactly " +
        "what the reader does not want.\n" +
        "When the question is about the whole book (not about the excerpt below): say plainly that " +
        "without a dossier you cannot answer it from the book, and that the reader can add one in the " +
        "book's details. You MAY then add what you know about this SPECIFIC book from your own general " +
        "knowledge - but only if you genuinely recognise it, and only clearly marked as your own " +
        "knowledge rather than the book's text. Never invent a book you do not actually recognise. " +
        "Keep this short; do not pad it into a long outline-based summary.\n" +
        "Questions about the excerpt below are unaffected - answer those from the excerpt as normal."
    );
  }
  return parts.join("\n\n");
}

/**
 * A chat grounded in one book (Requirements 4.6).
 *
 * Prompt caching structure matters here and is deliberate:
 *
 *   system   = instructions + book identity + outline + dossier   <- stable per book, CACHED
 *   messages = excerpt + selection + the conversation             <- changes per selection
 *
 * The breakpoint sits on the last system block, so tools+system cache together.
 * The excerpt must stay on the messages side: it changes with every selection,
 * and putting it in the prefix would rewrite the cache on each new highlight.
 *
 * 5m TTL, not 1h: this prefix is small (an outline, maybe a ~7,7k-token
 * dossier), so a 1h write at 2x costs more than it saves, while a 5m write at
 * 1,25x refreshes on every hit and comfortably covers a burst of questions.
 * With no dossier the prefix may fall under the model's minimum cacheable size,
 * in which case caching silently does nothing - which is fine, there is nothing
 * worth saving.
 */
export interface ChatAboutBookResult {
  text: string;
  /** Token usage for cost accounting (see aiCostRpu). */
  usage: TokenUsage;
}

export async function chatAboutBook(input: ChatAboutBookInput): Promise<ChatAboutBookResult> {
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: CHAT_INSTRUCTIONS },
    { type: "text", text: bookBlock(input), cache_control: { type: "ephemeral", ttl: "5m" } }
  ];
  if (input.dossier) {
    delete system[1]!.cache_control;
    system.push({
      type: "text",
      text: `DOSSIER (the reader's condensation of the whole book)\n${input.dossier}`,
      cache_control: { type: "ephemeral", ttl: "5m" }
    });
  }

  const messages = withExcerpt(input);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: "disabled" },
    system,
    messages
  });

  const u = response.usage;
  return {
    text: extractText(response.content),
    usage: {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: u.cache_read_input_tokens ?? 0
    }
  };
}

/**
 * Attaches the excerpt to the first user turn.
 *
 * Re-attached on every request rather than kept client-side, so the client
 * cannot drift from what the reader actually selected - and so the excerpt
 * stays out of the cached system prefix.
 */
function withExcerpt(input: ChatAboutBookInput): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = input.messages.map((m) => ({ role: m.role, content: m.content }));
  const preamble: string[] = [];

  if (input.selection) {
    preamble.push(`THE READER SELECTED THIS PASSAGE:\n"""\n${input.selection}\n"""`);
    if (input.context) {
      preamble.push(`IT APPEARS HERE IN THE BOOK:\n"""\n${input.context}\n"""`);
    } else {
      // Being explicit beats silently answering from the selection alone: the
      // reader's question may well hinge on the surrounding argument.
      preamble.push(
        "The surrounding passage could not be located in the extracted text, so you have the " +
          "selection alone, without its context. Take that into account, and say so if it limits you."
      );
    }
  }

  const first = messages[0];
  if (preamble.length > 0 && first && first.role === "user" && typeof first.content === "string") {
    first.content = `${preamble.join("\n\n")}\n\n---\n\n${first.content}`;
  }
  return messages;
}

export async function lookupText(text: string, lang: string): Promise<string> {
  const target = languageName(lang);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: "disabled" },
    system:
      "The following is a short excerpt marked by a reader inside a book - a word, phrase, or " +
      "concept, not necessarily a full sentence. Briefly explain it (2-4 sentences), as context " +
      "or a definition for the reader.\n\n" +
      `Write your ENTIRE response in ${target}. Every sentence must be written in ${target}; do ` +
      "not switch to the language of the excerpt at any point. The only text that may appear in " +
      "another language is the excerpt itself if you quote it.",
    messages: [{ role: "user", content: text }]
  });

  return extractText(response.content);
}
