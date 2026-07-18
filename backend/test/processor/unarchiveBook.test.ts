import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn(),
  setArchivedAt: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  getPresignedUrl: vi.fn()
}));

import { unarchiveBook } from "../../src/processor/unarchiveBook.js";
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
    archivedAt: "2026-01-01T00:00:00.000Z",
    originalFilename: null,
    ...overrides
  };
}

describe("unarchiveBook reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await unarchiveBook(undefined, "book-1");
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await unarchiveBook(`Bearer ${token}`, "missing-book");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(bookRepo.setArchivedAt).not.toHaveBeenCalled();
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "someone-else" }));

    const result = await unarchiveBook(`Bearer ${token}`, "book-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(bookRepo.setArchivedAt).not.toHaveBeenCalled();
  });

  it("clears archived_at and returns the updated summary with archived: false", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookRepo.setArchivedAt as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ archivedAt: null }));

    const result = await unarchiveBook(`Bearer ${token}`, "book-1");

    expect(bookRepo.setArchivedAt).toHaveBeenCalledWith("book-1", null);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: "book-1", archived: false });
  });

  it("is idempotent: unarchiving an already-active book is a no-op that still returns 200", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ archivedAt: null }));

    const result = await unarchiveBook(`Bearer ${token}`, "book-1");

    expect(bookRepo.setArchivedAt).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ archived: false });
  });

  it("resolves a presigned coverUrl when the book has a cover storage key", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ coverUrl: "hash-1-cover.jpg" }));
    (bookRepo.setArchivedAt as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBook({ coverUrl: "hash-1-cover.jpg", archivedAt: null })
    );
    (r2.getPresignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue("https://example.com/presigned");

    const result = await unarchiveBook(`Bearer ${token}`, "book-1");

    expect(r2.getPresignedUrl).toHaveBeenCalledWith("hash-1-cover.jpg");
    expect((result.body as { coverUrl: string }).coverUrl).toBe("https://example.com/presigned");
  });
});
