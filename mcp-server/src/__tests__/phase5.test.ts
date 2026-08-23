/**
 * Phase 5 (critical-review remediation): follow-up fixes.
 *  - F4: raw archive batches per ingest cycle and rotates at a size cap
 *  - A6: sensitive meta is dropped even when content is clean
 *  - A7: fusion no longer suppresses clusters with id-less personal events
 *  - A8: calendar floor doesn't resurrect deliberately-low events
 *  - F5: low-confidence lint ignores code spans; weak hedges need 2+ hits
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { appendRawArchive, flushRawArchive, readRawArchive, rawArchiveDir } from "../collector/provenance.js";
import { IngestionPipeline } from "../collector/ingestion.js";
import { TemporalFusion } from "../collector/fusion.js";
import type { RawEvent } from "../collector/adapters/base.js";

let root: string;
let dataDir: string;
let memoriesDir: string;

function ev(over: Partial<RawEvent> = {}): RawEvent {
  return {
    id: over.id ?? `evt-${Math.random().toString(36).slice(2)}`,
    source: over.source ?? "p5-src",
    eventType: over.eventType ?? "agent_result",
    content: over.content ?? "A reasonably detailed event body well over twenty characters.",
    timestamp: over.timestamp ?? "2026-07-02T12:00:00Z",
    meta: over.meta ?? {},
    importanceEstimate: over.importanceEstimate ?? 5,
    privacyTier: over.privacyTier ?? "send",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-02T12:00:00Z"));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-p5-"));
  dataDir = path.join(root, "data");
  memoriesDir = path.join(root, "memories");
  fs.mkdirSync(memoriesDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  flushRawArchive(); // drain cross-test pending state
  vi.useRealTimers();
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
});

describe("F4: raw archive batching + rotation", () => {
  it("buffers appends and flushes them together", () => {
    const dir = path.join(rawArchiveDir(dataDir), "p5-src");
    appendRawArchive(dataDir, ev({ id: "a", content: "one" }), "one");
    appendRawArchive(dataDir, ev({ id: "b", content: "two" }), "two");
    // Nothing on disk yet — batched in memory (batch size default 20).
    expect(fs.existsSync(path.join(dir, "2026-07.jsonl"))).toBe(false);

    flushRawArchive();
    const file = fs.readFileSync(path.join(dir, "2026-07.jsonl"), "utf-8");
    expect(file.trim().split("\n")).toHaveLength(2);
  });

  it("readRawArchive folds in pending batches (read-your-writes)", () => {
    appendRawArchive(dataDir, ev({ id: "c", content: "three" }), "three");
    const recs = readRawArchive(dataDir, "p5-src");
    expect(recs.some((r) => r.id === "c")).toBe(true);
  });

  it("rotates to a new part when the current file exceeds the size cap", () => {
    const dir = path.join(rawArchiveDir(dataDir), "p5-src");
    fs.mkdirSync(dir, { recursive: true });
    // Pre-grow the base file past the 5MB default rotation cap.
    fs.writeFileSync(path.join(dir, "2026-07.jsonl"), "x".repeat(5 * 1024 * 1024 + 1));
    appendRawArchive(dataDir, ev({ id: "rot", content: "rotated record" }), "rotated record");
    flushRawArchive();
    expect(fs.existsSync(path.join(dir, "2026-07-p2.jsonl"))).toBe(true);
    const part = fs.readFileSync(path.join(dir, "2026-07-p2.jsonl"), "utf-8");
    expect(part).toContain('"id":"rot"');
  });
});

describe("A6: sensitive meta is dropped even when content is clean", () => {
  it("strips meta containing a secret-shaped value; content unaffected", async () => {
    const pipeline = new IngestionPipeline({ memoriesDir });
    const r = await pipeline.ingest([
      ev({
        content: "Perfectly ordinary meeting notes body, long enough to write.",
        meta: { from: "SSN 123-45-6789", location: "office" },
      }),
    ]);
    expect(r.written).toBe(1);
    const daily = fs.readFileSync(path.join(memoriesDir, "daily", "2026-07-02.md"), "utf-8");
    expect(daily).toContain("ordinary meeting notes");
    expect(daily).not.toContain("123-45-6789");
    expect(daily).not.toContain("From:"); // meta block dropped entirely
  });

  it("keeps innocuous meta", async () => {
    const pipeline = new IngestionPipeline({ memoriesDir });
    await pipeline.ingest([
      ev({ id: "m2", content: "Another ordinary body long enough to persist.", meta: { from: "Alice" } }),
    ]);
    const daily = fs.readFileSync(path.join(memoriesDir, "daily", "2026-07-02.md"), "utf-8");
    expect(daily).toContain("From: Alice");
  });
});

describe("A7: fusion keeps clusters with id-less personal events", () => {
  it("fuses one agent event + one id-less calendar event", () => {
    const fusion = new TemporalFusion();
    const t = "2026-07-02T12:00:00Z";
    const activities = fusion.fuse([
      ev({ id: "f1", source: "orchestrator", timestamp: t, meta: { agent_id: "agent-1" } }),
      ev({ id: "f2", source: "calendar", timestamp: t, content: "Team standup meeting body here", meta: {} }),
    ]);
    expect(activities.length).toBe(1);
  });

  it("still skips a single agent's result + metric pair", () => {
    const fusion = new TemporalFusion();
    const t = "2026-07-02T12:00:00Z";
    const activities = fusion.fuse([
      ev({ id: "g1", source: "orchestrator", timestamp: t, meta: { agent_id: "agent-1" } }),
      ev({ id: "g2", source: "orchestrator-metrics", timestamp: t, meta: { agent_id: "agent-1" } }),
    ]);
    expect(activities.length).toBe(0);
  });
});

describe("A8: calendar floor respects deliberately-low estimates", () => {
  it("does not resurrect an estimate-1 calendar event to the write threshold", async () => {
    const pipeline = new IngestionPipeline({ memoriesDir });
    const r = await pipeline.ingest([
      ev({ source: "calendar", importanceEstimate: 1, content: "Declined: cancelled meeting entry body." }),
    ]);
    expect(r.written).toBe(0);
    expect(r.outcomes[0].outcome).toBe("below_threshold");
  });

  it("still floors a normal calendar event to 4", async () => {
    const pipeline = new IngestionPipeline({ memoriesDir });
    const r = await pipeline.ingest([
      ev({ source: "calendar", importanceEstimate: 3, content: "Quarterly planning meeting with the team." }),
    ]);
    expect(r.written).toBe(1);
  });
});
