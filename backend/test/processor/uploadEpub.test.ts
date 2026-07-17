import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findByUserAndHash: vi.fn(),
  insert: vi.fn()
}));
vi.mock("../../src/providers/d/bookFileRepo.js", () => ({
  insert: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  uploadObject: vi.fn(),
  putText: vi.fn(),
  getPresignedUrl: vi.fn()
}));
vi.mock("../../src/providers/x/epubParser.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/providers/x/epubParser.js")>(
    "../../src/providers/x/epubParser.js"
  );
  return { ...actual, parseEpub: vi.fn(), extractFullText: vi.fn() };
});

import { uploadEpub } from "../../src/processor/uploadEpub.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as bookFileRepo from "../../src/providers/d/bookFileRepo.js";
import * as r2 from "../../src/providers/x/r2.js";
import * as epubParser from "../../src/providers/x/epubParser.js";
import { EpubTooLargeError, EpubParseError, EpubNoTextError } from "../../src/providers/x/epubParser.js";
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
    dossierUploadedAt: null,
    ...overrides
  };
}

const buf = Buffer.from("fake epub bytes");

describe("uploadEpub reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (bookRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookFileRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue({});
    // Full-text extraction succeeds by default - individual tests override
    // this to exercise the "extraction failed, book still created" path.
    (epubParser.extractFullText as ReturnType<typeof vi.fn>).mockResolvedValue("Full book text.");
  });

  it("returns 401 without a token", async () => {
    const result = await uploadEpub(undefined, { fileBuffer: buf, filename: "book.epub" });
    expect(result.status).toBe(401);
  });

  it("returns 409 duplicate when the user already has a book with this fileHash, without touching R2, the parser or the DB", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ id: "existing-book" }));

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: "duplicate", existingBookId: "existing-book" });
    expect(epubParser.parseEpub).not.toHaveBeenCalled();
    expect(r2.uploadObject).not.toHaveBeenCalled();
    expect(bookRepo.insert).not.toHaveBeenCalled();
  });

  it("uploads the EPUB, creates the catalog entry, and returns the created book (201)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Helgoland",
      author: "Carlo Rovelli",
      language: "en"
    });
    (bookRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBook({ id: "new-book", title: "Helgoland", author: "Carlo Rovelli" })
    );

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "helgoland.epub" });

    // One R2 upload (the epub, no cover in this fixture).
    expect(r2.uploadObject).toHaveBeenCalledTimes(1);
    const [epubKey] = (r2.uploadObject as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(epubKey).toMatch(/^user-1\/[0-9a-f]{64}\.epub$/);

    // Book created with the detected metadata, no tags, no cover.
    expect(bookRepo.insert).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ title: "Helgoland", author: "Carlo Rovelli", tags: [], coverKey: null })
    );
    expect(bookFileRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: "new-book", sizeBytes: buf.length })
    );
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ id: "new-book", title: "Helgoland", coverUrl: null });
  });

  it("uploads the cover and stores its key on the book when the EPUB has one", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Helgoland",
      author: "Carlo Rovelli",
      cover: { data: Buffer.from("fake jpg bytes"), mediaType: "image/jpeg", href: "images/cover.jpg" }
    });
    (bookRepo.insert as ReturnType<typeof vi.fn>).mockImplementation(async (_userId, draft) =>
      makeBook({ id: "new-book", coverUrl: draft.coverKey })
    );
    (r2.getPresignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue("https://example.com/presigned-cover");

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "helgoland.epub" });

    expect(r2.uploadObject).toHaveBeenCalledTimes(2);
    const [coverKey, coverData, coverType] = (r2.uploadObject as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(coverKey).toMatch(/^user-1\/[0-9a-f]{64}-cover\.jpg$/);
    expect(coverData).toEqual(Buffer.from("fake jpg bytes"));
    expect(coverType).toBe("image/jpeg");

    expect(bookRepo.insert).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ coverKey: expect.stringMatching(/^user-1\/[0-9a-f]{64}-cover\.jpg$/) })
    );
    expect((result.body as { coverUrl: string }).coverUrl).toBe("https://example.com/presigned-cover");
  });

  it("derives the cover extension from the href when the media type is unknown", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "T",
      author: "A",
      cover: { data: Buffer.from("x"), mediaType: "application/octet-stream", href: "images/cover.webp" }
    });
    (bookRepo.insert as ReturnType<typeof vi.fn>).mockImplementation(async (_userId, draft) =>
      makeBook({ coverUrl: draft.coverKey })
    );
    (r2.getPresignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue("https://example.com/presigned-cover");

    await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

    const [coverKey] = (r2.uploadObject as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(coverKey).toMatch(/-cover\.webp$/);
  });

  it("creates a book with no cover (single R2 upload) when the EPUB has none", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({ title: "T", author: "A" });

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

    expect(r2.uploadObject).toHaveBeenCalledTimes(1);
    expect(r2.getPresignedUrl).not.toHaveBeenCalled();
    expect(bookRepo.insert).toHaveBeenCalledWith("user-1", expect.objectContaining({ coverKey: null }));
    expect((result.body as { coverUrl: string | null }).coverUrl).toBeNull();
  });

  it("falls back to the filename as the title when none was detected", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "My Book.epub" });

    expect(bookRepo.insert).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ title: "My Book", author: "Unknown" })
    );
  });

  it("returns 409 duplicate when a concurrent upload trips the unique index", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null) // initial duplicate check: clear
      .mockResolvedValueOnce(makeBook({ id: "race-winner" })); // re-read after the unique violation
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({ title: "T", author: "A" });
    (bookRepo.insert as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: "23505" })
    );

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: "duplicate", existingBookId: "race-winner" });
    expect(bookFileRepo.insert).not.toHaveBeenCalled();
  });

  it("returns 400 epub_too_large when the parser rejects an oversized epub", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockRejectedValue(new EpubTooLargeError("too big"));

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

    expect(result).toEqual({ status: 400, body: { error: "epub_too_large" } });
    expect(r2.uploadObject).not.toHaveBeenCalled();
    expect(bookRepo.insert).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_epub when the file cannot be parsed", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockRejectedValue(new EpubParseError("bad zip"));

    const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

    expect(result).toEqual({ status: 400, body: { error: "invalid_epub" } });
  });

  describe("full-text extraction", () => {
    it("extracts the full text and stores it at <userId>/<fileHash>.txt, creating the book as 'ready'", async () => {
      const token = sign({ userId: "user-1" });
      (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({ title: "T", author: "A" });
      (epubParser.extractFullText as ReturnType<typeof vi.fn>).mockResolvedValue("=== [1] ===\n\nChapter one.");

      const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

      expect(epubParser.extractFullText).toHaveBeenCalledWith(buf, expect.any(Number));
      expect(r2.putText).toHaveBeenCalledWith(
        expect.stringMatching(/^user-1\/[0-9a-f]{64}\.txt$/),
        "=== [1] ===\n\nChapter one."
      );
      expect(bookRepo.insert).toHaveBeenCalledWith("user-1", expect.objectContaining({ processingStatus: "ready" }));
      expect(result.status).toBe(201);
    });

    it("still creates the book (as 'failed') when extraction finds no readable text, instead of failing the upload", async () => {
      const token = sign({ userId: "user-1" });
      (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({ title: "T", author: "A" });
      (epubParser.extractFullText as ReturnType<typeof vi.fn>).mockRejectedValue(
        new EpubNoTextError("no readable text")
      );

      const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

      expect(r2.putText).not.toHaveBeenCalled();
      expect(bookRepo.insert).toHaveBeenCalledWith("user-1", expect.objectContaining({ processingStatus: "failed" }));
      expect(result.status).toBe(201);
    });

    it("still creates the book (as 'failed') when extraction reports the epub as too large", async () => {
      const token = sign({ userId: "user-1" });
      (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({ title: "T", author: "A" });
      (epubParser.extractFullText as ReturnType<typeof vi.fn>).mockRejectedValue(new EpubTooLargeError("too big"));

      const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

      expect(bookRepo.insert).toHaveBeenCalledWith("user-1", expect.objectContaining({ processingStatus: "failed" }));
      expect(result.status).toBe(201);
    });

    it("still creates the book (as 'failed') when the R2 text upload itself fails", async () => {
      const token = sign({ userId: "user-1" });
      (bookRepo.findByUserAndHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (epubParser.parseEpub as ReturnType<typeof vi.fn>).mockResolvedValue({ title: "T", author: "A" });
      (epubParser.extractFullText as ReturnType<typeof vi.fn>).mockResolvedValue("some text");
      (r2.putText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("R2 unavailable"));

      const result = await uploadEpub(`Bearer ${token}`, { fileBuffer: buf, filename: "book.epub" });

      expect(bookRepo.insert).toHaveBeenCalledWith("user-1", expect.objectContaining({ processingStatus: "failed" }));
      expect(result.status).toBe(201);
    });
  });
});
