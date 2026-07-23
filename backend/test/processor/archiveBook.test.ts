import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn(),
  setArchivedAt: vi.fn()
}));
vi.mock("../../src/providers/d/loanRepo.js", () => ({
  hasActiveLoan: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  getPresignedUrl: vi.fn()
}));

import { archiveBook } from "../../src/processor/archiveBook.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
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
    dossierUploadedAt: null,
    aiCostUsd: 0,
    archivedAt: null,
    originalFilename: null,
    dossierCostUsd: 0,
    ...overrides
  };
}

describe("archiveBook reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (loanRepo.hasActiveLoan as ReturnType<typeof vi.fn>).mockResolvedValue(false);
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await archiveBook(undefined, "book-1");
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await archiveBook(`Bearer ${token}`, "missing-book");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(bookRepo.setArchivedAt).not.toHaveBeenCalled();
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "someone-else" }));

    const result = await archiveBook(`Bearer ${token}`, "book-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(bookRepo.setArchivedAt).not.toHaveBeenCalled();
  });

  it("sets archived_at and returns the updated summary with archived: true", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookRepo.setArchivedAt as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBook({ archivedAt: "2026-01-02T00:00:00.000Z" })
    );

    const result = await archiveBook(`Bearer ${token}`, "book-1");

    expect(bookRepo.setArchivedAt).toHaveBeenCalledWith("book-1", expect.any(Date));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: "book-1", archived: true });
  });

  it("is idempotent: archiving an already-archived book is a no-op that still returns 200", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBook({ archivedAt: "2026-01-01T00:00:00.000Z" })
    );

    const result = await archiveBook(`Bearer ${token}`, "book-1");

    expect(bookRepo.setArchivedAt).not.toHaveBeenCalled();
    expect(loanRepo.hasActiveLoan).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ archived: true });
  });

  it("returns 409 book_on_loan when the book is still checked out on some device, without archiving it", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (loanRepo.hasActiveLoan as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const result = await archiveBook(`Bearer ${token}`, "book-1");

    expect(loanRepo.hasActiveLoan).toHaveBeenCalledWith("book-1");
    expect(bookRepo.setArchivedAt).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 409, body: { error: "book_on_loan" } });
  });

  it("resolves a presigned coverUrl when the book has a cover storage key", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ coverUrl: "hash-1-cover.jpg" }));
    (bookRepo.setArchivedAt as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBook({ coverUrl: "hash-1-cover.jpg", archivedAt: "2026-01-02T00:00:00.000Z" })
    );
    (r2.getPresignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue("https://example.com/presigned");

    const result = await archiveBook(`Bearer ${token}`, "book-1");

    expect(r2.getPresignedUrl).toHaveBeenCalledWith("hash-1-cover.jpg");
    expect((result.body as { coverUrl: string }).coverUrl).toBe("https://example.com/presigned");
  });
});
