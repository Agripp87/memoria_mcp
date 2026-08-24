import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

// The scan cap is read at module load, so it must be set before importing
// store.js (same pattern as index_rebuild.test.ts with MEMORIA_DIR).
process.env.MEMORIA_VECTOR_SCAN_CAP = "10";

let MemoryStore: typeof import("../store.js").MemoryStore;
let samplePhase: typeof import("../store.js").samplePhase;
let selectEvenSample: typeof import("../store.js").selectEvenSample;
let chunkMarkdown: typeof import("../chunker.js").chunkMarkdown;
let store: InstanceType<typeof MemoryStore>;
let dbPath: string;

beforeAll(async () => {
  ({ MemoryStore, samplePhase, selectEvenSample } = await import("../store.js"));
  ({ chunkMarkdown } = await import("../chunker.js"));
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "memoria-sample-")), "sample.sqlite");
  store = new MemoryStore(dbPath);
  // 15 one-chunk files against a cap of 10 → the store is over the cap.
  for (let i = 0; i < 15; i++) {
    const content = `---\nname: Note ${i}\nimportance: 5\n---\n\nDistinct topic ${i}: fact about subject-${i}.`;
    await store.indexChunks(chunkMarkdown(content, `notes/n${i}.md`), 5, content);
  }
});

afterAll(() => {
  try {
    store?.close();
  } catch {}
});

describe("over-cap vector sampling", () => {
  it("scans exactly the cap, not the old ceil-stride fraction", async () => {
    // Old behavior: stride = ceil(15/10) = 2 → only 8 of 15 scanned (a ~50%
    // recall cliff the moment the store crosses the cap). New behavior: an
    // even sample of exactly cap rows for any store size.
    const results = await store.search("subject", 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].totalChunks).toBe(15);
    expect(results[0].scannedChunks).toBe(10);
  });

  it("keeps scan coverage stable across queries", async () => {
    for (const q of ["alpha", "beta", "gamma delta"]) {
      const r = await store.search(q, 1);
      expect(r[0].scannedChunks).toBe(10);
    }
  });
});

describe("selectEvenSample row identity", () => {
  // These tests pin WHICH rows are selected, not how many. The first shipped
  // version of this sampler passed every count-based assertion while actually
  // selecting the oldest `cap` rows for every query: better-sqlite3 binds JS
  // numbers as REAL, making the integer-division floor-crossing WHERE clause
  // a tautology that LIMIT then truncated in id order. Row-identity
  // assertions are the only kind that catch that class of bug.
  const ids = (rows: Array<{ id: number }>) => rows.map((r) => r.id);
  const db = () => (store as any).db;

  it("selects the even sample, not the oldest-cap prefix (phase 0)", () => {
    expect(ids(selectEvenSample(db(), 10, 15, 0))).toEqual([2, 3, 5, 6, 8, 9, 11, 12, 14, 15]);
  });

  it("rotates the selection with the phase", () => {
    expect(ids(selectEvenSample(db(), 10, 15, 7))).toEqual([1, 2, 4, 5, 7, 8, 10, 11, 13, 14]);
  });

  it("every row is reachable under some phase", () => {
    const seen = new Set<number>();
    for (let p = 0; p < 15; p++) {
      for (const id of ids(selectEvenSample(db(), 10, 15, p))) seen.add(id);
    }
    expect(seen.size).toBe(15);
  });

  it("selects exactly cap rows at the old cliff boundary (total = cap + 1)", () => {
    // cap 14, total 15: the old ceil-stride sample would scan only 8 rows
    // here (stride 2) — the ~50% cliff. The even sample scans exactly 14.
    expect(ids(selectEvenSample(db(), 14, 15, 0)).length).toBe(14);
  });
});

describe("samplePhase", () => {
  it("is deterministic for the same query", () => {
    expect(samplePhase("what did we decide", 5000)).toBe(samplePhase("what did we decide", 5000));
  });

  it("varies across queries so no row is permanently off-sample", () => {
    // With a fixed phase the same (total - cap) rows would be invisible to
    // EVERY query forever. Rotating the phase per query means different
    // queries see different residues; any given row is reachable.
    const total = 5000;
    const phases = new Set(
      ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map((q) => samplePhase(q, total)),
    );
    expect(phases.size).toBeGreaterThan(1);
  });

  it("stays within [0, total)", () => {
    for (const q of ["", "x", "a much longer query string with words"]) {
      const p = samplePhase(q, 7);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(7);
    }
  });
});
