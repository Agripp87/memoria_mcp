import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import {
  appendRawArchive,
  flushRawArchive,
  readRawArchive,
  rawArchiveDir,
  rawArchiveEnabled,
} from "../collector/provenance.js";
import { IngestionPipeline } from "../collector/ingestion.js";
import type { RawEvent } from "../collector/adapters/base.js";

let root: string;
let dataDir: string;
let memoriesDir: string;

function ev(over: Partial<RawEvent> = {}): RawEvent {
  return {
    id: over.id ?? "evt-1",
    source: over.source ?? "test-src",
    eventType: over.eventType ?? "agent_result",
    content: over.content ?? "A reasonably detailed event body well over twenty characters.",
    timestamp: over.timestamp ?? "2026-06-15T12:00:00Z",
    meta: over.meta ?? {},
    importanceEstimate: over.importanceEstimate ?? 5,
    privacyTier: over.privacyTier ?? "send",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-prov-"));
  dataDir = path.join(root, "data");
  memoriesDir = path.join(root, "memories");
  fs.mkdirSync(memoriesDir, { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.MEMORIA_RAW_ARCHIVE;
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
});

describe("provenance archive (P3)", () => {
  it("stores full content for send tier and is round-trippable", () => {
    appendRawArchive(dataDir, ev({ content: "full body here" }), "full body here");
    const recs = readRawArchive(dataDir, "test-src");
    expect(recs).toHaveLength(1);
    expect(recs[0].content).toBe("full body here");
    expect(recs[0].contentHash).toBeTruthy();
    expect(recs[0].privacyTier).toBe("send");
  });

  it("NEVER stores content for local-only — only the hash", () => {
    const secret = "SSN 123-45-6789";
    // safeEvent for local-only carries a redaction stub, but we assert no content at all.
    appendRawArchive(dataDir, ev({ privacyTier: "local-only", content: "[redacted]" }), secret);
    const recs = readRawArchive(dataDir, "test-src");
    expect(recs[0].content).toBeUndefined();
    // The hash is over the original, so it must not equal a hash of the stub,
    // and the raw file must not contain the secret text.
    const file = fs.readFileSync(
      path.join(rawArchiveDir(dataDir), "test-src", "2026-06.jsonl"),
      "utf-8",
    );
    expect(file).not.toContain("123-45-6789");
  });

  it("is append-only across multiple events (newest first on read)", () => {
    appendRawArchive(dataDir, ev({ id: "a", content: "one" }), "one");
    appendRawArchive(dataDir, ev({ id: "b", content: "two" }), "two");
    const recs = readRawArchive(dataDir, "test-src");
    expect(recs.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("partitions by source and month", () => {
    appendRawArchive(dataDir, ev({ source: "src-x", timestamp: "2026-05-02T00:00:00Z" }), "x");
    appendRawArchive(dataDir, ev({ source: "src-y", timestamp: "2026-06-02T00:00:00Z" }), "y");
    flushRawArchive(); // appends are batched (Phase 5) — flush before inspecting disk
    expect(fs.existsSync(path.join(rawArchiveDir(dataDir), "src-x", "2026-05.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(rawArchiveDir(dataDir), "src-y", "2026-06.jsonl"))).toBe(true);
  });

  it("rawArchiveEnabled() is on by default, off only when set to 'false'", () => {
    delete process.env.MEMORIA_RAW_ARCHIVE;
    expect(rawArchiveEnabled()).toBe(true);
    process.env.MEMORIA_RAW_ARCHIVE = "false";
    expect(rawArchiveEnabled()).toBe(false);
  });

  it("ingestion writes an archive record and a ref pointer in the daily entry", async () => {
    const pipeline = new IngestionPipeline({ memoriesDir });
    await pipeline.ingest([
      ev({ id: "trace-me", content: "An ingested fact long enough to be written." }),
    ]);

    // Archive record exists under data/raw/.
    const recs = readRawArchive(dataDir, "test-src");
    expect(recs.some((r) => r.id === "trace-me")).toBe(true);

    // Daily entry carries the provenance ref.
    const daily = fs.readFileSync(path.join(memoriesDir, "daily", "2026-06-15.md"), "utf-8");
    expect(daily).toContain("ref: test-src:trace-me");
  });
});
