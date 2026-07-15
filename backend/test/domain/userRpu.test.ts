import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail, normalizeOtpCode } from "../../src/domain/userRpu.js";

describe("normalizeEmail", () => {
  it("trims whitespace and lowercases", () => {
    expect(normalizeEmail("  Foo@Example.COM  ")).toBe("foo@example.com");
  });

  it("is idempotent", () => {
    const once = normalizeEmail("Foo@Example.com");
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe("isValidEmail", () => {
  it("accepts a plausible email", () => {
    expect(isValidEmail("someone@example.com")).toBe(true);
  });

  it("rejects missing @", () => {
    expect(isValidEmail("someone.example.com")).toBe(false);
  });

  it("rejects missing domain dot", () => {
    expect(isValidEmail("someone@example")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });

  it("rejects strings with whitespace inside", () => {
    expect(isValidEmail("some one@example.com")).toBe(false);
  });
});

describe("normalizeOtpCode", () => {
  it("trims whitespace and uppercases", () => {
    expect(normalizeOtpCode("  ab3dxy9k  ")).toBe("AB3DXY9K");
  });

  it("is idempotent", () => {
    const once = normalizeOtpCode("Ab3dXy9k");
    expect(normalizeOtpCode(once)).toBe(once);
  });
});
