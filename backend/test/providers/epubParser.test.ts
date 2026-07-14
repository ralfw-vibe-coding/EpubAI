import { describe, expect, it } from "vitest";
import { EpubTooLargeError, parseEpub } from "../../src/providers/x/epubParser.js";
import { buildEpubWithoutOpf, buildNotAZip, buildValidEpub, buildZipBomb } from "./epubFixtures.js";

const MAX = 25 * 1024 * 1024;

describe("parseEpub", () => {
  it("extracts title/author/language from a well-formed epub", async () => {
    const buf = await buildValidEpub({ title: "Helgoland", author: "Carlo Rovelli", language: "en" });
    const meta = await parseEpub(buf, MAX);
    expect(meta).toEqual({ title: "Helgoland", author: "Carlo Rovelli", language: "en" });
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
