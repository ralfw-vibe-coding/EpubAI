import { afterAll, describe, expect, it } from "vitest";
import { LlmError } from "../../src/domain/llmFailureRpu.js";

// Der Provider ist sonst ungetestet (dünner SDK-Wrapper), aber die Einordnung
// der Fehler ist echte Logik - und die Stelle, an der ein abgelaufener Schlüssel
// als "keine Verbindung" durchrutschen würde. Geprüft wird sie gegen echte
// HTTP-Antworten: fetch wird ersetzt, es geht kein Aufruf nach draußen.
//
// Der Stub wird EINMAL gesetzt, vor dem ersten Import des Providers, und pro
// Test nur innen umgeschaltet: das OpenAI-SDK greift globalThis.fetch im
// Konstruktor ab und behält diese Funktion. Ein Neuzuweisen von globalThis.fetch
// pro Test hätte der Client nie gesehen - und alle Tests hätten die Antwort des
// ersten bekommen.
let answer: () => Promise<Response>;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => answer()) as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

function respondWith(status: number, body: unknown) {
  answer = async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function failureOf(status: number, body: unknown = { error: { message: "nope" } }) {
  respondWith(status, body);
  const llm = await import("../../src/providers/x/llm.js");
  return llm.translateText("hello", "de").then(
    () => null,
    (err: unknown) => err
  );
}

describe("LLM-Fehler einordnen", () => {
  it("erkennt einen abgelaufenen oder ungültigen Schlüssel (401)", async () => {
    const err = await failureOf(401, { error: { message: "No auth credentials found" } });
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).failure).toBe("unauthorized");
    // Die Meldung muss den Grund benennen, damit das Server-Log ihn zeigt.
    expect((err as LlmError).message).toContain("rejected the API key");
  });

  it("behandelt einen gesperrten Schlüssel (403) wie einen ungültigen", async () => {
    // Anderer Grund, gleiche Konsequenz: nur der Betreiber kann das richten.
    expect(((await failureOf(403)) as LlmError).failure).toBe("unauthorized");
  });

  it("erkennt aufgebrauchtes Guthaben (402)", async () => {
    // OpenRouter-spezifisch; das OpenAI-SDK hat dafür keine eigene Klasse, das
    // kommt als schlichter APIError - deshalb wird nach Status eingeordnet.
    const err = await failureOf(402, { error: { message: "Insufficient credits" } });
    expect((err as LlmError).failure).toBe("out_of_credits");
  });

  it("erkennt eine Drosselung (429)", async () => {
    expect(((await failureOf(429)) as LlmError).failure).toBe("rate_limited");
  });

  it("lässt alles andere unbestimmt, statt eine Ursache zu erfinden", async () => {
    expect(((await failureOf(500)) as LlmError).failure).toBe("unavailable");
  });

  it("ordnet auch einen Netzfehler als unbestimmt ein, nicht als Schlüsselproblem", async () => {
    answer = async () => {
      throw new TypeError("fetch failed");
    };
    const llm = await import("../../src/providers/x/llm.js");
    const err = await llm.translateText("x", "de").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).failure).toBe("unavailable");
  });
});
