#!/usr/bin/env node
/**
 * MCP stdio entry point for the Claude Code plugin.
 *
 * A plugin install is a git clone — nothing runs `npm install`, so on first
 * launch there are no dependencies and no `dist/`. This wrapper makes the
 * plugin self-installing: it installs dependencies when they are missing or
 * incomplete (one launcher at a time), then hands off to `mcp-start.mjs`,
 * which builds from source and serves.
 *
 * Two hard constraints, inherited from mcp-start.mjs:
 *   1. stdout is the JSON-RPC transport. Every byte npm and tsc emit must be
 *      redirected to stderr or the stream is corrupted and the server looks
 *      broken to the client.
 *   2. Nothing here may hang forever. A first install compiling better-sqlite3
 *      from source can take a while; the client's startup timeout is the real
 *      limit, so we log progress to stderr and let the user see it.
 *
 * For an npm install, `npx -y @agrippa87/memoria-mcp` is the simpler
 * command and this wrapper is only needed for a source install.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, ".."); // mcp-server/
const nodeModules = path.join(root, "node_modules");
const lockfile = path.join(root, "package-lock.json");
const hasLock = existsSync(lockfile);
const marker = path.join(nodeModules, ".memoria-install-ok");
const installLock = path.join(root, ".install.lock");
// A first install compiles better-sqlite3 and can take minutes; a lock older
// than this is from a launcher that died without releasing it.
const INSTALL_LOCK_MAX_MS = 10 * 60_000;

function note(msg) {
  process.stderr.write(`Memoria plugin: ${msg}\n`);
}

// What a finished install records in its marker: the lockfile it installed
// and the Node ABI the native module (better-sqlite3) was built for.
function expectedMarker() {
  const deps = readFileSync(hasLock ? lockfile : path.join(root, "package.json"));
  const hash = createHash("sha256").update(deps).digest("hex");
  return `${hash} ${process.versions.modules}\n`;
}

// The install is complete only if the marker written after a successful npm
// run matches. Probing for a package directory did not tell: npm extracts
// the SDK early, so an interrupted install, or a second launcher's `npm ci`
// wiping the tree under the first, left a node_modules that passed the probe
// and could never import, with nothing ever reinstalling it. The marker also
// catches a plugin update that changed the lockfile and a new Node major.
function installComplete() {
  try {
    return readFileSync(marker, "utf-8") === expectedMarker();
  } catch {
    return false;
  }
}

// One installer at a time: `npm ci` deletes node_modules first, so two
// launchers starting together (several sessions after an install or update)
// broke each other's trees. The lock file holds "<pid> <epoch ms>"; one
// whose process is gone, or that is older than INSTALL_LOCK_MAX_MS, is taken
// over.
function tryTakeInstallLock() {
  try {
    const fd = openSync(installLock, "wx");
    writeSync(fd, `${process.pid} ${Date.now()}\n`);
    closeSync(fd);
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  let held, age;
  try {
    held = readFileSync(installLock, "utf-8").trim();
    age = Date.now() - statSync(installLock).mtimeMs;
  } catch {
    return false; // released meanwhile: the next attempt takes it
  }
  const [pid] = held.split(/\s+/).map(Number);
  let stale = age > INSTALL_LOCK_MAX_MS;
  if (!stale && Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      stale = err.code === "ESRCH"; // EPERM: alive, someone else's
    }
  } else if (!held && age > 5_000) {
    stale = true; // created but never written: its launcher died at once
  }
  if (stale) {
    note(`removing a stale install lock (${held || "empty"})`);
    rmSync(installLock, { force: true });
  }
  return false;
}

function releaseInstallLock() {
  try {
    if (readFileSync(installLock, "utf-8").startsWith(`${process.pid} `)) rmSync(installLock);
  } catch {}
}

function runInstall() {
  note("installing dependencies (this happens once, and can take a minute)");
  const started = Date.now();
  // Removed first: only an install that succeeds writes it back.
  rmSync(marker, { force: true });
  const isWindows = process.platform === "win32";
  // `ci` when the lockfile is there (it always is in a plugin checkout): the
  // exact, audited dependency tree, and the lockfile is never rewritten.
  // `install` resolved afresh within the semver ranges.
  const NPM_ARGS = [hasLock ? "ci" : "install", "--no-audit", "--no-fund", "--loglevel", "error"];
  const options = {
    cwd: root,
    // stdout piped, NOT inherited: npm writes progress to stdout and that
    // would corrupt the JSON-RPC stream.
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  };

  // On Windows `npm` is a .cmd shim, and since the CVE-2024-27980 fix Node
  // refuses to spawn one without a shell. Pass the whole line as a single
  // string rather than shell + argv, which avoids DEP0190 (unescaped argument
  // concatenation). Nothing here is user input.
  const install = isWindows
    ? spawnSync(`npm ${NPM_ARGS.join(" ")}`, { ...options, shell: true })
    : spawnSync("npm", NPM_ARGS, options);

  const output = `${install.stdout || ""}${install.stderr || ""}`.trim();
  if (output) process.stderr.write(output + "\n");

  if (install.error || install.status !== 0) {
    note(
      `dependency install FAILED (${install.error ? install.error.message : `exit ${install.status}`}). ` +
        "Install by hand:\n" +
        `  cd ${root}\n` +
        "  npm install\n" +
        "better-sqlite3 is a native module — a compiler toolchain may be required.",
    );
    return false;
  }
  // Written last, and atomically, so a half-written marker never counts.
  const tmp = `${marker}.${process.pid}.tmp`;
  writeFileSync(tmp, expectedMarker());
  renameSync(tmp, marker);
  note(`dependencies installed in ${Math.round((Date.now() - started) / 1000)}s`);
  return true;
}

if (!installComplete()) {
  let installed;
  let waitingNoted = false;
  for (;;) {
    if (tryTakeInstallLock()) {
      try {
        // Another launcher may have finished while this one waited.
        installed = installComplete() || runInstall();
      } finally {
        releaseInstallLock();
      }
      break;
    }
    if (installComplete()) {
      installed = true;
      break;
    }
    if (!waitingNoted) {
      note("another launcher is installing dependencies — waiting for it");
      waitingNoted = true;
    }
    await sleep(1000);
  }
  if (!installed) process.exit(1);
}

// mcp-start.mjs owns build-then-serve (and the stale-dist fallback).
await import(pathToFileURL(path.join(here, "mcp-start.mjs")).href);
