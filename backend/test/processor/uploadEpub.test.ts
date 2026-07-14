import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findByUserAndHash: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  uploadObject: vi.fn(),
  getPresignedUrl: vi.fn()
}));
vi.mock("../../src/providers/x/epubParser.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/providers/x/epubParser.js")>(
    "../../src/providers/x/epubParser.js"
  );
  return { ...actual, parseEpub: vi.fn() };
});

import { uploadEpub } from "../../src/processor/uploadEpub.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as r2 from "../../src/providers/x/r2.js";
import * as epubParser from "../../src/providers/x/epubParser.js";
import { EpubTooLargeError, EpubParseError } from "../../src/providers/x/epubParser.js";
import { sign } from "../../src/providers/x/jwt.js";
import type { Book } from "../../src/domain/types.js";

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    userId: "user-1",
    title: "T",
    author: "A",
    tags: [],
    coverUrl: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    currentFileHash: "existing-hash",
    processingStatus: "ready",
    ...overrides
  };
}

const buf = Buffer.from("fake epub bytes");

describe("uploadEpub reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token", async () => {
    const result = await uploadEpub(undefined, { fileBuffer: buf, filename: "book.epub" });
    expect(result.status).toBe(401);
  });

  it("returns 409 duplicate when the user already has a book with this fileHash, without touching R2 or the parser", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ id: "existing-book" }));

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: "duplicate", existingBookId: "existing-book" });
    expect(epubParser.parseEpub).not.toHaveBeenCalled();
    expect(r2.uploadObject).not.toHaveBeenCalled();
  });

  it("parses metadata and uploads to R2 when there is no duplicate", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Helgoland",
      author: "Carlo Rovelli",
      language: "en"
    });

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "helgoland.epub" });

    expect(r2.uploadObject).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      detectedMeta: { title: "Helgoland", author: "Carlo Rovelli", language: "en" }
    });
    expect((result.body as { fileHash: string }).fileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uploads the cover to R2 and returns coverKey/coverPreviewUrl when the EPUB has a cover", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Helgoland",
      author: "Carlo Rovelli",
      language: "en",
      cover: { data: Buffer.from("fake jpg bytes"), mediaType: "image/jpeg", href: "images/cover.jpg" }
    });
    (r2.getPresignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue("https://example.com/presigned-cover");

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "helgoland.epub" });

    const fileHash = (result.body as { fileHash: string }).fileHash;
    expect(r2.uploadObject).toHaveBeenCalledTimes(2);
    expect(r2.uploadObject).toHaveBeenNthCalledWith(1, `${fileHash}.epub`, buf);
    expect(r2.uploadObject).toHaveBeenNthCalledWith(
      2,
      `${fileHash}-cover.jpg`,
      Buffer.from("fake jpg bytes"),
      "image/jpeg"
    );
    expect(r2.getPresignedUrl).toHaveBeenCalledWith(`${fileHash}-cover.jpg`);
    expect(result.body).toMatchObject({
      coverKey: `${fileHash}-cover.jpg`,
      coverPreviewUrl: "https://example.com/presigned-cover"
    });
  });

  it("derives the cover extension from the href when the media type is unknown", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "T",
      author: "A",
      cover: { data: Buffer.from("x"), mediaType: "application/octet-stream", href: "images/cover.webp" }
    });
    (r2.getPresignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue("https://example.com/presigned-cover");

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

    const fileHash = (result.body as { fileHash: string }).fileHash;
    expect(result.body).toMatchObject({ coverKey: `${fileHash}-cover.webp` });
  });

  it("omits coverKey/coverPreviewUrl entirely when the EPUB has no cover", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({ title: "T", author: "A" });

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

    expect(r2.uploadObject).toHaveBeenCalledTimes(1);
    expect(r2.getPresignedUrl).not.toHaveBeenCalled();
    expect(result.body).not.toHaveProperty("coverKey");
    expect(result.body).not.toHaveProperty("coverPreviewUrl");
  });

  it("falls back to the filename when no title was detected", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "My Book.epub" });

    expect(result.body).toMatchObject({ detectedMeta: { title: "My Book", author: "Unknown" } });
  });

  it("returns 400 epub_too_large when the parser rejects an oversized epub", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockRejectedValue(new EpubTooLargeError("too big"));

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

    expect(result).toEqual({ status: 400, body: { error: "epub_too_large" } });
    expect(r2.uploadObject).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_epub when the file cannot be parsed", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockRejectedValue(new EpubParseError("bad zip"));

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

    expect(result).toEqual({ status: 400, body: { error: "invalid_epub" } });
  });
});
