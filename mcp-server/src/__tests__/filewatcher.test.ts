import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { assertWatchPathAllowed } from "../collector/adapters/custom.js";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-fw-"));
const DATA_DIR = path.join(TMP, "data");
const ALLOWED = path.join(TMP, "exports");
const OUTSIDE = path.join(TMP, "elsewhere");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ALLOWED, { recursive: true });
fs.mkdirSync(OUTSIDE, { recursive: true });
fs.writeFileSync(path.join(DATA_DIR, "collector.key"), "deadbeef");
fs.writeFileSync(path.join(ALLOWED, "fitbit.json"), "{}");
fs.writeFileSync(path.join(OUTSIDE, "secret.txt"), "nope");

afterEach(() => {
  delete process.env.MEMORIA_FILE_WATCHER_ROOTS;
});

describe("assertWatchPathAllowed", () => {
  it("blocks the collector key/credential store unconditionally", () => {
    expect(() =>
      assertWatchPathAllowed(path.join(DATA_DIR, "collector.key"), { dataDir: DATA_DIR }),
    ).toThrow(/collector data directory/i);
    expect(() =>
      assertWatchPathAllowed(path.join(DATA_DIR, "collector-config.enc"), { dataDir: DATA_DIR }),
    ).toThrow(/collector data directory/i);
  });

  it("denies file_watcher by default when no allowlist is configured (fail closed)", () => {
    // MEMORIA_FILE_WATCHER_ROOTS unset must deny, not allow — otherwise an
    // authenticated/prompt-injected caller could watch an arbitrary host file.
    delete process.env.MEMORIA_FILE_WATCHER_ROOTS;
    expect(() =>
      assertWatchPathAllowed(path.join(ALLOWED, "fitbit.json"), { dataDir: DATA_DIR }),
    ).toThrow(/disabled by default|allowlist/i);
  });

  it("enforces the allowlist when MEMORIA_FILE_WATCHER_ROOTS is set", () => {
    process.env.MEMORIA_FILE_WATCHER_ROOTS = ALLOWED;
    expect(() =>
      assertWatchPathAllowed(path.join(ALLOWED, "fitbit.json"), { dataDir: DATA_DIR }),
    ).not.toThrow();
    expect(() =>
      assertWatchPathAllowed(path.join(OUTSIDE, "secret.txt"), { dataDir: DATA_DIR }),
    ).toThrow(/allowlist/i);
  });

  it("denies all file_watcher paths when the allowlist is empty", () => {
    process.env.MEMORIA_FILE_WATCHER_ROOTS = "";
    expect(() =>
      assertWatchPathAllowed(path.join(ALLOWED, "fitbit.json"), { dataDir: DATA_DIR }),
    ).toThrow(/allowlist/i);
  });

  it("still blocks the data dir even when it is inside an allowed root", () => {
    // allowlist = TMP (which contains DATA_DIR); the unconditional data-dir
    // block must still win.
    process.env.MEMORIA_FILE_WATCHER_ROOTS = TMP;
    expect(() =>
      assertWatchPathAllowed(path.join(DATA_DIR, "collector.key"), { dataDir: DATA_DIR }),
    ).toThrow(/collector data directory/i);
  });
});

describe("assertWatchPathAllowed with a symlinked MEMORIA_DIR (2026-10 re-review F15)", () => {
  it("blocks the data dir by its link path and its real path", () => {
    // MEMORIA_DIR=<TMP>/store-link -> <TMP>/real-store; the registry is
    // given the link spelling of the data dir, the watch path resolves to
    // the real one.
    const real = path.join(TMP, "real-store");
    fs.mkdirSync(path.join(real, "data"), { recursive: true });
    fs.writeFileSync(path.join(real, "data", "collector.key"), "deadbeef");
    const link = path.join(TMP, "store-link");
    fs.symlinkSync(real, link);
    process.env.MEMORIA_FILE_WATCHER_ROOTS = TMP;
    const dataDir = path.join(link, "data");
    for (const p of [
      path.join(link, "data", "collector.key"),
      path.join(real, "data", "collector.key"),
    ]) {
      expect(() => assertWatchPathAllowed(p, { dataDir })).toThrow(/collector data directory/i);
    }
  });

  it("blocks a copy of the key file wherever it lives", () => {
    process.env.MEMORIA_FILE_WATCHER_ROOTS = TMP;
    fs.writeFileSync(path.join(ALLOWED, "collector.key"), "deadbeef");
    expect(() =>
      assertWatchPathAllowed(path.join(ALLOWED, "collector.key"), { dataDir: DATA_DIR }),
    ).toThrow(/collector data directory/i);
  });
});
