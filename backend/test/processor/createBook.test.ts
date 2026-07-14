import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  insert: vi.fn()
}));
vi.mock("../../src/providers/d/bookFileRepo.js", () => ({
  insert: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  headObject: vi.fn(),
  getPresignedUrl: vi.fn()
}));

import { createBook } from "../../src/processor/createBook.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as bookFileRepo from "../../src/providers/d/bookFileRepo.js";
import * as r2 from "../../src/providers/x/r2.js";
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
    currentFileHash: "hash-1",
    processingStatus: "ready",
    ...overrides
  };
}

describe("createBook reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token", async () => {
    const result = await createBook(undefined, { title: "T", author: "A", fileHash: "h" });
    expect(result.status).toBe(401);
    expect(bookRepo.insert).not.toHaveBeenCalled();
  });

  it("returns 400 for missing/invalid fields", async () => {
    const token = sign({ userId: "user-1" });
    const result = await createBook(`Bearer ${token}`, { title: "T", author: "A", fileHash: "" });
    expect(result.status).toBe(400);
    expect(bookRepo.insert).not.toHaveBeenCalled();
  });

  it("creates the book, resolves the object size via R2 head, and records the BookFile row", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue({ sizeBytes: 2048 });
    (bookFileRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "file-1",
      bookId: "book-1",
      storageKey: "hash-1.epub",
      fileHash: "hash-1",
      sizeBytes: 2048,
      uploadedAt: "2026-01-01T00:00:00.000Z"
    });

    const result = await createBook(`Bearer ${token}`, { title: "  T  ", author: " A ", fileHash: "hash-1" });

    expect(bookRepo.insert).toHaveBeenCalledWith("user-1", {
      title: "T",
      author: "A",
      fileHash: "hash-1",
      tags: [],
      processingStatus: "ready",
      coverKey: null
    });
    expect(r2.headObject).toHaveBeenCalledWith("hash-1.epub");
    expect(bookFileRepo.insert).toHaveBeenCalledWith({
      bookId: "book-1",
      storageKey: "hash-1.epub",
      fileHash: "hash-1",
      sizeBytes: 2048
    });
    expect(r2.getPresignedUrl).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 201,
      body: {
        id: "book-1",
        title: "T",
        author: "A",
        tags: [],
        coverUrl: null,
        fileHash: "hash-1",
        processingStatus: "ready"
      }
    });
  });

  it("accepts a coverKey matching the fileHash prefix, stores it, and returns a presigned coverUrl", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBook({ coverUrl: "hash-1-cover.jpg" })
    );
    (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue({ sizeBytes: 2048 });
    (bookFileRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (r2.getPresignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue("https://example.com/presigned-cover");

    const result = await createBook(`Bearer ${token}`, {
      title: "T",
      author: "A",
      fileHash: "hash-1",
      coverKey: "hash-1-cover.jpg"
    });

    expect(bookRepo.insert).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ coverKey: "hash-1-cover.jpg" })
    );
    expect(r2.getPresignedUrl).toHaveBeenCalledWith("hash-1-cover.jpg");
    expect((result.body as { coverUrl: string }).coverUrl).toBe("https://example.com/presigned-cover");
  });

  it("discards a coverKey that does not match this upload's fileHash prefix (rejects a spoofed key)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue({ sizeBytes: 2048 });
    (bookFileRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await createBook(`Bearer ${token}`, {
      title: "T",
      author: "A",
      fileHash: "hash-1",
      coverKey: "someone-elses-hash-cover.jpg"
    });

    expect(bookRepo.insert).toHaveBeenCalledWith("user-1", expect.objectContaining({ coverKey: null }));
    expect(r2.getPresignedUrl).not.toHaveBeenCalled();
  });

  it("defaults sizeBytes to 0 when the R2 head lookup fails to find the object", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (bookFileRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await createBook(`Bearer ${token}`, { title: "T", author: "A", fileHash: "hash-1" });

    expect(bookFileRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ sizeBytes: 0 })
    );
  });
});
