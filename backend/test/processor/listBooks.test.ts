import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  listByUser: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  getPresignedUrl: vi.fn()
}));

import { listBooks } from "../../src/processor/listBooks.js";
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
    archivedAt: null,
    originalFilename: null,
    dossierCostUsd: 0,
    ...overrides
  };
}

describe("listBooks reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a bearer token, never touching the repo", async () => {
    const result = await listBooks(undefined);
    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(bookRepo.listByUser).not.toHaveBeenCalled();
  });

  it("returns 401 for a malformed token", async () => {
    const result = await listBooks("Bearer not-a-real-token");
    expect(result.status).toBe(401);
  });

  it("lists the caller's own books as summaries, filtered by userId from the JWT, with coverUrl null when there is no cover", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue([makeBook({ tags: ["a", "b"] })]);

    const result = await listBooks(`Bearer ${token}`);

    expect(bookRepo.listByUser).toHaveBeenCalledWith("user-1");
    expect(r2.getPresignedUrl).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 200,
      body: {
        books: [
          {
            id: "book-1",
            title: "T",
            author: "A",
            tags: ["a", "b"],
            coverUrl: null,
            fileHash: "hash-1",
            processingStatus: "ready",
            hasDossier: false,
            aiCostUsd: 0,
            archived: false,
            originalFilename: null,
            dossierCostUsd: 0
          }
        ]
      }
    });
  });

  it("resolves a presigned coverUrl per book that has a cover storage key", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeBook({ id: "book-1", coverUrl: "hash-1-cover.jpg" }),
      makeBook({ id: "book-2", coverUrl: null })
    ]);
    (r2.getPresignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue("https://example.com/presigned");

    const result = await listBooks(`Bearer ${token}`);

    expect(r2.getPresignedUrl).toHaveBeenCalledWith("hash-1-cover.jpg");
    expect(r2.getPresignedUrl).toHaveBeenCalledTimes(1);
    const books = (result.body as { books: Array<{ id: string; coverUrl: string | null }> }).books;
    expect(books.find((b) => b.id === "book-1")?.coverUrl).toBe("https://example.com/presigned");
    expect(books.find((b) => b.id === "book-2")?.coverUrl).toBeNull();
  });
});
