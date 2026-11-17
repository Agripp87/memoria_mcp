import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

// The retrieval eval (eval/) is not run in CI: it needs the embedding model.
// Its data can still rot without anyone noticing: a renamed document that a
// query still cites, an "exact-term" query whose term was edited out of its
// answer. eval/check.mjs checks that statically, with no model and no search,
// so it runs here.

const EVAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../eval");

type Check = {
  errors: string[];
  counts: Record<string, { dev: number; test: number }>;
  documents: number;
  queries: number;
};
type Dataset = { corpus: unknown[]; gold: Array<{ q: string; split?: string }> };

const load = async () => ({
  check: (await import(pathToFileURL(path.join(EVAL, "check.mjs")).href)) as {
    checkDataset(set?: string): Check;
  },
  data: (await import(pathToFileURL(path.join(EVAL, "dataset.mjs")).href)) as {
    loadDataset(set?: string): Dataset;
  },
});

describe("retrieval eval data", () => {
  it("is internally consistent", async () => {
    const { check } = await load();
    const full = check.checkDataset("full");
    expect(full.errors).toEqual([]);
    expect(check.checkDataset("original").errors).toEqual([]);
    expect(full.documents).toBeGreaterThan(150);
  });

  it("splits every kind of query about evenly between dev and test", async () => {
    const { check } = await load();
    for (const [kind, c] of Object.entries(check.checkDataset("full").counts)) {
      expect(Math.abs(c.dev - c.test), kind).toBeLessThanOrEqual(1);
      expect(c.dev, kind).toBeGreaterThan(0);
    }
  });

  it("keeps the original set intact and each query on one side of the split", async () => {
    const { data } = await load();
    const original = data.loadDataset("original");
    // Every number published before 2026-11 was measured on these.
    expect(original.corpus).toHaveLength(51);
    expect(original.gold).toHaveLength(30);
    const full = new Map(data.loadDataset("full").gold.map((g) => [g.q, g.split]));
    for (const g of original.gold) expect(full.get(g.q), g.q).toBe(g.split);
  });
});
