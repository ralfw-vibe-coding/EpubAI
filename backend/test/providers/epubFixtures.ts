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
