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

describe("interval settings (2026-10 re-review F37)", () => {
  it.each(["abc", "0", "-5", "5m", "1e3", "3000000000"])(
    "MEMORIA_COMPILE_INTERVAL_MS=%s falls back to the default",
    async (raw) => {
      const { intervalFromEnv } = await import("../tools.js");
      process.env.MEMORIA_COMPILE_INTERVAL_MS = raw;
      try {
        expect(intervalFromEnv("MEMORIA_COMPILE_INTERVAL_MS", 86_400_000)).toBe(86_400_000);
      } finally {
        delete process.env.MEMORIA_COMPILE_INTERVAL_MS;
      }
    },
  );

  it("a valid value is used", async () => {
    const { intervalFromEnv } = await import("../tools.js");
    process.env.MEMORIA_COMPILE_INTERVAL_MS = "3600000";
    try {
      expect(intervalFromEnv("MEMORIA_COMPILE_INTERVAL_MS", 86_400_000)).toBe(3_600_000);
    } finally {
      delete process.env.MEMORIA_COMPILE_INTERVAL_MS;
    }
  });
});

describe("daily jobs count across restarts (2026-10 re-review F25)", () => {
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it("auto-optimize runs at startup when due, and records it", async () => {
    process.env.MEMORIA_AUTO_OPTIMIZE = "true";
    store.setMeta("last_auto_optimize", String(Date.now() - 25 * 3_600_000));
    timers.push(setupPeriodicOptimize(store));
    await settle();
    expect(Number(store.getMeta("last_auto_optimize"))).toBeGreaterThan(Date.now() - 10_000);
    expect(store.getMeta("last_decay_run")).toBe(new Date().toISOString().slice(0, 10));
  });

  it("auto-compile runs at startup when overdue, not when it ran an hour ago", async () => {
    process.env.MEMORIA_AUTO_COMPILE = "true";
    const anHourAgo = String(Date.now() - 3_600_000);
    store.setMeta("last_auto_compile", anHourAgo);
    timers.push(setupPeriodicCompile(store));
    await settle();
    expect(store.getMeta("last_auto_compile")).toBe(anHourAgo);
    clearInterval(timers.pop());

    store.setMeta("last_auto_compile", String(Date.now() - 25 * 3_600_000));
    timers.push(setupPeriodicCompile(store));
    await settle();
    expect(Number(store.getMeta("last_auto_compile"))).toBeGreaterThan(Date.now() - 10_000);
  });
});
