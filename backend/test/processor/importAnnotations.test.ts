import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn()
}));
vi.mock("../../src/providers/d/annotationRepo.js", () => ({
  listByBookAndUser: vi.fn(),
  insert: vi.fn()
}));

import { importAnnotations } from "../../src/processor/importAnnotations.js";
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
    dossierCostUsd: 0,
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

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    fileHash: "hash-1",
    bookTitle: "Some Title",
    bookAuthor: "Some Author",
    exportedAt: "2026-01-01T00:00:00.000Z",
    annotations: [{ cfiRange: "cfi-1", excerpt: "e1", note: "n1", color: "yellow" }],
    ...overrides
  };
}

describe("importAnnotations reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (annotationRepo.listByBookAndUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (annotationRepo.insert as ReturnType<typeof vi.fn>).mockImplementation(
      async (bookId: string, userId: string, draft: { cfiRange: string; excerpt: string; note: string | null; color: string }) =>
        makeAnnotation({ bookId, userId, ...draft, color: draft.color as Annotation["color"] })
    );
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await importAnnotations(undefined, "book-1", validPayload());
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await importAnnotations(`Bearer ${token}`, "missing-book", validPayload());
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(annotationRepo.insert).not.toHaveBeenCalled();
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "someone-else" }));

    const result = await importAnnotations(`Bearer ${token}`, "book-1", validPayload());
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(annotationRepo.insert).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_input when the payload is not an object with an annotations array", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await importAnnotations(`Bearer ${token}`, "book-1", { not: "valid" });
    expect(result).toEqual({ status: 400, body: { error: "invalid_input" } });
    expect(annotationRepo.insert).not.toHaveBeenCalled();
  });

  it("returns 400 too_many_annotations for an oversized payload", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    const annotations = Array.from({ length: 5001 }, (_, i) => ({
      cfiRange: `cfi-${i}`,
      excerpt: "e",
      note: null,
      color: "accent"
    }));

    const result = await importAnnotations(`Bearer ${token}`, "book-1", validPayload({ annotations }));
    expect(result).toEqual({ status: 400, body: { error: "too_many_annotations" } });
    expect(annotationRepo.insert).not.toHaveBeenCalled();
  });

  it("returns 409 hash_mismatch when the payload's fileHash doesn't match the book's current content", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ currentFileHash: "hash-1" }));

    const result = await importAnnotations(`Bearer ${token}`, "book-1", validPayload({ fileHash: "different-hash" }));
    expect(result).toEqual({ status: 409, body: { error: "hash_mismatch" } });
    expect(annotationRepo.insert).not.toHaveBeenCalled();
  });

  it("imports all annotations for a matching hash and returns the correct imported/skipped counts", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await importAnnotations(
      `Bearer ${token}`,
      "book-1",
      validPayload({
        annotations: [
          { cfiRange: "cfi-1", excerpt: "e1", note: "n1", color: "yellow" },
          { cfiRange: "cfi-2", excerpt: "e2", note: null, color: "accent" }
        ]
      })
    );

    expect(annotationRepo.insert).toHaveBeenCalledTimes(2);
    expect(annotationRepo.insert).toHaveBeenCalledWith("book-1", "user-1", {
      cfiRange: "cfi-1",
      excerpt: "e1",
      note: "n1",
      color: "yellow"
    });
    expect(result).toEqual({ status: 200, body: { imported: 2, skipped: 0 } });
  });

  it("skips an annotation with an invalid color without aborting the rest of the import", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await importAnnotations(
      `Bearer ${token}`,
      "book-1",
      validPayload({
        annotations: [
          { cfiRange: "cfi-1", excerpt: "e1", note: null, color: "not-a-color" },
          { cfiRange: "cfi-2", excerpt: "e2", note: null, color: "blue" }
        ]
      })
    );

    expect(annotationRepo.insert).toHaveBeenCalledTimes(1);
    expect(annotationRepo.insert).toHaveBeenCalledWith("book-1", "user-1", {
      cfiRange: "cfi-2",
      excerpt: "e2",
      note: null,
      color: "blue"
    });
    expect(result).toEqual({ status: 200, body: { imported: 1, skipped: 1 } });
  });

  it("counts a structurally broken entry as skipped too, not just invalid-color/duplicate (skipped reconciles against the file's total)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await importAnnotations(
      `Bearer ${token}`,
      "book-1",
      validPayload({
        annotations: [
          { cfiRange: "cfi-1", excerpt: "e1", note: null, color: "blue" },
          // No cfiRange at all - dropped during shape validation, before the
          // color/dedup stage even sees it.
          { excerpt: "e2", note: null, color: "blue" }
        ]
      })
    );

    expect(annotationRepo.insert).toHaveBeenCalledTimes(1);
    // 2 submitted, 1 imported -> skipped must be 1, not 0 (which is what
    // summing invalid-color + duplicate counts alone would have reported).
    expect(result).toEqual({ status: 200, body: { imported: 1, skipped: 1 } });
  });

  it("skips annotations that already exist for this (bookId, userId) with an identical cfiRange/note/color", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (annotationRepo.listByBookAndUser as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAnnotation({ cfiRange: "cfi-1", note: "n1", color: "yellow" })
    ]);

    const result = await importAnnotations(
      `Bearer ${token}`,
      "book-1",
      validPayload({
        annotations: [
          { cfiRange: "cfi-1", excerpt: "e1", note: "n1", color: "yellow" },
          { cfiRange: "cfi-2", excerpt: "e2", note: null, color: "accent" }
        ]
      })
    );

    expect(annotationRepo.insert).toHaveBeenCalledTimes(1);
    expect(annotationRepo.insert).toHaveBeenCalledWith("book-1", "user-1", {
      cfiRange: "cfi-2",
      excerpt: "e2",
      note: null,
      color: "accent"
    });
    expect(result).toEqual({ status: 200, body: { imported: 1, skipped: 1 } });
  });

  it("re-running the same import a second time skips everything as duplicates", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    // Simulate the first import having already landed in the DB.
    (annotationRepo.listByBookAndUser as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAnnotation({ cfiRange: "cfi-1", note: "n1", color: "yellow" })
    ]);

    const result = await importAnnotations(`Bearer ${token}`, "book-1", validPayload());

    expect(annotationRepo.insert).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 200, body: { imported: 0, skipped: 1 } });
  });

  it("dedups within the same payload when it contains the same annotation twice", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await importAnnotations(
      `Bearer ${token}`,
      "book-1",
      validPayload({
        annotations: [
          { cfiRange: "cfi-1", excerpt: "e1", note: "n1", color: "yellow" },
          { cfiRange: "cfi-1", excerpt: "e1", note: "n1", color: "yellow" }
        ]
      })
    );

    expect(annotationRepo.insert).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 200, body: { imported: 1, skipped: 1 } });
  });

  it("handles an empty annotations array as a no-op import", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await importAnnotations(`Bearer ${token}`, "book-1", validPayload({ annotations: [] }));

    expect(annotationRepo.insert).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 200, body: { imported: 0, skipped: 0 } });
  });
});
