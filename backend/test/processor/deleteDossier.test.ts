import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn(),
  setDossierUploadedAt: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  deleteObject: vi.fn()
}));

import { deleteDossier } from "../../src/processor/deleteDossier.js";
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
    dossierUploadedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("deleteDossier reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await deleteDossier(undefined, "book-1");
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await deleteDossier(`Bearer ${token}`, "missing-book");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(r2.deleteObject).not.toHaveBeenCalled();
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "someone-else" }));

    const result = await deleteDossier(`Bearer ${token}`, "book-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(r2.deleteObject).not.toHaveBeenCalled();
  });

  it("deletes the R2 dossier object, clears dossier_uploaded_at, and returns 204", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await deleteDossier(`Bearer ${token}`, "book-1");

    expect(r2.deleteObject).toHaveBeenCalledWith("user-1/hash-1-dossier.txt");
    expect(bookRepo.setDossierUploadedAt).toHaveBeenCalledWith("book-1", null);
    expect(result).toEqual({ status: 204, body: undefined });
  });

  it("is idempotent: still 204 when no dossier was ever uploaded", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ dossierUploadedAt: null }));

    const result = await deleteDossier(`Bearer ${token}`, "book-1");

    expect(result.status).toBe(204);
    expect(bookRepo.setDossierUploadedAt).toHaveBeenCalledWith("book-1", null);
  });
});
