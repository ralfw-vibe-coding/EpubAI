import yauzl from "yauzl";
import type { Entry, ZipFile } from "yauzl";
import { XMLParser } from "fast-xml-parser";
import path from "node:path";

// xProvider: EPUB (zip + OPF/XML) metadata extraction.
//
// Security properties (see Requirements 3.1 / 4.6):
// - Zip-bomb guard: only the small number of entries we actually need
//   (container.xml, the OPF file, and - if present - the cover image) are
//   decompressed, and the decompressed byte count is checked *while
//   streaming*, not after the fact - any entry whose content exceeds the
//   remaining budget aborts immediately.
// - XXE guard: fast-xml-parser never resolves DOCTYPEs/external entities (it
//   is not libxml2-based), so no XML parser configuration can enable XXE here.

export class EpubTooLargeError extends Error {}
export class EpubParseError extends Error {}
/** No spine, or a spine whose documents yielded no readable prose. */
export class EpubNoTextError extends Error {}

export interface ParsedEpubMeta {
  title?: string;
  author?: string;
  language?: string;
  // Present only when the OPF declares a cover image (EPUB3 `properties`
  // token or EPUB2 `<meta name="cover">` fallback) and that entry could be
  // read from the zip within the byte budget. `href` is the original,
  // OPF-relative href (kept around so callers can derive a fallback file
  // extension when `mediaType` isn't one of the well-known image types).
  cover?: { data: Buffer; mediaType: string; href: string };
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  textNodeName: "#text"
});

interface ByteBudget {
  remaining: number;
}

export async function parseEpub(fileBuffer: Buffer, maxUnpackedBytes: number): Promise<ParsedEpubMeta> {
  const budget: ByteBudget = { remaining: maxUnpackedBytes };

  const containerXml = await readEntryFromBuffer(fileBuffer, "META-INF/container.xml", budget, readEntryText);
  if (!containerXml) return {};

  const opfPath = extractOpfPath(safeParseXml(containerXml));
  if (!opfPath) return {};

  const opfXml = await readEntryFromBuffer(fileBuffer, opfPath, budget, readEntryText);
  if (!opfXml) return {};

  const opfDoc = safeParseXml(opfXml);
  const meta = extractMetaFromOpf(opfDoc);
  const cover = await extractCover(fileBuffer, opfPath, opfDoc, budget);
  return cover ? { ...meta, cover } : meta;
}

function safeParseXml(xml: string): unknown {
  try {
    return xmlParser.parse(xml);
  } catch (err) {
    throw new EpubParseError(`Failed to parse EPUB XML: ${(err as Error).message}`);
  }
}

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new EpubParseError("Failed to open EPUB as zip"));
      resolve(zipfile);
    });
  });
}

async function readEntryFromBuffer<T>(
  buffer: Buffer,
  targetPath: string,
  budget: ByteBudget,
  reader: (zipfile: ZipFile, entry: Entry, budget: ByteBudget) => Promise<T>
): Promise<T | null> {
  const zipfile = await openZip(buffer);
  try {
    return await findAndReadEntry(zipfile, targetPath, budget, reader);
  } finally {
    zipfile.close();
  }
}

function findAndReadEntry<T>(
  zipfile: ZipFile,
  targetPath: string,
  budget: ByteBudget,
  reader: (zipfile: ZipFile, entry: Entry, budget: ByteBudget) => Promise<T>
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    let settled = false;

    zipfile.on("entry", (entry: Entry) => {
      if (settled) return;
      if (entry.fileName === targetPath) {
        settled = true;
        reader(zipfile, entry, budget).then(resolve, reject);
        return;
      }
      zipfile.readEntry();
    });

    zipfile.on("end", () => {
      if (!settled) resolve(null);
    });

    zipfile.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    zipfile.readEntry();
  });
}

/**
 * Reads several entries in ONE pass over the zip directory.
 *
 * `readEntryFromBuffer` re-opens the zip and re-walks it from the start for
 * every single entry - fine for the 3 entries the metadata path needs, but
 * full-text extraction wants every spine document (often 100+), and a walk
 * per document is quadratic. Entries are returned keyed by their zip path;
 * callers re-impose spine order themselves (zip order is arbitrary). Missing
 * entries are simply absent from the map rather than an error - a spine that
 * references a nonexistent document is the epub's bug, not a reason to fail
 * the whole book.
 */
async function readEntriesFromBuffer(
  buffer: Buffer,
  targetPaths: Set<string>,
  budget: ByteBudget
): Promise<Map<string, Buffer>> {
  if (targetPaths.size === 0) return new Map();
  const zipfile = await openZip(buffer);
  try {
    return await collectEntries(zipfile, targetPaths, budget);
  } finally {
    zipfile.close();
  }
}

function collectEntries(
  zipfile: ZipFile,
  targetPaths: Set<string>,
  budget: ByteBudget
): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const found = new Map<string, Buffer>();
    let settled = false;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    zipfile.on("entry", (entry: Entry) => {
      if (settled) return;
      if (!targetPaths.has(entry.fileName)) {
        zipfile.readEntry();
        return;
      }
      readEntryBuffer(zipfile, entry, budget).then((buf) => {
        if (settled) return;
        found.set(entry.fileName, buf);
        // Stop early once every wanted entry is in hand - no need to walk
        // the (image-heavy, and therefore long) rest of the directory.
        if (found.size === targetPaths.size) {
          settled = true;
          resolve(found);
          return;
        }
        zipfile.readEntry();
      }, fail);
    });

    zipfile.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(found);
      }
    });

    zipfile.on("error", fail);

    zipfile.readEntry();
  });
}

/**
 * Reads a zip entry's full content into a Buffer, enforcing the shared
 * zip-bomb byte budget while streaming (aborts mid-stream, not after the
 * fact, the moment the remaining budget goes negative).
 */
function readEntryBuffer(zipfile: ZipFile, entry: Entry, budget: ByteBudget): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, readStream) => {
      if (err || !readStream) return reject(err ?? new EpubParseError("Failed to open zip entry stream"));

      const chunks: Buffer[] = [];
      let aborted = false;

      readStream.on("data", (chunk: Buffer) => {
        if (aborted) return;
        budget.remaining -= chunk.length;
        if (budget.remaining < 0) {
          aborted = true;
          readStream.destroy();
          reject(new EpubTooLargeError("EPUB exceeds the maximum allowed unpacked size"));
          return;
        }
        chunks.push(chunk);
      });
      readStream.on("end", () => {
        if (!aborted) resolve(Buffer.concat(chunks));
      });
      readStream.on("error", (streamErr) => {
        if (!aborted) reject(streamErr);
      });
    });
  });
}

function readEntryText(zipfile: ZipFile, entry: Entry, budget: ByteBudget): Promise<string> {
  return readEntryBuffer(zipfile, entry, budget).then((buf) => buf.toString("utf8"));
}

function extractOpfPath(containerDoc: unknown): string | null {
  const doc = containerDoc as { container?: { rootfiles?: { rootfile?: unknown } } } | undefined;
  const rootfile = doc?.container?.rootfiles?.rootfile;
  const first = Array.isArray(rootfile) ? rootfile[0] : rootfile;
  const fullPath = (first as Record<string, unknown> | undefined)?.["@_full-path"];
  return typeof fullPath === "string" && fullPath.length > 0 ? fullPath : null;
}

function extractMetaFromOpf(opfDoc: unknown): ParsedEpubMeta {
  const doc = opfDoc as { package?: { metadata?: Record<string, unknown> } } | undefined;
  const metadata = doc?.package?.metadata;
  return {
    title: firstText(metadata?.["title"]),
    author: firstText(metadata?.["creator"]),
    language: firstText(metadata?.["language"])
  };
}

function firstText(node: unknown): string | undefined {
  const value = Array.isArray(node) ? node[0] : node;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value && typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
    const text = (value as Record<string, unknown>)["#text"];
    if (typeof text === "string") {
      const trimmed = text.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
  }
  return undefined;
}

function toArray(node: unknown): unknown[] {
  if (node === undefined || node === null) return [];
  return Array.isArray(node) ? node : [node];
}

interface CoverItemRef {
  href: string;
  mediaType: string;
}

/**
 * Locates the manifest `<item>` that represents the cover image, per either
 * EPUB variant (first match wins - whichever the file actually uses):
 * - EPUB3: an `<item>` whose `properties` attribute contains the
 *   space-separated token `cover-image` (e.g. `properties="cover-image svg"`).
 * - EPUB2 fallback: `<meta name="cover" content="ITEM_ID">` in `<metadata>`,
 *   resolved against the manifest `<item>` with matching `@_id`.
 * Returns null (no error) when no cover is declared - a normal, common case.
 */
function extractCoverItemRef(opfDoc: unknown): CoverItemRef | null {
  const doc = opfDoc as
    | { package?: { manifest?: { item?: unknown }; metadata?: Record<string, unknown> } }
    | undefined;
  const items = toArray(doc?.package?.manifest?.item);

  const epub3Item = items.find((item) => {
    const props = (item as Record<string, unknown> | undefined)?.["@_properties"];
    return typeof props === "string" && props.split(/\s+/).includes("cover-image");
  });
  const epub3Ref = itemToCoverRef(epub3Item);
  if (epub3Ref) return epub3Ref;

  const metas = toArray(doc?.package?.metadata?.["meta"]);
  const coverMeta = metas.find((m) => (m as Record<string, unknown> | undefined)?.["@_name"] === "cover");
  const coverId = (coverMeta as Record<string, unknown> | undefined)?.["@_content"];
  if (typeof coverId !== "string" || coverId.length === 0) return null;

  const epub2Item = items.find((item) => (item as Record<string, unknown> | undefined)?.["@_id"] === coverId);
  return itemToCoverRef(epub2Item);
}

function itemToCoverRef(item: unknown): CoverItemRef | null {
  if (!item || typeof item !== "object") return null;
  const href = (item as Record<string, unknown>)["@_href"];
  const mediaType = (item as Record<string, unknown>)["@_media-type"];
  if (typeof href !== "string" || href.length === 0) return null;
  return { href, mediaType: typeof mediaType === "string" && mediaType.length > 0 ? mediaType : "application/octet-stream" };
}

async function extractCover(
  fileBuffer: Buffer,
  opfPath: string,
  opfDoc: unknown,
  budget: ByteBudget
): Promise<{ data: Buffer; mediaType: string; href: string } | undefined> {
  const ref = extractCoverItemRef(opfDoc);
  if (!ref) return undefined;

  // href is relative to the OPF file's own directory, not the zip root.
  // Zip entry names always use "/" regardless of platform.
  const coverPath = path.posix.join(path.posix.dirname(opfPath), ref.href);

  const data = await readEntryFromBuffer(fileBuffer, coverPath, budget, readEntryBuffer);
  if (!data) return undefined;

  return { data, mediaType: ref.mediaType, href: ref.href };
}

// ---------------------------------------------------------------------------
// Full-text extraction (Requirements 4.6 "KI-Grundlage")
//
// Feeds the book to Claude as a cached prompt prefix for the chat feature, so
// what matters is readable prose in reading order - not fidelity to the
// original markup. Deliberately NOT built on the TOC: resolving chapter names
// properly would mean supporting both the EPUB3 nav document and the EPUB2 NCX
// (two formats, two sets of edge cases) for a label we can get almost as well
// from each document's own <title>/<h1>/<h2>.
// ---------------------------------------------------------------------------

/** Resolves a spine href (OPF-relative, possibly URL-encoded, possibly with a fragment) to a zip path. */
function resolveHref(opfPath: string, href: string): string {
  const withoutFragment = href.split("#")[0]!;
  let decoded = withoutFragment;
  try {
    // Manifest hrefs are URIs ("chapter%201.xhtml"); zip entry names are raw bytes.
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // Malformed percent-escapes: fall back to the literal href.
  }
  return path.posix.join(path.posix.dirname(opfPath), decoded);
}

/**
 * The spine's content documents, in reading order, as OPF-relative hrefs.
 * Non-XHTML items (an SVG cover page listed in the spine, say) are skipped -
 * they carry no prose. Items with no declared media-type are kept: omitting
 * the attribute is malformed but common, and skipping them could silently
 * drop the entire book.
 */
function extractSpineHrefs(opfDoc: unknown): string[] {
  const doc = opfDoc as
    | { package?: { manifest?: { item?: unknown }; spine?: { itemref?: unknown } } }
    | undefined;

  const byId = new Map<string, { href: string; mediaType: string }>();
  for (const item of toArray(doc?.package?.manifest?.item)) {
    const rec = item as Record<string, unknown> | undefined;
    const id = rec?.["@_id"];
    const href = rec?.["@_href"];
    const mediaType = rec?.["@_media-type"];
    if (typeof id !== "string" || typeof href !== "string" || href.length === 0) continue;
    byId.set(id, { href, mediaType: typeof mediaType === "string" ? mediaType : "" });
  }

  const hrefs: string[] = [];
  for (const ref of toArray(doc?.package?.spine?.itemref)) {
    const idref = (ref as Record<string, unknown> | undefined)?.["@_idref"];
    if (typeof idref !== "string") continue;
    const item = byId.get(idref);
    if (!item) continue;
    if (item.mediaType.length > 0 && !/x?html/i.test(item.mediaType)) continue;
    hrefs.push(item.href);
  }
  return hrefs;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  szlig: "ß",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü"
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Reject non-characters rather than emitting U+FFFD into the book text.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

function firstMatch(html: string, pattern: RegExp): string | undefined {
  const m = pattern.exec(html);
  if (!m || typeof m[1] !== "string") return undefined;
  // Headings can carry nested markup (<h1><span>Kapitel 1</span></h1>).
  const text = collapse(decodeEntities(m[1].replace(/<[^>]*>/g, " ")));
  return text.length > 0 ? text : undefined;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface ContentDocument {
  /**
   * Fallback label from <head><title>, used only when the body carries no
   * heading of its own - and only if it turns out to be distinctive across
   * the book (see distinctiveHeadings).
   */
  heading?: string;
  /** True when the body had an <h1>-<h6>, which `text` already carries as Markdown. */
  hasBodyHeading: boolean;
  text: string;
}

/**
 * Strips an XHTML content document down to prose.
 *
 * Regex rather than fast-xml-parser on purpose: real-world EPUB content
 * documents are frequently not well-formed XML, and a strict parse would
 * throw away a whole chapter over one unescaped ampersand. Tolerance beats
 * correctness here - the output is prose for an LLM, not a DOM.
 */
export function htmlToDocument(html: string): ContentDocument {
  const titleFallback = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);

  let text = html;
  // <head> holds <title>/<meta>/CSS - never body prose.
  text = text.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ");
  text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Vanish without a trace, like inline tags: "A<!--x-->B" renders as "AB".
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  // Newlines in the SOURCE are just whitespace in HTML - only tags may produce
  // a real line break. Flattening first is what keeps a table row (pretty-
  // printed one <td> per source line) from being torn back apart after </td>
  // has already been joined with a pipe. Cost: <pre> loses its formatting,
  // which EPUB prose can live with.
  text = text.replace(/\s+/g, " ");

  // Headings carry the book's outline, and non-fiction leans on it heavily
  // ("Hebel 1: Lehre und Betreuung" inside chapter 4). Collapsing <h2> to a
  // bare line like any paragraph threw that structure away - the level is the
  // information. Markdown keeps it, costs ~1 token per heading, and is the
  // notation the model reads most naturally.
  let hasBodyHeading = false;
  text = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_match, level: string, inner: string) => {
    // Entities stay encoded here; the global decode below handles them once.
    const label = inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (label.length === 0) return "\n";
    hasBodyHeading = true;
    // Blank line either side - the run-collapsing below trims any excess.
    return `\n\n${"#".repeat(Number(level))} ${label}\n\n`;
  });

  // Block boundaries become line breaks before the tags themselves are dropped,
  // so paragraphs don't run together into one wall of text.
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // Cells are columns, not paragraphs: a row must stay on one line. Breaking on
  // </td> tears a table's rows apart - and EPUBs use tables for layout at least
  // as often as for data, so it also orphans every list marker from its item
  // ("b)" on one line, the sentence it labels on the next).
  text = text.replace(/<\/(td|th)\s*>/gi, " | ");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|figcaption|pre)\s*>/gi, "\n");
  // Inline tags vanish without a trace, so "a<em>b</em>c" stays "abc".
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);

  text = text
    .split("\n")
    .map(tidyLine)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return titleFallback ? { heading: titleFallback, hasBodyHeading, text } : { hasBodyHeading, text };
}

/** Collapses whitespace, and tidies the cell separators left behind by a table row. */
function tidyLine(line: string): string {
  const collapsed = line.replace(/[^\S\n]+/g, " ").trim();
  if (!collapsed.includes("|")) return collapsed;
  return collapsed
    .replace(/\s*\|\s*/g, " | ")
    // Spacer cells are pure layout - "b) |  | text" carries no more than "b) | text".
    .replace(/(?: \| )+/g, " | ")
    .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
    .trim();
}

/**
 * The whole book as plain text, in spine order.
 *
 * Documents are separated by a numbered marker line carrying the chapter
 * heading where one could be found, giving the model something to cite
 * ("im dritten Kapitel...") instead of a featureless wall of prose.
 *
 * Shares the same zip-bomb byte budget as parseEpub, but exercises it far
 * harder: this decompresses every content document rather than three small
 * XML entries, so `maxUnpackedBytes` is a real ceiling here, not a formality.
 */
export async function extractFullText(fileBuffer: Buffer, maxUnpackedBytes: number): Promise<string> {
  const budget: ByteBudget = { remaining: maxUnpackedBytes };

  const containerXml = await readEntryFromBuffer(fileBuffer, "META-INF/container.xml", budget, readEntryText);
  if (!containerXml) throw new EpubParseError("EPUB has no META-INF/container.xml");

  const opfPath = extractOpfPath(safeParseXml(containerXml));
  if (!opfPath) throw new EpubParseError("EPUB container.xml declares no OPF rootfile");

  const opfXml = await readEntryFromBuffer(fileBuffer, opfPath, budget, readEntryText);
  if (!opfXml) throw new EpubParseError(`EPUB OPF file not found: ${opfPath}`);

  const hrefs = extractSpineHrefs(safeParseXml(opfXml));
  if (hrefs.length === 0) throw new EpubNoTextError("EPUB spine lists no content documents");

  // Order matters and hrefs may repeat, so keep the list; the Set is only the
  // lookup key for the single zip pass.
  const spinePaths = hrefs.map((href) => resolveHref(opfPath, href));
  const entries = await readEntriesFromBuffer(fileBuffer, new Set(spinePaths), budget);

  const docs: ContentDocument[] = [];
  for (const spinePath of spinePaths) {
    const buf = entries.get(spinePath);
    if (!buf) continue;
    const doc = htmlToDocument(buf.toString("utf8"));
    // Skips the cover page, empty title pages, and similar chrome.
    if (doc.text.length === 0) continue;
    docs.push(doc);
  }

  if (docs.length === 0) throw new EpubNoTextError("EPUB spine documents contain no readable text");

  const distinctive = distinctiveHeadings(docs);
  return docs
    .map((doc, i) => {
      // The marker is a pure anchor - the outline lives in the Markdown
      // headings inside the text, where it can carry more than one level.
      const body =
        !doc.hasBodyHeading && doc.heading && distinctive.has(doc.heading)
          ? `# ${doc.heading}\n\n${doc.text}`
          : doc.text;
      return `=== [${i + 1}] ===\n\n${body}`;
    })
    .join("\n\n");
}

/**
 * <title> fallbacks worth printing: the ones that identify a single document.
 *
 * Only consulted for documents whose body has no heading of its own. Many real
 * EPUBs give every content document the same <title> (the book's own title),
 * so the fallback yields "Die Mittagsfrau. Roman" 29 times over - pure noise in
 * front of the model, and 29 chances to mistake it for a chapter name. A label
 * that appears in more than one document identifies none of them, so it is
 * dropped. Nothing is lost: such books almost always open the document's own
 * prose with the real chapter title ("Prolog").
 */
function distinctiveHeadings(docs: ContentDocument[]): Set<string> {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    if (!doc.heading) continue;
    counts.set(doc.heading, (counts.get(doc.heading) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n === 1).map(([heading]) => heading));
}
