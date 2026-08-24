import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runOptimize } from "../optimize.js";
import { MemoryStore } from "../store.js";
import { chunkMarkdown } from "../chunker.js";
import os from "os";
import path from "path";
import fs from "fs";

let store: MemoryStore;
let dbPath: string;

beforeEach(() => {
  dbPath = path.join(
    os.tmpdir(),
    `memoria-opt-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
  store = new MemoryStore(dbPath);
});

afterEach(() => {
  store.close();
  try {
    fs.unlinkSync(dbPath);
  } catch {}
  try {
    fs.unlinkSync(dbPath + "-wal");
  } catch {}
  try {
    fs.unlinkSync(dbPath + "-shm");
  } catch {}
});

const sampleContent =
  "---\nname: Opt Test\nimportance: 6\n---\nOptimization test content about memory management.";

describe("runOptimize", () => {
  it("decay action returns result with affected count", async () => {
    const chunks = chunkMarkdown(sampleContent, "opt.md");
    await store.indexChunks(chunks, 6, sampleContent);

    const result = runOptimize(store, "decay");
    expect(result.action).toBe("decay");
    expect(typeof result.affected).toBe("number");
    expect(result.details.length).toBeGreaterThan(0);
  });

  it("promote action returns result", async () => {
    const chunks = chunkMarkdown(sampleContent, "opt.md");
    await store.indexChunks(chunks, 6, sampleContent);

    const result = runOptimize(store, "promote");
    expect(result.action).toBe("promote");
    expect(typeof result.affected).toBe("number");
  });

  it("detect_stale returns stale files info", async () => {
    const result = runOptimize(store, "detect_stale");
    expect(result.action).toBe("detect_stale");
    expect(result.details.length).toBeGreaterThan(0);
  });

  it("find_duplicates returns indexed file count", async () => {
    const chunks = chunkMarkdown(sampleContent, "dup.md");
    await store.indexChunks(chunks, 6, sampleContent);

    const result = runOptimize(store, "find_duplicates");
    expect(result.action).toBe("find_duplicates");
  });

  it("unknown action returns descriptive error", () => {
    const result = runOptimize(store, "nonexistent");
    expect(result.action).toBe("nonexistent");
    expect(result.details[0]).toContain("Unknown action");
  });
});
