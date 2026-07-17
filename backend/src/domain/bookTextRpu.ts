// RPUs over a book's extracted full text (Requirements 4.6 "KI-Grundlage").
//
// Pure functions on plain strings - no providers, no state. They turn the
// ~400.000-token full text produced by extractFullText() into the two small
// pieces a chat request can actually afford to send:
//
//   - the outline  : the book's own structure, a few hundred tokens
//   - the window   : the passage around the reader's selection
//
// Sending the whole book instead is technically possible (Sonnet 5 holds 1M
// tokens) but costs ~$0,74 per question against ~$0,04 for these two - see the
// "Dossier + Kontext" decision in the backlog. The dossier covers what neither
// of these can: the argument of the other 600 pages.

/**
 * How much of the book to send around a selection, in characters per side.
 *
 * A character budget rather than "the chapter": chapters are wildly uneven
 * (some EPUBs put the entire book in one spine document), which would make
 * both cost and latency unpredictable. Characters are predictable.
 *
 * German prose runs ~2,1 characters per token and English ~3,1 (measured with
 * count_tokens against claude-sonnet-5 over the books in test-books/), so
 * 10.000 per side is roughly 5.000-9.500 tokens of context, ~$0,02 per
 * question. Tune here.
 */
export const CONTEXT_CHARS_PER_SIDE = 10_000;

/** Locating a selection uses only its opening; the rest adds regex cost, not precision. */
const LOCATOR_MAX_CHARS = 200;

/**
 * How far past the budget we may reach for a line boundary before giving up
 * and cutting mid-line.
 *
 * Without a ceiling this is a cost bug, not a cosmetic one: a book with no
 * line breaks anywhere near the cut - one giant paragraph, which badly built
 * EPUBs really do produce - would snap all the way to the end of the text and
 * quietly put the ENTIRE book in the prompt. That is ~$0,74 a question instead
 * of ~$0,02. A ragged cut is the far cheaper mistake.
 */
const SNAP_SLACK_CHARS = 500;

/** Guards against a pathological book turning the outline back into a big prompt. */
const OUTLINE_MAX_LINES = 400;

const MARKER_LINE = /^=== \[\d+\] ===$/;
const HEADING_LINE = /^#{1,6} \S/;

/**
 * The book's structure: spine markers plus the Markdown headings extracted
 * from the EPUB's own <h1>-<h6>.
 *
 * Cheap enough (a few hundred tokens) to send on every request, and it is what
 * lets a chat without a dossier still say something true about the book as a
 * whole. The markers matter as much as the headings: the context window carries
 * the same "=== [n] ===" lines, so a shared numbering is what lets the model
 * place an isolated passage inside the whole.
 */
export function bookOutline(bookText: string): string {
  const lines: string[] = [];
  for (const line of bookText.split("\n")) {
    if (!MARKER_LINE.test(line) && !HEADING_LINE.test(line)) continue;
    lines.push(line);
    if (lines.length >= OUTLINE_MAX_LINES) break;
  }
  return lines.join("\n");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where the selection sits in the full text, as a character offset.
 *
 * The two texts never match byte-for-byte: epub.js hands us what the browser
 * rendered, including the source file's own line breaks and indentation, while
 * extractFullText() has flattened all of that. So a plain indexOf fails on any
 * selection spanning more than one source line - i.e. most of them. Matching a
 * whitespace-tolerant pattern against the ORIGINAL text sidesteps that without
 * having to build (and allocate) an index map over 1,5M characters.
 *
 * `progressPercent` (0..1) breaks ties. A short selection genuinely repeats -
 * "wie oben gezeigt" appears dozens of times in a Sachbuch - and the reader's
 * position says which one they meant.
 */
export function findSelection(
  bookText: string,
  selection: string,
  progressPercent?: number
): number | null {
  const needle = collapse(selection).slice(0, LOCATOR_MAX_CHARS);
  if (needle.length === 0) return null;

  const pattern = escapeRegExp(needle).replace(/ /g, "\\s+");
  let re: RegExp;
  try {
    re = new RegExp(pattern, "g");
  } catch {
    return null;
  }

  const hits: number[] = [];
  for (let m = re.exec(bookText); m !== null; m = re.exec(bookText)) {
    hits.push(m.index);
    if (hits.length >= 1000) break;
    // Overlapping matches are fine; step by one so a repeated phrase inside
    // itself cannot skip a candidate.
    re.lastIndex = m.index + 1;
  }

  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!;

  const target = clamp(progressPercent ?? 0.5, 0, 1) * bookText.length;
  return hits.reduce((best, hit) => (Math.abs(hit - target) < Math.abs(best - target) ? hit : best));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Back to the start of the line, so the window never opens mid-sentence. */
function snapStart(text: string, index: number): number {
  if (index <= 0) return 0;
  const nl = text.lastIndexOf("\n", index);
  if (nl === -1 || index - nl > SNAP_SLACK_CHARS) return index;
  return nl + 1;
}

/** Forward to the end of the line, so the window never closes mid-sentence. */
function snapEnd(text: string, index: number): number {
  if (index >= text.length) return text.length;
  const nl = text.indexOf("\n", index);
  if (nl === -1 || nl - index > SNAP_SLACK_CHARS) return index;
  return nl;
}

/**
 * The passage around a selection: CONTEXT_CHARS_PER_SIDE either side, snapped
 * outward to line boundaries, clamped at the ends of the book.
 *
 * Returns null when the selection cannot be located - the caller must then say
 * so rather than answer from a window that isn't where the reader is looking.
 */
export function contextWindow(
  bookText: string,
  selection: string,
  progressPercent?: number
): string | null {
  const at = findSelection(bookText, selection, progressPercent);
  if (at === null) return null;

  const start = snapStart(bookText, Math.max(0, at - CONTEXT_CHARS_PER_SIDE));
  const end = snapEnd(bookText, Math.min(bookText.length, at + selection.length + CONTEXT_CHARS_PER_SIDE));
  return bookText.slice(start, end).trim();
}
