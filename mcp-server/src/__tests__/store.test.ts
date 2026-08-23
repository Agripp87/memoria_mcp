import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../store.js";
import { chunkMarkdown } from "../chunker.js";
import os from "os";
import path from "path";
import fs from "fs";

let store: MemoryStore;
let dbPath: string;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `memoria-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  store = new MemoryStore(dbPath);
});

afterEach(() => {
  store.close();
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + "-wal"); } catch {}
  try { fs.unlinkSync(dbPath + "-shm"); } catch {}
});

describe("MemoryStore", () => {
  const sampleContent = `---
name: Test
importance: 7
---

This is a test memory about TypeScript programming.`;

  it("indexes chunks and lists them in getIndexedFiles", async () => {
    const chunks = chunkMarkdown(sampleContent, "test/sample.md");
    await store.indexChunks(chunks, 7, sampleContent);
    const files = store.getIndexedFiles();
    expect(files).toContain("test/sample.md");
  });

  it("recency reflects last touch (read OR edit), not last edit alone (B6)", async () => {
    const content = "---\nname: Old note\nimportance: 5\n---\nA note about quantum widgets.";
    await store.indexChunks(chunkMarkdown(content, "old.md"), 5, content);
    // Edited two months ago, but read today.
    const monthsAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    const today = new Date().toISOString();
    (store as any).db
      .prepare("UPDATE chunks SET updated_at = ?, last_accessed = ? WHERE file = 'old.md'")
      .run(monthsAgo, today);

    const results = await store.search("quantum widgets", 1);
    // updated_at-only recency would give 0.5^(60/30) = 0.25; last-touched
    // semantics give ~1.0 because it was accessed today.
    expect(results[0].recencyScore).toBeGreaterThan(0.9);
  });

  it("search returns results sorted by score descending", async () => {
    const content1 = "---\nname: TS\nimportance: 8\n---\nTypeScript is a typed superset of JavaScript.";
    const content2 = "---\nname: Cooking\nimportance: 5\n---\nHow to cook pasta with tomato sauce.";

    const chunks1 = chunkMarkdown(content1, "ts.md");
    const chunks2 = chunkMarkdown(content2, "cooking.md");
    await store.indexChunks(chunks1, 8, content1);
    await store.indexChunks(chunks2, 5, content2);

    const results = await store.search("TypeScript programming", 5);
    expect(results.length).toBeGreaterThan(0);
    // Results should be sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("hasContentChanged returns false for same content, true for changed", async () => {
    const chunks = chunkMarkdown(sampleContent, "test.md");
    await store.indexChunks(chunks, 7, sampleContent);

    expect(store.hasContentChanged("test.md", sampleContent)).toBe(false);
    expect(store.hasContentChanged("test.md", sampleContent + " updated")).toBe(true);
  });

  it("trackAccess increments access count", async () => {
    const chunks = chunkMarkdown(sampleContent, "access.md");
    await store.indexChunks(chunks, 7, sampleContent);

    store.trackAccess("access.md");
    store.trackAccess("access.md");

    const stats = store.getStats();
    const accessed = stats.topAccessed.find((f) => f.file === "access.md");
    expect(accessed).toBeDefined();
    expect(accessed!.access_count).toBeGreaterThanOrEqual(2);
  });

  it("removeFile removes chunks and file_meta", async () => {
    const chunks = chunkMarkdown(sampleContent, "remove-me.md");
    await store.indexChunks(chunks, 7, sampleContent);
    expect(store.getIndexedFiles()).toContain("remove-me.md");

    store.removeFile("remove-me.md");
    expect(store.getIndexedFiles()).not.toContain("remove-me.md");
  });

  it("decayImportance is idempotent on same day", async () => {
    const chunks = chunkMarkdown(sampleContent, "decay.md");
    await store.indexChunks(chunks, 7, sampleContent);

    const first = store.decayImportance(0); // 0 days = all chunks eligible
    const second = store.decayImportance(0);
    // Second call on same day should return 0 (idempotent)
    expect(second).toBe(0);
  });

  it("boostImportance is idempotent on same day", async () => {
    const chunks = chunkMarkdown(sampleContent, "boost.md");
    await store.indexChunks(chunks, 7, sampleContent);

    const first = store.boostImportance(0); // threshold 0 = all eligible
    const second = store.boostImportance(0);
    expect(second).toBe(0);
  });

  it("getStats returns correct aggregate counts", async () => {
    const chunks = chunkMarkdown(sampleContent, "stats.md");
    await store.indexChunks(chunks, 7, sampleContent);

    const stats = store.getStats();
    expect(stats.totalChunks).toBeGreaterThan(0);
    expect(stats.totalFiles).toBe(1);
    expect(stats.avgImportance).toBe(7);
  });

  it("findSimilar returns results with similarity scores", async () => {
    const chunks = chunkMarkdown(sampleContent, "similar.md");
    await store.indexChunks(chunks, 7, sampleContent);

    const results = await store.findSimilar("TypeScript test memory");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].similarity).toBeGreaterThan(0);
  });

  it("search with empty query returns results without error", async () => {
    const chunks = chunkMarkdown(sampleContent, "empty-query.md");
    await store.indexChunks(chunks, 7, sampleContent);

    const results = await store.search("", 5);
    // Should not throw; may return results based on recency/importance
    expect(Array.isArray(results)).toBe(true);
  });

  it("search on empty store returns empty array", async () => {
    const results = await store.search("anything", 5);
    expect(results).toEqual([]);
  });

  it("handles importance boundary values correctly", async () => {
    const low = "---\nname: Low\nimportance: 1\n---\nLow importance content.";
    const high = "---\nname: High\nimportance: 10\n---\nHigh importance content.";
    await store.indexChunks(chunkMarkdown(low, "low.md"), 1, low);
    await store.indexChunks(chunkMarkdown(high, "high.md"), 10, high);

    const stats = store.getStats();
    expect(stats.totalFiles).toBe(2);
    expect(stats.importanceDistribution[1]).toBeGreaterThan(0);
    expect(stats.importanceDistribution[10]).toBeGreaterThan(0);
  });

  it("getStats returns access_count as sum across chunks", async () => {
    // Index content that produces at least 1 chunk
    const chunks = chunkMarkdown(sampleContent, "sum-test.md");
    await store.indexChunks(chunks, 7, sampleContent);

    // Track access 3 times
    store.trackAccess("sum-test.md");
    store.trackAccess("sum-test.md");
    store.trackAccess("sum-test.md");

    const stats = store.getStats();
    const entry = stats.topAccessed.find((f) => f.file === "sum-test.md");
    expect(entry).toBeDefined();
    // SUM of access_count across all chunks for this file
    expect(entry!.access_count).toBeGreaterThanOrEqual(3);
  });

  it("getAccessCount returns live count from file_meta", async () => {
    const chunks = chunkMarkdown(sampleContent, "live-access.md");
    await store.indexChunks(chunks, 7, sampleContent);

    expect(store.getAccessCount("live-access.md")).toBe(0);
    store.trackAccess("live-access.md");
    expect(store.getAccessCount("live-access.md")).toBe(1);
    store.trackAccess("live-access.md");
    expect(store.getAccessCount("live-access.md")).toBe(2);
  });

  it("getAccessCount returns 0 for unknown files", () => {
    expect(store.getAccessCount("never-tracked.md")).toBe(0);
  });

  it("search with whitespace-only query falls back to recency", async () => {
    const chunks = chunkMarkdown(sampleContent, "fallback.md");
    await store.indexChunks(chunks, 7, sampleContent);

    const results = await store.search("   ", 5);
    expect(Array.isArray(results)).toBe(true);
    // The fallback returns up to maxResults entries
    expect(results.length).toBeLessThanOrEqual(5);
  });
});
