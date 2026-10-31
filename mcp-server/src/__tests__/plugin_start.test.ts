import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// The plugin launcher's first-run `npm ci` had no lock, and the only check
// for a finished install was that node_modules/@modelcontextprotocol/sdk
// existed. Two launchers starting together wiped each other's trees and left
// one that passed that check but could never import; an interrupted install
// did the same. Nothing ever reinstalled it.
//
// These run a copy of scripts/plugin-start.mjs against a stub `npm` on PATH
// and a stub mcp-start.mjs, so no real install or server runs. The stub npm
// is a shell script, so the suite is POSIX only.

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/plugin-start.mjs",
);

let ROOT: string;
let BIN: string;

const NPM_STUB = `#!/bin/sh
# Records each run, takes a moment like a real install, then lays out a tree.
echo "$*" >> "$PWD/npm-runs"
sleep 1
mkdir -p node_modules/@modelcontextprotocol/sdk
exit "\${NPM_STUB_EXIT:-0}"
`;

const MCP_START_STUB = `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.appendFileSync(path.join(root, "handoffs"), "served\\n");
`;

function launch(env: Record<string, string> = {}): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", "plugin-start.mjs")], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${BIN}${path.delimiter}${process.env.PATH}`, ...env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, err }));
  });
}

function lines(file: string): string[] {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf-8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

const marker = () => path.join(ROOT, "node_modules", ".memoria-install-ok");

function goodMarker(): string {
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, "package-lock.json")))
    .digest("hex");
  return `${hash} ${process.versions.modules}\n`;
}

/** A pid that certainly belongs to no running process. */
function deadPid(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    child.on("close", () => resolve(child.pid!));
  });
}

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-plugin-start-"));
  BIN = path.join(ROOT, "bin");
  fs.mkdirSync(path.join(ROOT, "scripts"), { recursive: true });
  fs.mkdirSync(BIN);
  fs.copyFileSync(SCRIPT, path.join(ROOT, "scripts", "plugin-start.mjs"));
  fs.writeFileSync(path.join(ROOT, "scripts", "mcp-start.mjs"), MCP_START_STUB);
  fs.writeFileSync(path.join(ROOT, "package-lock.json"), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(BIN, "npm"), NPM_STUB, { mode: 0o755 });
});

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("plugin-start dependency install", () => {
  it("installs once when two launchers start together, and both serve", async () => {
    const [a, b] = await Promise.all([launch(), launch()]);
    expect([a.code, b.code]).toEqual([0, 0]);
    expect(lines("npm-runs")).toEqual(["ci --no-audit --no-fund --loglevel error"]);
    expect(lines("handoffs")).toHaveLength(2);
    expect(fs.readFileSync(marker(), "utf-8")).toBe(goodMarker());
    expect(fs.existsSync(path.join(ROOT, ".install.lock"))).toBe(false);
  }, 30_000);

  it("reinstalls a tree that has the SDK but no completion marker", async () => {
    fs.mkdirSync(path.join(ROOT, "node_modules", "@modelcontextprotocol", "sdk"), {
      recursive: true,
    });
    const r = await launch();
    expect(r.code).toBe(0);
    expect(lines("npm-runs")).toHaveLength(1);
  }, 30_000);

  it("reinstalls when the marker is for another lockfile", async () => {
    fs.mkdirSync(path.join(ROOT, "node_modules"), { recursive: true });
    fs.writeFileSync(marker(), `${"0".repeat(64)} ${process.versions.modules}\n`);
    const r = await launch();
    expect(r.code).toBe(0);
    expect(lines("npm-runs")).toHaveLength(1);
    expect(fs.readFileSync(marker(), "utf-8")).toBe(goodMarker());
  }, 30_000);

  it("does not reinstall a complete tree", async () => {
    fs.mkdirSync(path.join(ROOT, "node_modules"), { recursive: true });
    fs.writeFileSync(marker(), goodMarker());
    const r = await launch();
    expect(r.code).toBe(0);
    expect(lines("npm-runs")).toEqual([]);
    expect(lines("handoffs")).toHaveLength(1);
  }, 30_000);

  it("takes over a lock left by a launcher that died", async () => {
    fs.writeFileSync(path.join(ROOT, ".install.lock"), `${await deadPid()} ${Date.now()}\n`);
    const r = await launch();
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/stale install lock/);
    expect(lines("npm-runs")).toHaveLength(1);
    expect(fs.existsSync(path.join(ROOT, ".install.lock"))).toBe(false);
  }, 30_000);

  it("a failed install writes no marker, releases the lock and does not serve", async () => {
    const r = await launch({ NPM_STUB_EXIT: "1" });
    expect(r.code).toBe(1);
    expect(fs.existsSync(marker())).toBe(false);
    expect(fs.existsSync(path.join(ROOT, ".install.lock"))).toBe(false);
    expect(lines("handoffs")).toEqual([]);
  }, 30_000);
});
