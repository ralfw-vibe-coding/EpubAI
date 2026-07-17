import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn(),
  setDossierUploadedAt: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  putText: vi.fn(),
  getPresignedUrl: vi.fn()
}));

import { uploadDossier } from "../../src/processor/uploadDossier.js";
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
    ...overrides
  };
}

describe("uploadDossier reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await uploadDossier(undefined, "book-1", { text: "Some dossier." });
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await uploadDossier(`Bearer ${token}`, "missing-book", { text: "Some dossier." });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(r2.putText).not.toHaveBeenCalled();
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "someone-else" }));

    const result = await uploadDossier(`Bearer ${token}`, "book-1", { text: "Some dossier." });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(r2.putText).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_input when text is missing", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await uploadDossier(`Bearer ${token}`, "book-1", { text: undefined });
    expect(result).toEqual({ status: 400, body: { error: "invalid_input" } });
    expect(r2.putText).not.toHaveBeenCalled();
    expect(bookRepo.setDossierUploadedAt).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_input when text is blank", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await uploadDossier(`Bearer ${token}`, "book-1", { text: "   " });
    expect(result).toEqual({ status: 400, body: { error: "invalid_input" } });
  });

  it("returns 400 invalid_input when text is not a string", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await uploadDossier(`Bearer ${token}`, "book-1", { text: 42 });
    expect(result).toEqual({ status: 400, body: { error: "invalid_input" } });
  });

  it("stores the dossier at <userId>/<fileHash>-dossier.txt, marks it uploaded, and returns the updated summary", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookRepo.setDossierUploadedAt as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBook({ dossierUploadedAt: "2026-01-02T00:00:00.000Z" })
    );

    const result = await uploadDossier(`Bearer ${token}`, "book-1", { text: "The author's biography." });

    expect(r2.putText).toHaveBeenCalledWith("user-1/hash-1-dossier.txt", "The author's biography.");
    expect(bookRepo.setDossierUploadedAt).toHaveBeenCalledWith("book-1", expect.any(Date));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: "book-1", hasDossier: true });
  });

  it("resolves a presigned coverUrl when the book has a cover storage key", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ coverUrl: "hash-1-cover.jpg" }));
    (bookRepo.setDossierUploadedAt as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBook({ coverUrl: "hash-1-cover.jpg", dossierUploadedAt: "2026-01-02T00:00:00.000Z" })
    );
    (r2.getPresignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue("https://example.com/presigned");

    const result = await uploadDossier(`Bearer ${token}`, "book-1", { text: "Bio." });

    expect(r2.getPresignedUrl).toHaveBeenCalledWith("hash-1-cover.jpg");
    expect((result.body as { coverUrl: string }).coverUrl).toBe("https://example.com/presigned");
  });
});
