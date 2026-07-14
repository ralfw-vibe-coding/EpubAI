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
