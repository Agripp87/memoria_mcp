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
