import { describe, expect, it } from "vitest";
import { LlmError, llmErrorCode } from "../../src/domain/llmFailureRpu.js";

describe("llmErrorCode", () => {
  it("benennt einen abgelaufenen Schlüssel eigens", () => {
    expect(llmErrorCode(new LlmError("unauthorized", "..."), "chat_failed")).toBe("ai_key_invalid");
  });

  it("benennt aufgebrauchtes Guthaben eigens", () => {
    expect(llmErrorCode(new LlmError("out_of_credits", "..."), "chat_failed")).toBe("ai_out_of_credits");
  });

  it("benennt eine Drosselung eigens", () => {
    expect(llmErrorCode(new LlmError("rate_limited", "..."), "chat_failed")).toBe("ai_rate_limited");
  });

  it("erfindet für einen unbestimmten Fehlschlag keine Ursache", () => {
    expect(llmErrorCode(new LlmError("unavailable", "timeout"), "chat_failed")).toBe("chat_failed");
  });

  it("lässt jeden anderen Fehler beim allgemeinen Code", () => {
    // Ein Programmierfehler irgendwo im Reactor darf nicht als Schlüsselproblem
    // erscheinen - das schickt die Fehlersuche in die falsche Richtung.
    expect(llmErrorCode(new TypeError("x is not a function"), "lookup_failed")).toBe("lookup_failed");
    expect(llmErrorCode("kein Error-Objekt", "lookup_failed")).toBe("lookup_failed");
  });
});
