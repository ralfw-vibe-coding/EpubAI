import JSZip from "jszip";

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function opfXml(title: string, author: string, language: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${language}</dc:language>
  </metadata>
  <manifest/>
  <spine/>
</package>`;
}

export async function buildValidEpub(opts?: { title?: string; author?: string; language?: string }): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file(
    "OEBPS/content.opf",
    opfXml(opts?.title ?? "Test Title", opts?.author ?? "Test Author", opts?.language ?? "en")
  );
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf;
}

const FAKE_COVER_BYTES = Buffer.from("fake jpeg bytes for testing");

function opfXmlWithEpub3Cover(title: string, author: string, language: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${language}</dc:language>
  </metadata>
  <manifest>
    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
  </manifest>
  <spine/>
</package>`;
}

/**
 * Builds an EPUB3-style EPUB whose manifest declares the cover via the
 * `properties="cover-image"` token (with the OPF nested in a subdirectory,
 * so the cover href resolution has to be relative to the OPF, not zip root).
 */
export async function buildEpubWithEpub3Cover(opts?: {
  title?: string;
  author?: string;
  language?: string;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file(
    "OEBPS/content.opf",
    opfXmlWithEpub3Cover(opts?.title ?? "Test Title", opts?.author ?? "Test Author", opts?.language ?? "en")
  );
  zip.file("OEBPS/images/cover.jpg", FAKE_COVER_BYTES);
  return zip.generateAsync({ type: "nodebuffer" });
}

function opfXmlWithEpub2Cover(title: string, author: string, language: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${language}</dc:language>
    <meta name="cover" content="cover-image-id"/>
  </metadata>
  <manifest>
    <item id="cover-image-id" href="cover.png" media-type="image/png"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine/>
</package>`;
}

/**
 * Builds an EPUB2-style EPUB whose cover is declared via the
 * `<meta name="cover" content="ITEM_ID">` fallback, resolved against the
 * manifest item with matching `@_id`.
 */
export async function buildEpubWithEpub2Cover(opts?: {
  title?: string;
  author?: string;
  language?: string;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file(
    "OEBPS/content.opf",
    opfXmlWithEpub2Cover(opts?.title ?? "Test Title", opts?.author ?? "Test Author", opts?.language ?? "en")
  );
  zip.file("OEBPS/cover.png", FAKE_COVER_BYTES);
  return zip.generateAsync({ type: "nodebuffer" });
}

export { FAKE_COVER_BYTES };

export async function buildEpubWithoutOpf(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  // No META-INF/container.xml at all.
  zip.file("readme.txt", "not an epub");
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * Builds a zip whose META-INF/container.xml entry decompresses to far more
 * bytes than its compressed size suggests (classic zip-bomb shape): highly
 * repetitive content compresses extremely well under DEFLATE.
 */
export async function buildZipBomb(unpackedBytes: number): Promise<Buffer> {
  const zip = new JSZip();
  const bomb = "A".repeat(unpackedBytes);
  zip.file("META-INF/container.xml", bomb);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

export async function buildNotAZip(): Promise<Buffer> {
  return Buffer.from("this is definitely not a zip file");
}

export interface SpineDoc {
  /** Manifest id, referenced by the spine itemref. */
  id: string;
  /** OPF-relative href; the zip entry is written at OEBPS/<href>. */
  href: string;
  xhtml: string;
  mediaType?: string;
  /** Declared in the manifest but left out of the spine when false. */
  inSpine?: boolean;
}

function opfXmlWithSpine(docs: SpineDoc[]): string {
  const manifest = docs
    .map(
      (d) =>
        `    <item id="${d.id}" href="${d.href}" media-type="${d.mediaType ?? "application/xhtml+xml"}"/>`
    )
    .join("\n");
  const spine = docs
    .filter((d) => d.inSpine !== false)
    .map((d) => `    <itemref idref="${d.id}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Title</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>`;
}

/** An EPUB whose spine references real XHTML content documents. */
export async function buildEpubWithText(docs: SpineDoc[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/content.opf", opfXmlWithSpine(docs));
  for (const d of docs) {
    // href is OPF-relative and may be percent-encoded; the zip entry is not.
    zip.file(`OEBPS/${decodeURIComponent(d.href)}`, d.xhtml);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

export function chapterXhtml(heading: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${heading}</title></head>
  <body>
    <h1>${heading}</h1>
    <p>${body}</p>
  </body>
</html>`;
}
