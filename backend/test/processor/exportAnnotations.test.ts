import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn()
}));
vi.mock("../../src/providers/d/annotationRepo.js", () => ({
  listByBookAndUser: vi.fn()
}));

import { exportAnnotations } from "../../src/processor/exportAnnotations.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as annotationRepo from "../../src/providers/d/annotationRepo.js";
import { sign } from "../../src/providers/x/jwt.js";
import type { Annotation, Book } from "../../src/domain/types.js";

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    userId: "user-1",
    title: "Some Title",
    author: "Some Author",
    tags: [],
    coverUrl: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    currentFileHash: "hash-1",
    processingStatus: "ready",
    dossierUploadedAt: null,
    aiCostUsd: 0,
    archivedAt: null,
    originalFilename: null,
    ...overrides
  };
}

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann-1",
    bookId: "book-1",
    userId: "user-1",
    cfiRange: "cfi-1",
    excerpt: "e1",
    note: null,
    color: "accent",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("exportAnnotations reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await exportAnnotations(undefined, "book-1");
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await exportAnnotations(`Bearer ${token}`, "missing-book");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(annotationRepo.listByBookAndUser).not.toHaveBeenCalled();
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "someone-else" }));

    const result = await exportAnnotations(`Bearer ${token}`, "book-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(annotationRepo.listByBookAndUser).not.toHaveBeenCalled();
  });

  it("returns the correct export payload for the owner's annotations on this book", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (annotationRepo.listByBookAndUser as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAnnotation({ cfiRange: "cfi-1", excerpt: "e1", note: "n1", color: "yellow" }),
      makeAnnotation({ cfiRange: "cfi-2", excerpt: "e2", note: null, color: "accent" })
    ]);

    const result = await exportAnnotations(`Bearer ${token}`, "book-1");

    expect(annotationRepo.listByBookAndUser).toHaveBeenCalledWith("book-1", "user-1");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      schemaVersion: 1,
      fileHash: "hash-1",
      bookTitle: "Some Title",
      bookAuthor: "Some Author",
      annotations: [
        { cfiRange: "cfi-1", excerpt: "e1", note: "n1", color: "yellow" },
        { cfiRange: "cfi-2", excerpt: "e2", note: null, color: "accent" }
      ]
    });
    expect(typeof (result.body as { exportedAt: string }).exportedAt).toBe("string");
  });

  it("returns an empty annotations array for a book with none", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (annotationRepo.listByBookAndUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await exportAnnotations(`Bearer ${token}`, "book-1");

    expect(result.status).toBe(200);
    expect((result.body as { annotations: unknown[] }).annotations).toEqual([]);
  });
});
