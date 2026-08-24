import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

// setupPeriodicOptimize lives in tools.ts, which reads MEMORIA_DIR at load.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-sched-"));
process.env.MEMORIA_DIR = ROOT;

let setupPeriodicOptimize: (store: any, intervalMs?: number) => any;
let setupPeriodicCompile: (store: any, intervalMs?: number) => any;
let store: any;
const timers: any[] = [];

beforeAll(async () => {
  fs.mkdirSync(path.join(ROOT, "memories"), { recursive: true });
  const tools = await import("../tools.js");
  setupPeriodicOptimize = tools.setupPeriodicOptimize;
  setupPeriodicCompile = tools.setupPeriodicCompile;
  const s = await import("../store.js");
  store = new s.MemoryStore(path.join(ROOT, "data", "sched.sqlite"));
});

afterEach(() => {
  delete process.env.MEMORIA_AUTO_OPTIMIZE;
  delete process.env.MEMORIA_AUTO_COMPILE;
  timers.forEach((t) => clearInterval(t));
  timers.length = 0;
});

afterAll(() => {
  try {
    store?.close();
  } catch {}
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {}
});

describe("setupPeriodicOptimize gating (I21)", () => {
  it("is a no-op (returns null) unless MEMORIA_AUTO_OPTIMIZE=true", () => {
    delete process.env.MEMORIA_AUTO_OPTIMIZE;
    expect(setupPeriodicOptimize(store)).toBeNull();
    process.env.MEMORIA_AUTO_OPTIMIZE = "false";
    expect(setupPeriodicOptimize(store)).toBeNull();
  });

  it("returns a timer when explicitly enabled", () => {
    process.env.MEMORIA_AUTO_OPTIMIZE = "true";
    const t = setupPeriodicOptimize(store, 3_600_000); // 1h — won't fire in-test
    timers.push(t);
    expect(t).not.toBeNull();
  });
});

describe("setupPeriodicCompile gating (P0)", () => {
  it("is a no-op (returns null) unless MEMORIA_AUTO_COMPILE=true", () => {
    delete process.env.MEMORIA_AUTO_COMPILE;
    expect(setupPeriodicCompile(store)).toBeNull();
    process.env.MEMORIA_AUTO_COMPILE = "false";
    expect(setupPeriodicCompile(store)).toBeNull();
  });

  it("returns a timer when explicitly enabled", () => {
    process.env.MEMORIA_AUTO_COMPILE = "true";
    const t = setupPeriodicCompile(store, 3_600_000); // 1h — won't fire in-test
    timers.push(t);
    expect(t).not.toBeNull();
  });
});
