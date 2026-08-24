/**
 * Phase 1 (critical-review remediation): the collector must never silently
 * lose personal data. Covers findings A1/A2/A4/A5:
 *  - per-event outcomes; only durably-handled events marked synced
 *  - rate-limited events DEFERRED (retried), not dropped
 *  - dedup/rate state recorded only after a successful write
 *  - poison events dead-lettered after the retry cap (not retried forever)
 *  - per-source fetch fairness (no head-of-line blocking)
 *  - polling backpressure near buffer capacity
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { IngestionPipeline } from "../collector/ingestion.js";
import { EventBuffer } from "../collector/buffer.js";
import { CollectorDaemon } from "../collector/daemon.js";
import { initMasterKey } from "../collector/crypto.js";
import type { RawEvent } from "../collector/adapters/base.js";

let root: string;
let memoriesDir: string;
let dataDir: string;

function ev(over: Partial<RawEvent> = {}): RawEvent {
  return {
    id: over.id ?? `evt-${Math.random().toString(36).slice(2)}`,
    source: over.source ?? "src-test",
    eventType: over.eventType ?? "agent_result",
    content: over.content ?? "A reasonably detailed event body well over twenty characters long.",
    timestamp: over.timestamp ?? new Date().toISOString(),
    meta: over.meta ?? {},
    importanceEstimate: over.importanceEstimate ?? 5,
    privacyTier: over.privacyTier ?? "send",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-02T12:00:00Z"));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-dl-"));
  memoriesDir = path.join(root, "memories");
  dataDir = path.join(root, "data");
  fs.mkdirSync(memoriesDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  initMasterKey(dataDir); // module-cached; provides a key for encrypt/decrypt
});

afterEach(() => {
  vi.useRealTimers();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
});

describe("A2: rate-limited events are deferred, not dropped", () => {
  it("reports rate_limited outcomes and writes them after the window refills", async () => {
    const pipeline = new IngestionPipeline({ memoriesDir, perSourceLimit: 2 });

    const batch = [
      ev({ id: "a", content: "first unique body long enough to be written here" }),
      ev({ id: "b", content: "second unique body long enough to be written here" }),
      ev({ id: "c", content: "third unique body long enough to be written here" }),
    ];
    const r1 = await pipeline.ingest(batch);
    expect(r1.written).toBe(2);
    expect(r1.rateLimited).toBe(1);
    expect(r1.outcomes.find((o) => o.id === "c")?.outcome).toBe("rate_limited");

    // The deferred event was NOT recorded as seen: after the 60s window
    // refills, re-ingesting it succeeds (no dedup poisoning, budget refilled).
    vi.advanceTimersByTime(61_000);
    const r2 = await pipeline.ingest([batch[2]]);
    expect(r2.written).toBe(1);
    expect(r2.outcomes[0].outcome).toBe("written");
  });
});

describe("A5: dedup/rate state only mutates after a successful write", () => {
  it("a failed write does not poison the retry", async () => {
    // Make the daily-log write fail by planting a FILE where the daily/
    // directory must go: mkdirSync(daily) throws ENOTDIR/EEXIST.
    fs.writeFileSync(path.join(memoriesDir, "daily"), "not a dir", "utf-8");

    const pipeline = new IngestionPipeline({ memoriesDir });
    const event = ev({
      id: "retry-me",
      content: "a body that will fail to persist on the first try",
    });

    const r1 = await pipeline.ingest([event]);
    expect(r1.written).toBe(0);
    expect(r1.outcomes[0].outcome).toBe("error");

    // Clear the obstruction; the SAME event must now write — if dedup state had
    // been recorded before the failed write, this would be skipped as duplicate.
    fs.rmSync(path.join(memoriesDir, "daily"));
    const r2 = await pipeline.ingest([event]);
    expect(r2.written).toBe(1);
    expect(r2.outcomes[0].outcome).toBe("written");
  });
});

describe("A1: only durably-handled events are marked synced (daemon path)", () => {
  function makeDaemon(buffer: EventBuffer, handler: (events: RawEvent[]) => Promise<any>) {
    // Minimal registry stub — ingestion cycles don't touch the registry.
    const registry = { getActiveAdapters: () => new Map(), saveCheckpoints: () => {} } as any;
    const daemon = new CollectorDaemon(registry, buffer, { maxIngestAttempts: 3 });
    daemon.onIngestion(handler);
    return daemon;
  }

  it("leaves rate-limited events unsynced and dead-letters poison events after 3 attempts", async () => {
    const buffer = new EventBuffer(dataDir);
    await buffer.init();

    buffer.pushBatch([
      ev({ id: "ok", source: "s1", content: "fine event body" }),
      ev({ id: "limited", source: "s1", content: "deferred event body" }),
      ev({ id: "poison", source: "s1", content: "always failing event body" }),
    ]);

    const outcomesFor = (events: RawEvent[]) => ({
      processed: events.length,
      written: 0,
      deduplicated: 0,
      rateLimited: 0,
      errors: [],
      writtenSources: [],
      outcomes: events.map((e) => ({
        id: e.id,
        source: e.source,
        outcome: e.id === "ok" ? "written" : e.id === "limited" ? "rate_limited" : "error",
      })),
    });
    const daemon = makeDaemon(buffer, async (events) => outcomesFor(events));

    // Cycle 1: ok → synced; limited → unsynced; poison → attempt 1.
    await daemon.runIngestionOnce();
    let stats = buffer.getStats();
    expect(stats.syncedEvents).toBe(1);
    expect(stats.unsyncedEvents).toBe(2);
    expect(stats.deadLettered).toBe(0);

    // Cycles 2 and 3: poison reaches the attempt cap and is dead-lettered
    // (exits the retry loop); "limited" keeps being deferred, never lost.
    await daemon.runIngestionOnce();
    await daemon.runIngestionOnce();
    stats = buffer.getStats();
    expect(stats.deadLettered).toBe(1);
    // Dead-letter sidecar holds metadata only — never event content.
    const sidecar = fs.readFileSync(path.join(dataDir, ".dead-letter.jsonl"), "utf-8");
    expect(sidecar).toContain('"eventId":"poison"');
    expect(sidecar).not.toContain("always failing event body");
    // "limited" is still retryable.
    const remaining = buffer.fetchUnsynced(10).map((b) => b.event.id);
    expect(remaining).toEqual(["limited"]);

    await buffer.destroy();
  });

  it("falls back to whole-batch sync for a legacy handler returning void", async () => {
    const buffer = new EventBuffer(dataDir);
    await buffer.init();
    buffer.pushBatch([ev({ id: "x" }), ev({ id: "y" })]);

    const daemon = makeDaemon(buffer, async () => undefined);
    await daemon.runIngestionOnce();
    expect(buffer.getStats().unsyncedEvents).toBe(0);
    await buffer.destroy();
  });
});

describe("A4: fairness and backpressure", () => {
  it("fetchUnsyncedFair gives every source a share of the batch", async () => {
    const buffer = new EventBuffer(dataDir);
    await buffer.init();

    // Source A floods 40 high-importance events; source B has 3 low ones.
    buffer.pushBatch(
      Array.from({ length: 40 }, (_, i) =>
        ev({ id: `a${i}`, source: "flood", importanceEstimate: 9, content: `flood ${i}` }),
      ),
    );
    buffer.pushBatch([
      ev({ id: "b1", source: "quiet", importanceEstimate: 2, content: "quiet 1" }),
      ev({ id: "b2", source: "quiet", importanceEstimate: 2, content: "quiet 2" }),
      ev({ id: "b3", source: "quiet", importanceEstimate: 2, content: "quiet 3" }),
    ]);

    const batch = buffer.fetchUnsyncedFair(10);
    const bySource = new Map<string, number>();
    for (const b of batch) bySource.set(b.event.source, (bySource.get(b.event.source) || 0) + 1);
    // Global importance-ordering would give "quiet" zero slots; fairness must not.
    expect(bySource.get("quiet")! >= 3).toBe(true);
    expect(batch.length).toBe(10);

    await buffer.destroy();
  });

  it("daemon reports backpressure when the unsynced backlog nears capacity", async () => {
    const buffer = new EventBuffer(dataDir, { maxEvents: 100 });
    await buffer.init();
    const registry = { getActiveAdapters: () => new Map(), saveCheckpoints: () => {} } as any;
    const daemon = new CollectorDaemon(registry, buffer, { backpressureThreshold: 0.8 });

    buffer.pushBatch(
      Array.from({ length: 79 }, (_, i) => ev({ id: `e${i}`, content: `body ${i}` })),
    );
    expect(daemon.backpressured()).toBe(false);

    buffer.pushBatch([
      ev({ id: "e79", content: "body 79" }),
      ev({ id: "e80", content: "body 80" }),
    ]);
    expect(daemon.backpressured()).toBe(true);

    await buffer.destroy();
  });
});
