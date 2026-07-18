import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn(),
  remove: vi.fn()
}));
vi.mock("../../src/providers/d/bookFileRepo.js", () => ({
  findByBookId: vi.fn(),
  deleteByBookId: vi.fn()
}));
vi.mock("../../src/providers/d/loanRepo.js", () => ({
  deleteByBookId: vi.fn()
}));
vi.mock("../../src/providers/d/annotationRepo.js", () => ({
  deleteByBookId: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  deleteObject: vi.fn(),
  deleteObjectsByPrefix: vi.fn()
}));

import { deleteBook } from "../../src/processor/deleteBook.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as bookFileRepo from "../../src/providers/d/bookFileRepo.js";
import * as loanRepo from "../../src/providers/d/loanRepo.js";
import * as annotationRepo from "../../src/providers/d/annotationRepo.js";
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
    dossierUploadedAt: null,
    aiCostUsd: 0,
    ...overrides
  };
}

describe("deleteBook reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await deleteBook(undefined, "book-1");
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await deleteBook(`Bearer ${token}`, "missing-book");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(bookRepo.remove).not.toHaveBeenCalled();
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "someone-else" }));

    const result = await deleteBook(`Bearer ${token}`, "book-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(bookRepo.remove).not.toHaveBeenCalled();
    expect(r2.deleteObject).not.toHaveBeenCalled();
    expect(r2.deleteObjectsByPrefix).not.toHaveBeenCalled();
  });

  it("clears the R2 storage prefix, book_file row(s), loan rows, annotation rows, then the book, in that order, and returns 204", async () => {
    const token = sign({ userId: "user-1" });
    const callOrder: string[] = [];
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookFileRepo.findByBookId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "file-1",
      bookId: "book-1",
      storageKey: "user-1/hash-1.epub",
      fileHash: "hash-1",
      sizeBytes: 2048,
      uploadedAt: "2026-01-01T00:00:00.000Z"
    });
    (r2.deleteObjectsByPrefix as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("r2.deleteObjectsByPrefix");
    });
    (r2.deleteObject as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("r2.deleteObject");
    });
    (bookFileRepo.deleteByBookId as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("bookFileRepo.deleteByBookId");
    });
    (loanRepo.deleteByBookId as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("loanRepo.deleteByBookId");
    });
    (annotationRepo.deleteByBookId as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("annotationRepo.deleteByBookId");
    });
    (bookRepo.remove as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("bookRepo.remove");
    });

    const result = await deleteBook(`Bearer ${token}`, "book-1");

    expect(r2.deleteObjectsByPrefix).toHaveBeenCalledWith("user-1/hash-1");
    expect(r2.deleteObject).toHaveBeenCalledWith("user-1/hash-1.epub");
    expect(bookFileRepo.deleteByBookId).toHaveBeenCalledWith("book-1");
    expect(loanRepo.deleteByBookId).toHaveBeenCalledWith("book-1");
    expect(annotationRepo.deleteByBookId).toHaveBeenCalledWith("book-1");
    expect(bookRepo.remove).toHaveBeenCalledWith("book-1");
    expect(callOrder).toEqual([
      "r2.deleteObjectsByPrefix",
      "r2.deleteObject",
      "bookFileRepo.deleteByBookId",
      "loanRepo.deleteByBookId",
      "annotationRepo.deleteByBookId",
      "bookRepo.remove"
    ]);
    expect(result).toEqual({ status: 204, body: undefined });
  });

  it("clears the cover via the storage prefix even when cover_url is null (the orphaned-cover fix)", async () => {
    // The exact bug: uploadEpub always uploads the cover to R2, but if the
    // book's cover_url is null/mismatched the old code left that cover behind
    // on delete. The prefix sweep must remove it regardless of cover_url.
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBook({ coverUrl: null, currentFileHash: "hash-x" })
    );
    (bookFileRepo.findByBookId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await deleteBook(`Bearer ${token}`, "book-1");

    expect(r2.deleteObjectsByPrefix).toHaveBeenCalledWith("user-1/hash-x");
    expect(result.status).toBe(204);
  });

  it("also deletes the explicitly-recorded cover key (backward-compat for root-level objects)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ coverUrl: "hash-1-cover.jpg" }));
    (bookFileRepo.findByBookId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "file-1",
      bookId: "book-1",
      storageKey: "hash-1.epub",
      fileHash: "hash-1",
      sizeBytes: 2048,
      uploadedAt: "2026-01-01T00:00:00.000Z"
    });

    const result = await deleteBook(`Bearer ${token}`, "book-1");

    expect(r2.deleteObjectsByPrefix).toHaveBeenCalledWith("user-1/hash-1");
    expect(r2.deleteObject).toHaveBeenCalledWith("hash-1.epub");
    expect(r2.deleteObject).toHaveBeenCalledWith("hash-1-cover.jpg");
    expect(result.status).toBe(204);
  });

  it("still sweeps the prefix and cleans up the DB when there is no book_file row", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookFileRepo.findByBookId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await deleteBook(`Bearer ${token}`, "book-1");

    expect(r2.deleteObjectsByPrefix).toHaveBeenCalledWith("user-1/hash-1");
    expect(r2.deleteObject).not.toHaveBeenCalled();
    expect(bookFileRepo.deleteByBookId).toHaveBeenCalledWith("book-1");
    expect(loanRepo.deleteByBookId).toHaveBeenCalledWith("book-1");
    expect(annotationRepo.deleteByBookId).toHaveBeenCalledWith("book-1");
    expect(bookRepo.remove).toHaveBeenCalledWith("book-1");
    expect(result.status).toBe(204);
  });
});
