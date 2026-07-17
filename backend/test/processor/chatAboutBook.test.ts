import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  getText: vi.fn()
}));
vi.mock("../../src/providers/x/claude.js", () => ({
  chatAboutBook: vi.fn()
}));
vi.mock("../../src/processor/shared/bookText.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/processor/shared/bookText.js")>();
  return { ...actual, ensureBookText: vi.fn() };
});

import { chatAboutBook } from "../../src/processor/chatAboutBook.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as r2 from "../../src/providers/x/r2.js";
import * as claude from "../../src/providers/x/claude.js";
import { ensureBookText } from "../../src/processor/shared/bookText.js";
import { sign } from "../../src/providers/x/jwt.js";
import type { Book } from "../../src/domain/types.js";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    userId: "user-1",
    title: "Der dressierte Nachwuchs",
    author: "Michael Meyen",
    tags: [],
    coverUrl: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    currentFileHash: "hash-1",
    processingStatus: "ready",
    ...overrides
  };
}

const BOOK_TEXT = [
  "=== [1] ===",
  "",
  "# 1. Ein Medienforscher auf Abwegen",
  "",
  "Dieser Text ist bei meinen Vorträgen gewachsen.",
  "",
  "=== [2] ===",
  "",
  "# 2. Das Problem: Herrschaft und Kontrolle",
  "",
  "Zwei Busse, sagt Mathias Bröckers."
].join("\n");

const token = () => `Bearer ${sign({ userId: "user-1" })}`;
const askAbout = (content: string) => [{ role: "user" as const, content }];

describe("chatAboutBook reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(bookRepo.findById).mockResolvedValue(makeBook());
    mocked(ensureBookText).mockResolvedValue(BOOK_TEXT);
    mocked(r2.getText).mockResolvedValue(null);
    mocked(claude.chatAboutBook).mockResolvedValue("Die Antwort.");
  });

  describe("validation", () => {
    it("rejects a missing or blank bookId", async () => {
      expect((await chatAboutBook(token(), { bookId: "", messages: askAbout("x") })).status).toBe(400);
      expect((await chatAboutBook(token(), { bookId: 42, messages: askAbout("x") })).status).toBe(400);
    });

    it("rejects an empty conversation", async () => {
      expect((await chatAboutBook(token(), { bookId: "book-1", messages: [] })).status).toBe(400);
      expect((await chatAboutBook(token(), { bookId: "book-1", messages: "nope" })).status).toBe(400);
    });

    it("rejects a turn with an unknown role or empty content", async () => {
      const bad = [{ role: "system", content: "x" }];
      expect((await chatAboutBook(token(), { bookId: "book-1", messages: bad })).status).toBe(400);

      const blank = [{ role: "user", content: "   " }];
      expect((await chatAboutBook(token(), { bookId: "book-1", messages: blank })).status).toBe(400);
    });

    it("rejects a conversation that does not open with a user turn", async () => {
      // Claude would reject it too; failing here gives a reason instead of a 502.
      const messages = [{ role: "assistant", content: "Hallo" }];
      expect((await chatAboutBook(token(), { bookId: "book-1", messages })).status).toBe(400);
      expect(claude.chatAboutBook).not.toHaveBeenCalled();
    });
  });

  describe("authorization", () => {
    it("returns 401 without a token, never touching the repo", async () => {
      const result = await chatAboutBook(undefined, { bookId: "book-1", messages: askAbout("x") });
      expect(result.status).toBe(401);
      expect(bookRepo.findById).not.toHaveBeenCalled();
    });

    it("returns 404 for a book that does not exist", async () => {
      mocked(bookRepo.findById).mockResolvedValue(null);
      const result = await chatAboutBook(token(), { bookId: "book-1", messages: askAbout("x") });
      expect(result.status).toBe(404);
    });

    it("returns 404 for another user's book, never calling Claude", async () => {
      mocked(bookRepo.findById).mockResolvedValue(makeBook({ userId: "someone-else" }));
      const result = await chatAboutBook(token(), { bookId: "book-1", messages: askAbout("x") });
      expect(result.status).toBe(404);
      expect(claude.chatAboutBook).not.toHaveBeenCalled();
    });
  });

  describe("book-wide chat (no selection)", () => {
    it("sends the outline and no excerpt", async () => {
      const result = await chatAboutBook(token(), { bookId: "book-1", messages: askAbout("Worum geht es?") });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ text: "Die Antwort.", dossierUsed: false });

      const call = mocked(claude.chatAboutBook).mock.calls[0]![0];
      expect(call.selection).toBeNull();
      expect(call.context).toBeNull();
      expect(call.outline).toContain("# 1. Ein Medienforscher auf Abwegen");
      expect(call.outline).not.toContain("Dieser Text ist bei meinen Vorträgen gewachsen.");
    });

    it("passes the book's title and author through", async () => {
      await chatAboutBook(token(), { bookId: "book-1", messages: askAbout("x") });
      const call = mocked(claude.chatAboutBook).mock.calls[0]![0];
      expect(call.title).toBe("Der dressierte Nachwuchs");
      expect(call.author).toBe("Michael Meyen");
    });
  });

  describe("chat about a selection", () => {
    it("sends the selection with the passage around it", async () => {
      await chatAboutBook(token(), {
        bookId: "book-1",
        selection: "Zwei Busse, sagt Mathias Bröckers.",
        messages: askAbout("Was meint er damit?")
      });

      const call = mocked(claude.chatAboutBook).mock.calls[0]![0];
      expect(call.selection).toBe("Zwei Busse, sagt Mathias Bröckers.");
      expect(call.context).toContain("Zwei Busse, sagt Mathias Bröckers.");
      // The window carries the structure markers, so the model can place it.
      expect(call.context).toContain("=== [2] ===");
    });

    it("reports a null context when the selection is not in the book", async () => {
      // Must not silently answer from a passage that isn't where the reader looked.
      await chatAboutBook(token(), {
        bookId: "book-1",
        selection: "Dieser Satz steht nicht im Buch.",
        messages: askAbout("x")
      });

      const call = mocked(claude.chatAboutBook).mock.calls[0]![0];
      expect(call.selection).toBe("Dieser Satz steht nicht im Buch.");
      expect(call.context).toBeNull();
    });

    it("treats a blank selection as no selection at all", async () => {
      await chatAboutBook(token(), { bookId: "book-1", selection: "   ", messages: askAbout("x") });
      expect(mocked(claude.chatAboutBook).mock.calls[0]![0].selection).toBeNull();
    });

    it("ignores a non-numeric reading position instead of failing", async () => {
      const result = await chatAboutBook(token(), {
        bookId: "book-1",
        selection: "Zwei Busse",
        progressPercent: "halb",
        messages: askAbout("x")
      });
      expect(result.status).toBe(200);
    });
  });

  describe("dossier", () => {
    it("reports dossierUsed: false and sends none when there is no dossier", async () => {
      mocked(r2.getText).mockResolvedValue(null);
      const result = await chatAboutBook(token(), { bookId: "book-1", messages: askAbout("x") });

      expect(result.body).toMatchObject({ dossierUsed: false });
      expect(mocked(claude.chatAboutBook).mock.calls[0]![0].dossier).toBeNull();
    });

    it("sends the dossier and reports dossierUsed: true when one exists", async () => {
      mocked(r2.getText).mockResolvedValue("# Dossier\n\nKernaussage: ...");
      const result = await chatAboutBook(token(), { bookId: "book-1", messages: askAbout("x") });

      expect(result.body).toMatchObject({ dossierUsed: true });
      expect(mocked(claude.chatAboutBook).mock.calls[0]![0].dossier).toContain("Kernaussage");
    });

    it("reads the dossier from the book's own prefix", async () => {
      await chatAboutBook(token(), { bookId: "book-1", messages: askAbout("x") });
      expect(r2.getText).toHaveBeenCalledWith("user-1/hash-1-dossier.txt");
    });
  });

  describe("failures", () => {
    it("returns 502 text_missing when the book has no extractable text", async () => {
      mocked(ensureBookText).mockResolvedValue(null);
      const result = await chatAboutBook(token(), { bookId: "book-1", messages: askAbout("x") });

      expect(result.status).toBe(502);
      expect(result.body).toEqual({ error: "text_missing" });
      expect(claude.chatAboutBook).not.toHaveBeenCalled();
    });

    it("returns 502 chat_failed when Claude is unreachable", async () => {
      mocked(claude.chatAboutBook).mockRejectedValue(new Error("network down"));
      const result = await chatAboutBook(token(), { bookId: "book-1", messages: askAbout("x") });

      expect(result.status).toBe(502);
      expect(result.body).toEqual({ error: "chat_failed" });
    });
  });

  it("forwards the whole conversation, since the backend keeps none of it", async () => {
    const messages = [
      { role: "user" as const, content: "Erste Frage" },
      { role: "assistant" as const, content: "Erste Antwort" },
      { role: "user" as const, content: "Nachfrage" }
    ];
    await chatAboutBook(token(), { bookId: "book-1", messages });

    expect(mocked(claude.chatAboutBook).mock.calls[0]![0].messages).toEqual(messages);
  });
});
