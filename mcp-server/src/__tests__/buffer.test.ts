import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { EventBuffer } from "../collector/buffer.js";
import { initMasterKey } from "../collector/crypto.js";
import type { RawEvent } from "../collector/adapters/base.js";

function ev(i: number): RawEvent {
  return {
    id: `e${i}`,
    source: "test",
    eventType: "x",
    content: `event body number ${i}`,
    timestamp: new Date().toISOString(),
    meta: {},
    importanceEstimate: 5,
    privacyTier: "send",
  };
}

let dir: string;
let buf: EventBuffer;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-buf-"));
  initMasterKey(dir); // module-cached; provides a key for encrypt/decrypt
  buf = new EventBuffer(dir, { maxEvents: 100 }); // min allowed
  await buf.init();
});

afterEach(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

describe("EventBuffer capacity / unsynced-loss accounting", () => {
  it("tracks dropped UNSYNCED events when the buffer fills with un-ingested data", () => {
    const { inserted, dropped } = buf.pushBatch(Array.from({ length: 150 }, (_, i) => ev(i)));
    expect(inserted).toBe(150);
    expect(dropped).toBeGreaterThanOrEqual(50);

    const stats = buf.getStats();
    expect(stats.totalEvents).toBeLessThanOrEqual(100);
    // None were synced, so every eviction is real data loss and must be counted.
    expect(stats.droppedUnsynced).toBeGreaterThan(0);
  });

  it("does not count dropped-unsynced when under capacity", () => {
    buf.pushBatch(Array.from({ length: 10 }, (_, i) => ev(i)));
    expect(buf.getStats().droppedUnsynced).toBe(0);
  });
});
