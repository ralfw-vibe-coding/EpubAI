import { describe, expect, it } from "vitest";
import {
  bookOutline,
  contextWindow,
  findSelection,
  CONTEXT_CHARS_PER_SIDE
} from "../../src/domain/bookTextRpu.js";

describe("bookOutline", () => {
  it("keeps spine markers and headings, drops the prose", () => {
    const text = ["=== [1] ===", "", "# Kapitel 1", "Es begann im Sommer.", "Noch mehr Prosa."].join("\n");
    expect(bookOutline(text)).toBe("=== [1] ===\n# Kapitel 1");
  });

  it("keeps every heading level, so the outline shows the book's nesting", () => {
    const text = ["=== [6] ===", "# 4. Schule", "Text", "## Hebel 1", "Text", "### Detail", "Text"].join("\n");
    expect(bookOutline(text)).toBe("=== [6] ===\n# 4. Schule\n## Hebel 1\n### Detail");
  });

  it("ignores a hash that is not a heading", () => {
    // "#hashtag" and "#1" are prose, not structure.
    const text = ["#hashtag ist kein Titel", "# Echter Titel", "Prosa # mittendrin"].join("\n");
    expect(bookOutline(text)).toBe("# Echter Titel");
  });

  it("ignores a marker line that is not one of ours", () => {
    const text = ["=== [1] ===", "=== irgendwas ===", "=== [x] ==="].join("\n");
    expect(bookOutline(text)).toBe("=== [1] ===");
  });

  it("returns empty for a book with no structure at all", () => {
    expect(bookOutline("Nur Prosa.\nUnd noch mehr.")).toBe("");
  });

  it("caps a pathological outline rather than rebuilding a big prompt", () => {
    const text = Array.from({ length: 900 }, (_, i) => `# Titel ${i}`).join("\n");
    expect(bookOutline(text).split("\n")).toHaveLength(400);
  });
});

describe("findSelection", () => {
  it("finds an exact selection", () => {
    const text = "Erster Satz. Zweiter Satz. Dritter Satz.";
    expect(findSelection(text, "Zweiter Satz")).toBe(13);
  });

  it("finds a selection whose whitespace differs from the book text", () => {
    // The crux: epub.js hands back the rendered text, complete with the source
    // file's line breaks and indentation; extractFullText has flattened them.
    const text = "Sie starrte auf den Horizont, ohne das Gefühl loswerden zu können.";
    const fromEpubJs = "starrte auf\n      den Horizont,\n   ohne das Gefühl";
    expect(findSelection(text, fromEpubJs)).toBe(4);
  });

  it("returns null when the selection is not in the book", () => {
    expect(findSelection("Erster Satz.", "kommt nicht vor")).toBeNull();
  });

  it("returns null for an empty or whitespace-only selection", () => {
    expect(findSelection("Text", "")).toBeNull();
    expect(findSelection("Text", "   \n  ")).toBeNull();
  });

  it("treats regex metacharacters in the selection as literal text", () => {
    const text = "Er fragte: Was kostet das (wirklich)? Nichts.";
    expect(findSelection(text, "das (wirklich)?")).toBe(22);
  });

  it("picks the occurrence nearest the reading position when a phrase repeats", () => {
    // "wie oben gezeigt" three times; the reader is near the end.
    const filler = "x".repeat(1000);
    const text = `${filler} wie oben gezeigt ${filler} wie oben gezeigt ${filler} wie oben gezeigt ${filler}`;
    const last = text.lastIndexOf("wie oben gezeigt");

    expect(findSelection(text, "wie oben gezeigt", 0.95)).toBe(last);
    expect(findSelection(text, "wie oben gezeigt", 0.02)).toBe(text.indexOf("wie oben gezeigt"));
  });

  it("falls back to the middle of the book when no reading position is given", () => {
    const filler = "x".repeat(1000);
    const text = `${filler} treffer ${filler} treffer ${filler}`;
    // Nearest to 0.5 * length is the second one.
    expect(findSelection(text, "treffer")).toBe(text.lastIndexOf("treffer"));
  });

  it("ignores an out-of-range reading position rather than throwing", () => {
    const text = "a treffer b";
    expect(findSelection(text, "treffer", 42)).toBe(2);
    expect(findSelection(text, "treffer", Number.NaN)).toBe(2);
  });

  it("locates a long selection by its opening", () => {
    const tail = " und so weiter".repeat(100);
    const text = `Vorspann. Der Anfang der Selektion${tail}. Nachspann.`;
    expect(findSelection(text, `Der Anfang der Selektion${tail}`)).toBe(10);
  });
});

describe("contextWindow", () => {
  const near = (marker: string, size = 400) => `${"a".repeat(size)}\n${marker}\n${"b".repeat(size)}`;

  it("returns the passage around the selection", () => {
    const text = near("Die gesuchte Stelle");
    const window = contextWindow(text, "Die gesuchte Stelle");
    expect(window).toContain("Die gesuchte Stelle");
    expect(window).toContain("aaa");
    expect(window).toContain("bbb");
  });

  it("returns null when the selection cannot be located", () => {
    // The caller must say so rather than answer from the wrong passage.
    expect(contextWindow("Ein Buch.", "steht da nicht")).toBeNull();
  });

  it("cuts at the budget even when the book has no line breaks to snap to", () => {
    // A book that is one giant paragraph must NOT drag the whole text into the
    // window - that would silently put ~$0,74 of tokens into every question.
    const filler = "wort ".repeat(20_000);
    const text = `${filler}NADEL${filler}`;
    const window = contextWindow(text, "NADEL")!;
    expect(window.length).toBeLessThanOrEqual(2 * CONTEXT_CHARS_PER_SIDE + "NADEL".length);
    expect(window.length).toBeGreaterThan(CONTEXT_CHARS_PER_SIDE);
  });

  it("clamps at the start of the book instead of shrinking the window", () => {
    const text = `NADEL\n${"b".repeat(50_000)}`;
    const window = contextWindow(text, "NADEL")!;
    expect(window.startsWith("NADEL")).toBe(true);
    expect(window.length).toBeGreaterThan(CONTEXT_CHARS_PER_SIDE);
  });

  it("clamps at the end of the book", () => {
    const text = `${"a".repeat(50_000)}\nNADEL`;
    const window = contextWindow(text, "NADEL")!;
    expect(window.endsWith("NADEL")).toBe(true);
  });

  it("returns the whole of a book shorter than the window", () => {
    const text = "=== [1] ===\n\n# Kapitel\n\nEin sehr kurzes Buch mit NADEL drin.";
    expect(contextWindow(text, "NADEL")).toBe(text.trim());
  });

  it("opens and closes on line boundaries, never mid-line", () => {
    const line = `${"x".repeat(300)}\n`;
    const text = line.repeat(80) + "NADEL hier\n" + line.repeat(80);
    const window = contextWindow(text, "NADEL hier")!;
    // Every line of the window is a whole line of the book.
    for (const l of window.split("\n")) {
      expect(l === "NADEL hier" || l === "x".repeat(300)).toBe(true);
    }
  });

  it("keeps the surrounding structure markers inside the window", () => {
    // This is what lets the model place the passage against the outline.
    const text = `=== [6] ===\n\n# 4. Schule und Hochschule\n\n## Hebel 2\n\nDie NADEL steckt hier.`;
    const window = contextWindow(text, "Die NADEL steckt hier.")!;
    expect(window).toContain("=== [6] ===");
    expect(window).toContain("## Hebel 2");
  });
});
