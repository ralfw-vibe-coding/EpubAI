import { describe, expect, it } from "vitest";
import { EpubTooLargeError, parseEpub } from "../../src/providers/x/epubParser.js";
import {
  buildEpubWithEpub2Cover,
  buildEpubWithEpub3Cover,
  buildEpubWithoutOpf,
  buildNotAZip,
  buildValidEpub,
  buildZipBomb,
  FAKE_COVER_BYTES
} from "./epubFixtures.js";

const MAX = 25 * 1024 * 1024;

describe("parseEpub", () => {
  it("extracts title/author/language from a well-formed epub", async () => {
    const buf = await buildValidEpub({ title: "Helgoland", author: "Carlo Rovelli", language: "en" });
    const meta = await parseEpub(buf, MAX);
    expect(meta).toEqual({ title: "Helgoland", author: "Carlo Rovelli", language: "en" });
  });

  it("leaves cover undefined (not an error) when the epub declares no cover", async () => {
    const buf = await buildValidEpub();
    const meta = await parseEpub(buf, MAX);
    expect(meta.cover).toBeUndefined();
  });

  it("extracts the cover image via the EPUB3 properties=\"cover-image\" manifest token", async () => {
    const buf = await buildEpubWithEpub3Cover({ title: "T", author: "A" });
    const meta = await parseEpub(buf, MAX);
    expect(meta.cover).toBeDefined();
    expect(meta.cover?.mediaType).toBe("image/jpeg");
    expect(meta.cover?.href).toBe("images/cover.jpg");
    expect(meta.cover?.data.equals(FAKE_COVER_BYTES)).toBe(true);
  });

  it("extracts the cover image via the EPUB2 <meta name=\"cover\"> fallback", async () => {
    const buf = await buildEpubWithEpub2Cover({ title: "T", author: "A" });
    const meta = await parseEpub(buf, MAX);
    expect(meta.cover).toBeDefined();
    expect(meta.cover?.mediaType).toBe("image/png");
    expect(meta.cover?.href).toBe("cover.png");
    expect(meta.cover?.data.equals(FAKE_COVER_BYTES)).toBe(true);
  });

  it("still extracts title/author alongside the cover", async () => {
    const buf = await buildEpubWithEpub3Cover({ title: "Helgoland", author: "Carlo Rovelli", language: "en" });
    const meta = await parseEpub(buf, MAX);
    expect(meta).toMatchObject({ title: "Helgoland", author: "Carlo Rovelli", language: "en" });
  });

  it("respects the zip-bomb byte budget when reading the cover entry too", async () => {
    const buf = await buildEpubWithEpub3Cover();
    // container.xml (251 bytes) + OPF (459 bytes) fit; the cover (27 bytes) does not.
    await expect(parseEpub(buf, 720)).rejects.toThrow(EpubTooLargeError);
  });

  it("returns empty meta when container.xml is missing", async () => {
    const buf = await buildEpubWithoutOpf();
    const meta = await parseEpub(buf, MAX);
    expect(meta).toEqual({});
  });

  it("aborts with EpubTooLargeError while streaming an oversized entry (zip-bomb guard)", async () => {
    const buf = await buildZipBomb(2_000_000); // decompresses to 2MB
    await expect(parseEpub(buf, 1_000)).rejects.toThrow(EpubTooLargeError); // 1KB budget
  });

  it("succeeds when the decompressed content fits the budget", async () => {
    const buf = await buildZipBomb(1_000);
    await expect(parseEpub(buf, MAX)).resolves.toBeDefined();
  });

  it("rejects a file that is not a zip at all", async () => {
    const buf = await buildNotAZip();
    await expect(parseEpub(buf, MAX)).rejects.toThrow();
  });
});
