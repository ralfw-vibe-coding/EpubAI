import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../config.js";

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
