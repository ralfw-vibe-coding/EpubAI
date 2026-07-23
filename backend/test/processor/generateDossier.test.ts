import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn(),
  setDossierUploadedAt: vi.fn(),
  addDossierCost: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  putText: vi.fn(),
  getPresignedUrl: vi.fn()
}));
vi.mock("../../src/providers/x/claude.js", () => ({
  generateDossier: vi.fn()
}));
vi.mock("../../src/processor/shared/bookText.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/processor/shared/bookText.js")>();
  return { ...actual, ensureBookText: vi.fn() };
});

import { generateDossier } from "../../src/processor/generateDossier.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as r2 from "../../src/providers/x/r2.js";
import * as claude from "../../src/providers/x/claude.js";
import { ensureBookText } from "../../src/processor/shared/bookText.js";
import { sign } from "../../src/providers/x/jwt.js";
import type { Book } from "../../src/domain/types.js";
import type { TokenUsage } from "../../src/domain/aiCostRpu.js";

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
    dossierUploadedAt: null,
    aiCostUsd: 0,
    archivedAt: null,
    originalFilename: null,
    dossierCostUsd: 0,
    ...overrides
  };
}

const noUsage: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0
};

const token = () => `Bearer ${sign({ userId: "user-1" })}`;

describe("generateDossier reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(bookRepo.findById).mockResolvedValue(makeBook());
    mocked(ensureBookText).mockResolvedValue("Der komplette Buchtext.");
    mocked(claude.generateDossier).mockResolvedValue({
      text: "# Dossier\n\n1. KOPF ...",
      usage: { ...noUsage, inputTokens: 1_000_000 }
    });
    mocked(bookRepo.setDossierUploadedAt).mockResolvedValue(
      makeBook({ dossierUploadedAt: "2026-01-02T00:00:00.000Z" })
    );
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await generateDossier(undefined, "book-1");
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    mocked(bookRepo.findById).mockResolvedValue(null);
    const result = await generateDossier(token(), "missing-book");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(claude.generateDossier).not.toHaveBeenCalled();
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    mocked(bookRepo.findById).mockResolvedValue(makeBook({ userId: "someone-else" }));
    const result = await generateDossier(token(), "book-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(claude.generateDossier).not.toHaveBeenCalled();
  });

  it("returns 502 text_missing when the book has no extractable text", async () => {
    mocked(ensureBookText).mockResolvedValue(null);
    const result = await generateDossier(token(), "book-1");
    expect(result).toEqual({ status: 502, body: { error: "text_missing" } });
    expect(claude.generateDossier).not.toHaveBeenCalled();
  });

  it("returns 502 generation_failed when the Claude call throws", async () => {
    mocked(claude.generateDossier).mockRejectedValue(new Error("network down"));
    const result = await generateDossier(token(), "book-1");
    expect(result).toEqual({ status: 502, body: { error: "generation_failed" } });
    expect(r2.putText).not.toHaveBeenCalled();
    expect(bookRepo.setDossierUploadedAt).not.toHaveBeenCalled();
  });

  it("stores the generated text at the dossier key and marks it uploaded", async () => {
    await generateDossier(token(), "book-1");
    expect(r2.putText).toHaveBeenCalledWith("user-1/hash-1-dossier.txt", "# Dossier\n\n1. KOPF ...");
    expect(bookRepo.setDossierUploadedAt).toHaveBeenCalledWith("book-1", expect.any(Date));
  });

  it("passes the catalog title/author as ground truth, so Claude doesn't have to derive them from the body text", async () => {
    mocked(bookRepo.findById).mockResolvedValue(makeBook({ title: "Der dressierte Nachwuchs", author: "Meyen, Michael" }));
    await generateDossier(token(), "book-1");
    expect(claude.generateDossier).toHaveBeenCalledWith(
      "Der komplette Buchtext.",
      "Der dressierte Nachwuchs",
      "Meyen, Michael"
    );
  });

  it("computes and records the generation cost onto its own dossier_cost_usd total, not ai_cost_usd", async () => {
    await generateDossier(token(), "book-1");
    // 1M uncached input tokens at the $2/1M intro rate.
    expect(bookRepo.addDossierCost).toHaveBeenCalledWith("book-1", expect.closeTo(2.0, 6));
  });

  it("returns the fresh cumulative dossierCostUsd (re-read after addDossierCost), not the stale pre-call value", async () => {
    mocked(bookRepo.findById)
      .mockResolvedValueOnce(makeBook({ dossierCostUsd: 0.1 }))
      .mockResolvedValueOnce(makeBook({ dossierCostUsd: 2.1 }));

    const result = await generateDossier(token(), "book-1");

    expect(bookRepo.findById).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(200);
    expect((result.body as { dossierCostUsd: number }).dossierCostUsd).toBe(2.1);
    expect((result.body as { generationCostUsd: number }).generationCostUsd).toBeCloseTo(2.0, 6);
  });

  it("still returns 200 when recording the cost fails (bookkeeping must not cost the reader the result)", async () => {
    mocked(bookRepo.findById)
      .mockResolvedValueOnce(makeBook())
      .mockResolvedValueOnce(makeBook({ dossierUploadedAt: "2026-01-02T00:00:00.000Z" }));
    mocked(bookRepo.addDossierCost).mockRejectedValue(new Error("db down"));

    const result = await generateDossier(token(), "book-1");

    expect(result.status).toBe(200);
    expect((result.body as { hasDossier: boolean }).hasDossier).toBe(true);
  });

  it("resolves a presigned coverUrl when the book has a cover storage key", async () => {
    mocked(bookRepo.findById)
      .mockResolvedValueOnce(makeBook({ coverUrl: "hash-1-cover.jpg" }))
      .mockResolvedValueOnce(makeBook({ coverUrl: "hash-1-cover.jpg" }));
    mocked(r2.getPresignedUrl).mockResolvedValue("https://example.com/presigned");

    const result = await generateDossier(token(), "book-1");

    expect(r2.getPresignedUrl).toHaveBeenCalledWith("hash-1-cover.jpg");
    expect((result.body as { coverUrl: string }).coverUrl).toBe("https://example.com/presigned");
  });
});
