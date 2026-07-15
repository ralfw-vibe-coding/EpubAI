import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn()
}));
vi.mock("../../src/providers/d/annotationRepo.js", () => ({
  insert: vi.fn()
}));

import { createAnnotation } from "../../src/processor/createAnnotation.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as annotationRepo from "../../src/providers/d/annotationRepo.js";
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

describe("createAnnotation reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await createAnnotation(undefined, "book-1", { cfiRange: "cfi-1", excerpt: "text" });
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await createAnnotation(`Bearer ${token}`, "missing-book", {
      cfiRange: "cfi-1",
      excerpt: "text"
    });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(annotationRepo.insert).not.toHaveBeenCalled();
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "someone-else" }));

    const result = await createAnnotation(`Bearer ${token}`, "book-1", { cfiRange: "cfi-1", excerpt: "text" });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(annotationRepo.insert).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing excerpt, never touching insert", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await createAnnotation(`Bearer ${token}`, "book-1", { cfiRange: "cfi-1", excerpt: "   " });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(annotationRepo.insert).not.toHaveBeenCalled();
  });

  it("returns 400 for an excerpt over the length cap", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await createAnnotation(`Bearer ${token}`, "book-1", {
      cfiRange: "cfi-1",
      excerpt: "a".repeat(2001)
    });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
  });

  it("returns 400 for a non-string note", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await createAnnotation(`Bearer ${token}`, "book-1", {
      cfiRange: "cfi-1",
      excerpt: "text",
      note: 42
    });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
  });

  it("returns 400 for an invalid color", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await createAnnotation(`Bearer ${token}`, "book-1", {
      cfiRange: "cfi-1",
      excerpt: "text",
      color: "red"
    });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(annotationRepo.insert).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-string color", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await createAnnotation(`Bearer ${token}`, "book-1", {
      cfiRange: "cfi-1",
      excerpt: "text",
      color: 42
    });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
  });

  it("creates a highlight with no note and returns 201, defaulting color to accent", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (annotationRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "annotation-1",
      bookId: "book-1",
      userId: "user-1",
      cfiRange: "cfi-1",
      excerpt: "Some text",
      note: null,
      color: "accent",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const result = await createAnnotation(`Bearer ${token}`, "book-1", {
      cfiRange: "  cfi-1  ",
      excerpt: "  Some text  "
    });

    expect(annotationRepo.insert).toHaveBeenCalledWith("book-1", "user-1", {
      cfiRange: "cfi-1",
      excerpt: "Some text",
      note: null,
      color: "accent"
    });
    expect(result).toEqual({
      status: 201,
      body: {
        id: "annotation-1",
        bookId: "book-1",
        cfiRange: "cfi-1",
        excerpt: "Some text",
        note: null,
        color: "accent",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    });
  });

  it("creates a highlight with a note", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (annotationRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "annotation-1",
      bookId: "book-1",
      userId: "user-1",
      cfiRange: "cfi-1",
      excerpt: "Some text",
      note: "my note",
      color: "accent",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const result = await createAnnotation(`Bearer ${token}`, "book-1", {
      cfiRange: "cfi-1",
      excerpt: "Some text",
      note: "  my note  "
    });

    expect(annotationRepo.insert).toHaveBeenCalledWith("book-1", "user-1", {
      cfiRange: "cfi-1",
      excerpt: "Some text",
      note: "my note",
      color: "accent"
    });
    expect((result.body as { note: string }).note).toBe("my note");
    expect(result.status).toBe(201);
  });

  it("creates a highlight with an explicit non-default color", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (annotationRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "annotation-1",
      bookId: "book-1",
      userId: "user-1",
      cfiRange: "cfi-1",
      excerpt: "Some text",
      note: null,
      color: "purple",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const result = await createAnnotation(`Bearer ${token}`, "book-1", {
      cfiRange: "cfi-1",
      excerpt: "Some text",
      color: "purple"
    });

    expect(annotationRepo.insert).toHaveBeenCalledWith("book-1", "user-1", {
      cfiRange: "cfi-1",
      excerpt: "Some text",
      note: null,
      color: "purple"
    });
    expect((result.body as { color: string }).color).toBe("purple");
    expect(result.status).toBe(201);
  });
});
