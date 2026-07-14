import yauzl from "yauzl";
import type { Entry, ZipFile } from "yauzl";
import { XMLParser } from "fast-xml-parser";

// xProvider: EPUB (zip + OPF/XML) metadata extraction.
//
// Security properties (see Requirements 3.1 / 4.6):
// - Zip-bomb guard: only the small number of entries we actually need
//   (container.xml, the OPF file) are decompressed, and the decompressed byte
//   count is checked *while streaming*, not after the fact - any entry whose
//   content exceeds the remaining budget aborts immediately.
// - XXE guard: fast-xml-parser never resolves DOCTYPEs/external entities (it
//   is not libxml2-based), so no XML parser configuration can enable XXE here.

export class EpubTooLargeError extends Error {}
export class EpubParseError extends Error {}

export interface ParsedEpubMeta {
  title?: string;
  author?: string;
  language?: string;
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

  const containerXml = await readEntryFromBuffer(fileBuffer, "META-INF/container.xml", budget);
  if (!containerXml) return {};

  const opfPath = extractOpfPath(safeParseXml(containerXml));
  if (!opfPath) return {};

  const opfXml = await readEntryFromBuffer(fileBuffer, opfPath, budget);
  if (!opfXml) return {};

  return extractMetaFromOpf(safeParseXml(opfXml));
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

async function readEntryFromBuffer(
  buffer: Buffer,
  targetPath: string,
  budget: ByteBudget
): Promise<string | null> {
  const zipfile = await openZip(buffer);
  try {
    return await findAndReadEntry(zipfile, targetPath, budget);
  } finally {
    zipfile.close();
  }
}

function findAndReadEntry(zipfile: ZipFile, targetPath: string, budget: ByteBudget): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let settled = false;

    zipfile.on("entry", (entry: Entry) => {
      if (settled) return;
      if (entry.fileName === targetPath) {
        settled = true;
        readEntryText(zipfile, entry, budget).then(resolve, reject);
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

function readEntryText(zipfile: ZipFile, entry: Entry, budget: ByteBudget): Promise<string> {
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
        if (!aborted) resolve(Buffer.concat(chunks).toString("utf8"));
      });
      readStream.on("error", (streamErr) => {
        if (!aborted) reject(streamErr);
      });
    });
  });
}

function extractOpfPath(containerDoc: unknown): string | null {
  const doc = containerDoc as { container?: { rootfiles?: { rootfile?: unknown } } } | undefined;
  const rootfile = doc?.container?.rootfiles?.rootfile;
  const first = Array.isArray(rootfile) ? rootfile[0] : rootfile;
  const path = (first as Record<string, unknown> | undefined)?.["@_full-path"];
  return typeof path === "string" && path.length > 0 ? path : null;
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
