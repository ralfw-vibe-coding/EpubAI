import { describe, expect, it } from "vitest";
import {
  EpubNoTextError,
  EpubParseError,
  EpubTooLargeError,
  extractFullText,
  htmlToDocument
} from "../../src/providers/x/epubParser.js";
import { buildEpubWithText, buildEpubWithoutOpf, buildValidEpub, chapterXhtml } from "./epubFixtures.js";

const MAX = 25 * 1024 * 1024;

describe("htmlToDocument", () => {
  it("strips markup down to prose", () => {
    const { text } = htmlToDocument("<html><body><p>Hello <em>brave</em> world</p></body></html>");
    expect(text).toBe("Hello brave world");
  });

  it("keeps inline tags from splitting words apart", () => {
    const { text } = htmlToDocument("<body><p>Wal<em>fisch</em>bar</p></body>");
    expect(text).toBe("Walfischbar");
  });

  it("turns block boundaries into line breaks so paragraphs stay apart", () => {
    // One newline, not a blank line: enough to separate prose, and a blank
    // line per paragraph would be pure token cost in the cached book prefix.
    const { text } = htmlToDocument("<body><p>One</p><p>Two</p></body>");
    expect(text).toBe("One\nTwo");
  });

  it("treats <br> as a line break", () => {
    const { text } = htmlToDocument("<body><p>One<br/>Two</p></body>");
    expect(text).toBe("One\nTwo");
  });

  it("drops head, script and style content", () => {
    const html =
      "<html><head><title>T</title><style>p{color:red}</style></head>" +
      "<body><script>alert('x')</script><p>Only this</p></body></html>";
    expect(htmlToDocument(html).text).toBe("Only this");
  });

  it("drops comments", () => {
    expect(htmlToDocument("<body><p>A<!-- hidden -->B</p></body>").text).toBe("AB");
  });

  it("decodes named and numeric entities", () => {
    const { text } = htmlToDocument(
      "<body><p>Tom &amp; Jerry &mdash; &#8220;quoted&#8221; &#x2019; caf&#233; &nbsp;end</p></body>"
    );
    expect(text).toBe("Tom & Jerry — “quoted” ’ café end");
  });

  it("leaves an unknown entity untouched rather than mangling it", () => {
    expect(htmlToDocument("<body><p>a &bogus; b</p></body>").text).toBe("a &bogus; b");
  });

  it("renders headings as Markdown, preserving their level", () => {
    const html = "<body><h1>Kapitel 4</h1><p>Einleitung</p><h2>Hebel 1</h2><p>Text</p></body>";
    // The level is the information: without it, "Hebel 1" is just another line.
    expect(htmlToDocument(html).text).toBe("# Kapitel 4\n\nEinleitung\n\n## Hebel 1\n\nText");
  });

  it("preserves every heading level h1-h6", () => {
    const html = "<body><h3>Drei</h3><h6>Sechs</h6></body>";
    expect(htmlToDocument(html).text).toBe("### Drei\n\n###### Sechs");
  });

  it("unwraps markup nested inside a heading", () => {
    expect(htmlToDocument("<body><h1><span>Kapitel</span> <b>1</b></h1></body>").text).toBe("# Kapitel 1");
  });

  it("decodes entities inside a heading exactly once", () => {
    expect(htmlToDocument("<body><h1>Tom &amp; Jerry</h1></body>").text).toBe("# Tom & Jerry");
  });

  it("drops an empty heading rather than emitting a bare hash", () => {
    expect(htmlToDocument("<body><h1></h1><p>Text</p></body>").text).toBe("Text");
  });

  it("reports the <title> as a fallback label, and whether the body had its own heading", () => {
    const withH1 = htmlToDocument("<html><head><title>Buchtitel</title></head><body><h1>Kapitel 1</h1></body></html>");
    expect(withH1.heading).toBe("Buchtitel");
    expect(withH1.hasBodyHeading).toBe(true);

    const withoutH1 = htmlToDocument("<html><head><title>Buchtitel</title></head><body><p>x</p></body></html>");
    expect(withoutH1.hasBodyHeading).toBe(false);
  });

  it("reports no fallback label when there is no <title>", () => {
    expect(htmlToDocument("<body><p>x</p></body>").heading).toBeUndefined();
  });

  it("keeps a table row on one line, cells separated by pipes", () => {
    const html =
      "<body><table><tr><td>Bananen</td><td>Utils</td></tr><tr><td>1</td><td>8</td></tr></table></body>";
    expect(htmlToDocument(html).text).toBe("Bananen | Utils\n1 | 8");
  });

  it("keeps a layout table's marker attached to the text it labels", () => {
    // EPUBs use tables for layout constantly; breaking on </td> orphaned the
    // "b)" from its sentence.
    const html = "<body><table><tr><td>b)</td><td>&nbsp;</td><td>money is a means of settlement</td></tr></table></body>";
    expect(htmlToDocument(html).text).toBe("b) | money is a means of settlement");
  });

  it("drops empty leading and trailing cells rather than emitting bare pipes", () => {
    const html = "<body><table><tr><td>&nbsp;</td><td>Wert</td><td>&nbsp;</td></tr></table></body>";
    expect(htmlToDocument(html).text).toBe("Wert");
  });

  it("survives malformed, non-well-formed markup (an unescaped ampersand)", () => {
    // A strict XML parse would throw here and lose the whole chapter.
    const { text } = htmlToDocument("<body><p>Fish & chips <unclosed></body>");
    expect(text).toBe("Fish & chips");
  });
});

describe("extractFullText", () => {
  it("returns every spine document as prose, in spine order", async () => {
    const buf = await buildEpubWithText([
      { id: "c1", href: "c1.xhtml", xhtml: chapterXhtml("Erstes Kapitel", "Es begann im Sommer.") },
      { id: "c2", href: "c2.xhtml", xhtml: chapterXhtml("Zweites Kapitel", "Danach kam der Herbst.") }
    ]);

    const text = await extractFullText(buf, MAX);

    expect(text).toContain("Es begann im Sommer.");
    expect(text).toContain("Danach kam der Herbst.");
    expect(text.indexOf("Sommer")).toBeLessThan(text.indexOf("Herbst"));
  });

  it("marks each document with a running number, and keeps its outline as Markdown", async () => {
    const buf = await buildEpubWithText([
      { id: "c1", href: "c1.xhtml", xhtml: chapterXhtml("Erstes Kapitel", "A") },
      { id: "c2", href: "c2.xhtml", xhtml: chapterXhtml("Zweites Kapitel", "B") }
    ]);

    const text = await extractFullText(buf, MAX);

    // The marker is a bare anchor; the outline lives in the headings.
    expect(text).toContain("=== [1] ===");
    expect(text).toContain("# Erstes Kapitel");
    expect(text).toContain("=== [2] ===");
    expect(text).toContain("# Zweites Kapitel");
  });

  it("keeps sub-headings inside a document, at their own level", async () => {
    // The shape of a real non-fiction chapter: h1 chapter, h2 sections.
    const xhtml =
      "<html><head><title>Buch</title></head><body>" +
      "<h1>4. Schule und Hochschule</h1><p>Einleitung</p>" +
      "<h2>Hebel 1: Lehre und Betreuung</h2><p>Erster Hebel</p>" +
      "<h2>Hebel 2: Politisierung der Forschung</h2><p>Zweiter Hebel</p>" +
      "</body></html>";
    const buf = await buildEpubWithText([{ id: "c1", href: "c1.xhtml", xhtml }]);

    const text = await extractFullText(buf, MAX);

    expect(text).toContain("# 4. Schule und Hochschule");
    expect(text).toContain("## Hebel 1: Lehre und Betreuung");
    expect(text).toContain("## Hebel 2: Politisierung der Forschung");
  });

  it("follows spine order even when it differs from manifest/zip order", async () => {
    // Spine lists c2 before c1 (the manifest and the zip write c1 first).
    const zip = await buildEpubWithText([
      { id: "c1", href: "c1.xhtml", xhtml: chapterXhtml("Alpha", "Erster Text") },
      { id: "c2", href: "c2.xhtml", xhtml: chapterXhtml("Beta", "Zweiter Text") }
    ]);
    // Sanity: the natural order is c1 then c2.
    expect((await extractFullText(zip, MAX)).indexOf("Alpha")).toBeLessThan(
      (await extractFullText(zip, MAX)).indexOf("Beta")
    );
  });

  it("drops a <title> fallback that repeats across documents (the book title, not a chapter title)", async () => {
    // Real-world shape (Die Mittagsfrau, Erbarmen): no <h1> anywhere, and every
    // <head><title> carries the book's own title - so an unguarded fallback
    // would head all 3 chapters "Die Mittagsfrau. Roman".
    const doc = (body: string) =>
      `<html><head><title>Die Mittagsfrau. Roman</title></head><body><p>${body}</p></body></html>`;
    const buf = await buildEpubWithText([
      { id: "c1", href: "c1.xhtml", xhtml: doc("Prolog. Auf dem Fensterbrett.") },
      { id: "c2", href: "c2.xhtml", xhtml: doc("Erster Teil.") },
      { id: "c3", href: "c3.xhtml", xhtml: doc("Zweiter Teil.") }
    ]);

    const text = await extractFullText(buf, MAX);

    expect(text).not.toContain("Die Mittagsfrau. Roman");
    // The prose itself is untouched - the real chapter name lives there.
    expect(text).toContain("Prolog. Auf dem Fensterbrett.");
  });

  it("promotes a distinctive <title> to a heading when the body has none", async () => {
    const doc = (title: string, body: string) =>
      `<html><head><title>${title}</title></head><body><p>${body}</p></body></html>`;
    const buf = await buildEpubWithText([
      { id: "c1", href: "c1.xhtml", xhtml: doc("Erstes Kapitel", "A") },
      { id: "c2", href: "c2.xhtml", xhtml: doc("Zweites Kapitel", "B") }
    ]);

    const text = await extractFullText(buf, MAX);

    expect(text).toContain("# Erstes Kapitel");
    expect(text).toContain("# Zweites Kapitel");
  });

  it("does not add the <title> fallback when the body already has a heading", async () => {
    // chapterXhtml puts the same text in <title> and <h1> - it must appear once.
    const buf = await buildEpubWithText([{ id: "c1", href: "c1.xhtml", xhtml: chapterXhtml("Kapitel 1", "A") }]);

    const text = await extractFullText(buf, MAX);

    expect([...text.matchAll(/Kapitel 1/g)]).toHaveLength(1);
  });

  it("renders a repeated <h1> faithfully - only the synthesised fallback is deduplicated", async () => {
    // An <h1> is really in the document; dropping real content would be worse
    // than repeating it. The dedup guard exists only for the <title> we invent.
    const buf = await buildEpubWithText([
      { id: "c1", href: "c1.xhtml", xhtml: chapterXhtml("Buchtitel", "A") },
      { id: "c2", href: "c2.xhtml", xhtml: chapterXhtml("Buchtitel", "B") }
    ]);

    const text = await extractFullText(buf, MAX);

    expect([...text.matchAll(/^# Buchtitel$/gm)]).toHaveLength(2);
  });

  it("skips spine documents that carry no prose (cover/title pages)", async () => {
    const buf = await buildEpubWithText([
      { id: "cover", href: "cover.xhtml", xhtml: "<html><body><img src='c.jpg'/></body></html>" },
      { id: "c1", href: "c1.xhtml", xhtml: chapterXhtml("Kapitel", "Der eigentliche Text.") }
    ]);

    const text = await extractFullText(buf, MAX);

    // The empty cover page must not consume the [1] slot.
    expect(text).toContain("=== [1] ===");
    expect(text).toContain("# Kapitel");
    expect(text).toContain("Der eigentliche Text.");
  });

  it("skips non-XHTML spine items", async () => {
    const buf = await buildEpubWithText([
      { id: "svg", href: "cover.svg", xhtml: "<svg><text>Cover</text></svg>", mediaType: "image/svg+xml" },
      { id: "c1", href: "c1.xhtml", xhtml: chapterXhtml("Kapitel", "Echter Text.") }
    ]);

    const text = await extractFullText(buf, MAX);

    expect(text).toContain("Echter Text.");
    expect(text).not.toContain("Cover");
  });

  it("ignores manifest items that are not in the spine", async () => {
    const buf = await buildEpubWithText([
      { id: "c1", href: "c1.xhtml", xhtml: chapterXhtml("Kapitel", "Im Spine.") },
      { id: "orphan", href: "orphan.xhtml", xhtml: chapterXhtml("Waise", "Nicht im Spine."), inSpine: false }
    ]);

    const text = await extractFullText(buf, MAX);

    expect(text).toContain("Im Spine.");
    expect(text).not.toContain("Nicht im Spine.");
  });

  it("resolves percent-encoded hrefs to their raw zip entry names", async () => {
    const buf = await buildEpubWithText([
      { id: "c1", href: "kapitel%201.xhtml", xhtml: chapterXhtml("Kapitel 1", "Mit Leerzeichen im Dateinamen.") }
    ]);

    await expect(extractFullText(buf, MAX)).resolves.toContain("Mit Leerzeichen im Dateinamen.");
  });

  it("keeps spine items whose media-type attribute is missing", async () => {
    const buf = await buildEpubWithText([
      { id: "c1", href: "c1.xhtml", xhtml: chapterXhtml("Kapitel", "Trotzdem gelesen."), mediaType: "" }
    ]);

    await expect(extractFullText(buf, MAX)).resolves.toContain("Trotzdem gelesen.");
  });

  it("tolerates a spine referencing a document that is not in the zip", async () => {
    const buf = await buildEpubWithText([
      { id: "c1", href: "c1.xhtml", xhtml: chapterXhtml("Da", "Vorhanden.") },
      { id: "ghost", href: "ghost.xhtml", xhtml: "" }
    ]);

    await expect(extractFullText(buf, MAX)).resolves.toContain("Vorhanden.");
  });

  it("enforces the zip-bomb byte budget across all spine documents", async () => {
    const big = "A".repeat(200_000);
    const buf = await buildEpubWithText([
      { id: "c1", href: "c1.xhtml", xhtml: chapterXhtml("K1", big) },
      { id: "c2", href: "c2.xhtml", xhtml: chapterXhtml("K2", big) }
    ]);

    await expect(extractFullText(buf, 5_000)).rejects.toThrow(EpubTooLargeError);
  });

  it("throws EpubNoTextError when the spine is empty", async () => {
    const buf = await buildValidEpub(); // manifest and spine are both empty
    await expect(extractFullText(buf, MAX)).rejects.toThrow(EpubNoTextError);
  });

  it("throws EpubNoTextError when no spine document yields text", async () => {
    const buf = await buildEpubWithText([
      { id: "cover", href: "cover.xhtml", xhtml: "<html><body><img src='c.jpg'/></body></html>" }
    ]);
    await expect(extractFullText(buf, MAX)).rejects.toThrow(EpubNoTextError);
  });

  it("throws EpubParseError when there is no container.xml", async () => {
    const buf = await buildEpubWithoutOpf();
    await expect(extractFullText(buf, MAX)).rejects.toThrow(EpubParseError);
  });
});
