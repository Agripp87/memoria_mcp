import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

// tools.ts resolves DATA_DIR from MEMORIA_DIR at import time.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-cq-"));
process.env.MEMORIA_DIR = ROOT;

let enqueueCompileSources: (s: string[]) => void;
let drainCompileQueue: () => string[];

beforeAll(async () => {
  fs.mkdirSync(path.join(ROOT, "memories"), { recursive: true });
  const tools = await import("../tools.js");
  enqueueCompileSources = tools.enqueueCompileSources;
  drainCompileQueue = tools.drainCompileQueue;
});

afterAll(() => {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {}
});

describe("compile queue (P2)", () => {
  it("starts empty", () => {
    expect(drainCompileQueue()).toEqual([]);
  });

  it("accumulates sources with set semantics across calls", () => {
    enqueueCompileSources(["a", "b"]);
    enqueueCompileSources(["b", "c"]);
    expect(drainCompileQueue().sort()).toEqual(["a", "b", "c"]);
  });

  it("drains to empty (clears the queue)", () => {
    enqueueCompileSources(["x"]);
    expect(drainCompileQueue()).toEqual(["x"]);
    expect(drainCompileQueue()).toEqual([]);
  });

  it("ignores empty/whitespace source names and empty input", () => {
    enqueueCompileSources([]);
    enqueueCompileSources(["", "  ", "real"]);
    expect(drainCompileQueue()).toEqual(["real"]);
  });
});
