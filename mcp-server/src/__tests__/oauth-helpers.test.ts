import { describe, it, expect } from "vitest";
import { isAllowedRedirect, safeEqual, validateClientCredentials } from "../oauth-helpers.js";

const HOSTS = ["claude.ai", "claude.com", "anthropic.com", "localhost", "127.0.0.1"];

describe("isAllowedRedirect", () => {
  it("accepts an allowlisted https host", () => {
    expect(isAllowedRedirect("https://claude.ai/callback", HOSTS)).toBe(true);
  });

  it("accepts a subdomain of an allowlisted host", () => {
    expect(isAllowedRedirect("https://www.claude.ai/cb", HOSTS)).toBe(true);
  });

  it("rejects a look-alike suffix host (the endsWith bypass)", () => {
    // "claude.ai.attacker.com" must NOT be treated as a claude.ai subdomain.
    expect(isAllowedRedirect("https://claude.ai.attacker.com/cb", HOSTS)).toBe(false);
  });

  it("rejects a prefixed look-alike host", () => {
    expect(isAllowedRedirect("https://evilclaude.ai/cb", HOSTS)).toBe(false);
  });

  it("rejects a non-allowlisted host", () => {
    expect(isAllowedRedirect("https://example.com/cb", HOSTS)).toBe(false);
  });

  it("rejects plaintext http for a non-local host", () => {
    expect(isAllowedRedirect("http://claude.ai/cb", HOSTS)).toBe(false);
  });

  it("allows http only for localhost", () => {
    expect(isAllowedRedirect("http://localhost:3000/cb", HOSTS)).toBe(true);
    expect(isAllowedRedirect("http://127.0.0.1:8080/cb", HOSTS)).toBe(true);
  });

  it("rejects malformed URLs and dangerous schemes", () => {
    expect(isAllowedRedirect("not a url", HOSTS)).toBe(false);
    expect(isAllowedRedirect("javascript:alert(1)", HOSTS)).toBe(false);
    expect(isAllowedRedirect("", HOSTS)).toBe(false);
  });

  it("rejects non-http(s) schemes on a local host too (2026-09 review, L4)", () => {
    // A local host used to skip the scheme check entirely, so these got codes.
    expect(isAllowedRedirect("javascript://localhost/%0Aalert(1)", HOSTS)).toBe(false);
    expect(isAllowedRedirect("myapp://localhost/cb", HOSTS)).toBe(false);
    expect(isAllowedRedirect("ftp://127.0.0.1/cb", HOSTS)).toBe(false);
    expect(isAllowedRedirect("https://localhost/cb", HOSTS)).toBe(true);
  });
});

describe("safeEqual", () => {
  it("compares equal and unequal strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("returns false (does not throw) for same character length, different byte length", () => {
    expect(() => safeEqual("éé", "ab")).not.toThrow();
    expect(safeEqual("éé", "ab")).toBe(false);
  });
});

describe("validateClientCredentials", () => {
  const ID = "memoria";
  const SECRET = "s3cret-value-1234567890";

  it("accepts the correct id and secret", () => {
    expect(validateClientCredentials(ID, SECRET, ID, SECRET)).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(validateClientCredentials(ID, "wrong", ID, SECRET)).toBe(false);
  });

  it("rejects a wrong id", () => {
    expect(validateClientCredentials("nope", SECRET, ID, SECRET)).toBe(false);
  });

  it("rejects an over-length secret (no timingSafeEqual throw)", () => {
    expect(validateClientCredentials(ID, SECRET + "x", ID, SECRET)).toBe(false);
  });

  it("rejects empty / null / undefined credentials", () => {
    expect(validateClientCredentials("", "", ID, SECRET)).toBe(false);
    expect(validateClientCredentials(null, undefined, ID, SECRET)).toBe(false);
    expect(validateClientCredentials(ID, undefined, ID, SECRET)).toBe(false);
  });

  it("rejects a non-ASCII secret of the right character length without throwing", () => {
    expect(validateClientCredentials(ID, "é".repeat(SECRET.length), ID, SECRET)).toBe(false);
  });

  it("treats non-string credentials as missing (String() on these would throw)", () => {
    expect(validateClientCredentials({ toString: 1 }, SECRET, ID, SECRET)).toBe(false);
    expect(validateClientCredentials(ID, [SECRET], ID, SECRET)).toBe(false);
  });
});
