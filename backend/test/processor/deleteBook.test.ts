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
vi.mock("../../src/providers/x/r2.js", () => ({
  deleteObject: vi.fn()
}));

import { deleteBook } from "../../src/processor/deleteBook.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as bookFileRepo from "../../src/providers/d/bookFileRepo.js";
import * as loanRepo from "../../src/providers/d/loanRepo.js";
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
  });

  it("deletes the R2 object, book_file row(s), loan rows, then the book, in that order, and returns 204", async () => {
    const token = sign({ userId: "user-1" });
    const callOrder: string[] = [];
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookFileRepo.findByBookId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "file-1",
      bookId: "book-1",
      storageKey: "hash-1.epub",
      fileHash: "hash-1",
      sizeBytes: 2048,
      uploadedAt: "2026-01-01T00:00:00.000Z"
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
    (bookRepo.remove as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("bookRepo.remove");
    });

    const result = await deleteBook(`Bearer ${token}`, "book-1");

    expect(r2.deleteObject).toHaveBeenCalledWith("hash-1.epub");
    expect(bookFileRepo.deleteByBookId).toHaveBeenCalledWith("book-1");
    expect(loanRepo.deleteByBookId).toHaveBeenCalledWith("book-1");
    expect(bookRepo.remove).toHaveBeenCalledWith("book-1");
    expect(callOrder).toEqual([
      "r2.deleteObject",
      "bookFileRepo.deleteByBookId",
      "loanRepo.deleteByBookId",
      "bookRepo.remove"
    ]);
    expect(result).toEqual({ status: 204, body: undefined });
  });

  it("skips the R2 delete when there is no book_file row, but still cleans up the rest", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookFileRepo.findByBookId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await deleteBook(`Bearer ${token}`, "book-1");

    expect(r2.deleteObject).not.toHaveBeenCalled();
    expect(bookFileRepo.deleteByBookId).toHaveBeenCalledWith("book-1");
    expect(loanRepo.deleteByBookId).toHaveBeenCalledWith("book-1");
    expect(bookRepo.remove).toHaveBeenCalledWith("book-1");
    expect(result.status).toBe(204);
  });
});
