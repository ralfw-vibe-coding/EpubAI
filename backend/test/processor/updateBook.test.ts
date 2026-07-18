import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn(),
  update: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  getPresignedUrl: vi.fn()
}));

import { updateBook } from "../../src/processor/updateBook.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
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

describe("updateBook reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await updateBook(undefined, "book-1", { title: "New" });
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await updateBook(`Bearer ${token}`, "missing-book", { title: "New" });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(bookRepo.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "someone-else" }));

    const result = await updateBook(`Bearer ${token}`, "book-1", { title: "New" });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(bookRepo.update).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty title, never touching update", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await updateBook(`Bearer ${token}`, "book-1", { title: "   " });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(bookRepo.update).not.toHaveBeenCalled();
  });

  it("returns 400 when tags are not all strings", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await updateBook(`Bearer ${token}`, "book-1", { tags: ["ok", 5] });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(bookRepo.update).not.toHaveBeenCalled();
  });

  it("updates only the provided fields and returns the new summary", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBook({ title: "New Title", tags: ["x", "y"] })
    );

    const result = await updateBook(`Bearer ${token}`, "book-1", { title: "  New Title  ", tags: ["x", "y"] });

    expect(bookRepo.update).toHaveBeenCalledWith("book-1", { title: "New Title", tags: ["x", "y"] });
    expect(result).toEqual({
      status: 200,
      body: {
        id: "book-1",
        title: "New Title",
        author: "A",
        tags: ["x", "y"],
        coverUrl: null,
        fileHash: "hash-1",
        processingStatus: "ready",
        hasDossier: false,
        aiCostUsd: 0
      }
    });
  });

  it("resolves a presigned coverUrl when the updated book has a cover storage key", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBook({ coverUrl: "hash-1-cover.jpg" })
    );
    (r2.getPresignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue("https://example.com/presigned");

    const result = await updateBook(`Bearer ${token}`, "book-1", { title: "New Title" });

    expect(r2.getPresignedUrl).toHaveBeenCalledWith("hash-1-cover.jpg");
    expect((result.body as { coverUrl: string }).coverUrl).toBe("https://example.com/presigned");
  });

  it("leaves fields untouched when omitted from the request body", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    await updateBook(`Bearer ${token}`, "book-1", {});

    expect(bookRepo.update).toHaveBeenCalledWith("book-1", {});
  });
});
