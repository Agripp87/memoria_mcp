import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { classifyPrivacy, mostRestrictiveTier } from "../collector/adapters/base.js";
import { IngestionPipeline } from "../collector/ingestion.js";
import type { RawEvent } from "../collector/adapters/base.js";

describe("classifyPrivacy — value-shaped secrets (no trigger keyword)", () => {
  it("flags an OpenAI-style key", () => {
    expect(classifyPrivacy("here it is: sk-abcdEFGH1234ijklMNOP5678")).toBe("local-only");
  });
  it("flags an AWS access key id", () => {
    expect(classifyPrivacy("AKIAIOSFODNN7EXAMPLE in the config")).toBe("local-only");
  });
  it("flags a GitHub token", () => {
    expect(classifyPrivacy("token ghp_" + "a".repeat(36))).toBe("local-only");
  });
  it("flags a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
      ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ" +
      ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(classifyPrivacy(`bearer ${jwt}`)).toBe("local-only");
  });
  it("flags a PEM private key block", () => {
    expect(classifyPrivacy("-----BEGIN OPENSSH PRIVATE KEY-----\nx")).toBe("local-only");
  });
  it("flags an SSN", () => {
    expect(classifyPrivacy("ssn on file 123-45-6789")).toBe("local-only");
  });
  it("flags a Luhn-valid credit-card number", () => {
    // 4242 4242 4242 4242 is a Luhn-valid test card.
    expect(classifyPrivacy("card 4242 4242 4242 4242 exp 12/30")).toBe("local-only");
  });
  it("does NOT flag an ordinary 16-digit non-Luhn number", () => {
    expect(classifyPrivacy("order number 1234567890123456")).not.toBe("local-only");
  });
  it("still flags keyword triggers", () => {
    expect(classifyPrivacy("my password is hunter2")).toBe("local-only");
  });
  it("summarizes long benign content", () => {
    expect(classifyPrivacy("x".repeat(600))).toBe("summarize");
  });
  it("sends short benign content", () => {
    expect(classifyPrivacy("lunch at noon")).toBe("send");
  });
});

describe("mostRestrictiveTier", () => {
  it("picks the more restrictive of two tiers", () => {
    expect(mostRestrictiveTier("send", "local-only")).toBe("local-only");
    expect(mostRestrictiveTier("summarize", "send")).toBe("summarize");
    expect(mostRestrictiveTier("send", "send")).toBe("send");
    expect(mostRestrictiveTier("local-only", "summarize")).toBe("local-only");
  });
});

describe("Ingestion sink-side privacy enforcement", () => {
  let root: string;
  let memoriesDir: string;

  function dailyFile(): string {
    const today = new Date().toISOString().slice(0, 10);
    return path.join(memoriesDir, "daily", `${today}.md`);
  }
  function ev(over: Partial<RawEvent> = {}): RawEvent {
    return {
      id: over.id ?? `evt-${Math.random().toString(36).slice(2)}`,
      source: over.source ?? "test",
      eventType: "custom_entry",
      content: over.content ?? "ordinary body well over twenty characters in length here",
      timestamp: new Date().toISOString(),
      meta: over.meta ?? {},
      importanceEstimate: over.importanceEstimate ?? 5,
      privacyTier: over.privacyTier ?? "send",
    };
  }

  beforeEach(() => {
    // Pin the clock so the test's dailyFile() date and the pipeline's
    // internally-computed daily-log date can never straddle a UTC midnight
    // boundary (matches the pattern in ingestion/provenance tests).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:00:00Z"));
    root = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-privacy-"));
    memoriesDir = path.join(root, "memories");
    fs.mkdirSync(memoriesDir, { recursive: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  it("redacts a secret even when the adapter mislabeled it 'send'", async () => {
    const secret = "sk-abcdEFGH1234ijklMNOP5678";
    const pipeline = new IngestionPipeline({ memoriesDir });
    const r = await pipeline.ingest([
      ev({ content: `my api key is ${secret}`, privacyTier: "send" }),
    ]);
    expect(r.written).toBe(1);

    const written = fs.readFileSync(dailyFile(), "utf-8");
    expect(written).not.toContain(secret); // the secret must NOT be persisted
    expect(written).toContain("redacted — local-only");
    expect(written).toMatch(/privacy: local-only/);
  });

  it("truncates long 'summarize'-tier content", async () => {
    const long = "benign ".repeat(120); // ~840 chars, no secret
    const pipeline = new IngestionPipeline({ memoriesDir });
    await pipeline.ingest([ev({ content: long })]);

    const written = fs.readFileSync(dailyFile(), "utf-8");
    expect(written).toContain("[truncated for privacy]");
    // The full untruncated body must not appear.
    expect(written).not.toContain(long.trim());
  });

  it("passes ordinary short content through unredacted", async () => {
    const body = "had coffee with Sam and discussed the roadmap for next quarter";
    const pipeline = new IngestionPipeline({ memoriesDir });
    await pipeline.ingest([ev({ content: body })]);

    const written = fs.readFileSync(dailyFile(), "utf-8");
    expect(written).toContain(body);
    expect(written).toMatch(/privacy: send/);
  });
});
