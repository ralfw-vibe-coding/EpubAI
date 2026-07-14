import { describe, expect, it } from "vitest";
import { extractBearerToken, sign, verify } from "../../src/providers/x/jwt.js";

describe("jwt provider", () => {
  it("round-trips sign/verify", () => {
    const token = sign({ userId: "user-123" });
    const session = verify(token);
    expect(session).toEqual({ userId: "user-123" });
  });

  it("rejects a tampered token", () => {
    const token = sign({ userId: "user-123" });
    const tampered = token.slice(0, -2) + "xx";
    expect(verify(tampered)).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verify("not-a-jwt")).toBeNull();
  });
});

describe("extractBearerToken", () => {
  it("extracts token from a well-formed header", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractBearerToken("bearer abc")).toBe("abc");
  });

  it("returns null when header is missing", () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it("returns null for a malformed header", () => {
    expect(extractBearerToken("Basic abc")).toBeNull();
  });
});
