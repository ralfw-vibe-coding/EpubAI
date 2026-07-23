import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  getText: vi.fn()
}));

import { getDossier } from "../../src/processor/getDossier.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as r2 from "../../src/providers/x/r2.js";
import { sign } from "../../src/providers/x/jwt.js";
import type { Book } from "../../src/domain/types.js";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

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
    dossierUploadedAt: "2026-01-02T00:00:00.000Z",
    aiCostUsd: 0,
    archivedAt: null,
    originalFilename: null,
    dossierCostUsd: 0,
    ...overrides
  };
}

const token = () => `Bearer ${sign({ userId: "user-1" })}`;

describe("getDossier reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(bookRepo.findById).mockResolvedValue(makeBook());
    mocked(r2.getText).mockResolvedValue("# Dossier\n\nInhalt.");
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await getDossier(undefined, "book-1");
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    mocked(bookRepo.findById).mockResolvedValue(null);
    const result = await getDossier(token(), "missing-book");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    mocked(bookRepo.findById).mockResolvedValue(makeBook({ userId: "someone-else" }));
    const result = await getDossier(token(), "book-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("returns 404 when no dossier text exists at the expected R2 key", async () => {
    mocked(r2.getText).mockResolvedValue(null);
    const result = await getDossier(token(), "book-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("returns the dossier text from the book's own R2 key", async () => {
    const result = await getDossier(token(), "book-1");
    expect(r2.getText).toHaveBeenCalledWith("user-1/hash-1-dossier.txt");
    expect(result).toEqual({ status: 200, body: { text: "# Dossier\n\nInhalt." } });
  });
});
