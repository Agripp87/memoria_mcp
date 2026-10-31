/**
 * Shared helpers and tool registration for both stdio and HTTP entry points.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { dump } from "js-yaml";
import {
  FRONTMATTER_WRITE_SCHEMA,
  chunkMarkdown,
  frontmatterTags,
  parseFrontmatter,
} from "./chunker.js";
import { MemoryStore } from "./store.js";
import { runOptimize } from "./optimize.js";
import { runLint, formatLintReport } from "./lint.js";
import { buildEntityPages } from "./entities.js";
import {
  TIME_LABEL_SRC,
  collectorDailyHeader,
  entryImportance,
  stripImportanceTrailer,
} from "./daily-format.js";
import { createOrAppend, writeFileAtomic, writeFileExclusive } from "./atomic-fs.js";
import { SourceRegistry } from "./collector/registry.js";
import { EventBuffer } from "./collector/buffer.js";
import { CollectorDaemon } from "./collector/daemon.js";
import { IngestionPipeline } from "./collector/ingestion.js";
import { TemporalFusion, formatFusedActivity, type FusedActivity } from "./collector/fusion.js";
import type { CustomSourceDefinition } from "./collector/adapters/custom.js";
import { dailyLogPath, listDailyLogNames } from "./daily-paths.js";

// ─── Path resolution ────────────────────────────────────────

export function resolveDefaultMemoriaDir(
  opts: {
    env?: NodeJS.ProcessEnv;
    homedir?: string;
    exists?: (p: string) => boolean;
    warn?: (msg: string) => void;
  } = {},
): string {
  const env = opts.env ?? process.env;
  // Docker / cloud: the image sets DOCKER=true (and MEMORIA_DIR). Merely
  // having a /data directory used to count too, so on an ordinary host with
  // one the local server used /data/memoria while the sync hooks used
  // ~/.memoria, and an unwritable /data crashed the server at import.
  if (env.DOCKER === "true") {
    return "/data/memoria";
  }
  // A 0.2.x install outside Docker on a host with /data kept its store
  // there; say so instead of silently starting from an empty one.
  const exists =
    opts.exists ??
    ((p: string) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
  if (exists("/data/memoria/memories")) {
    (opts.warn ?? ((m: string) => process.stderr.write(m)))(
      "Memoria: a store exists at /data/memoria, which versions before 0.3.0 used by default " +
        "on hosts with a /data directory. This server uses ~/.memoria; set " +
        "MEMORIA_DIR=/data/memoria to keep using the old store.\n",
    );
  }
  // Local: ~/.memoria
  return path.join(opts.homedir ?? os.homedir(), ".memoria");
}

const MEMORIA_DIR = process.env.MEMORIA_DIR || resolveDefaultMemoriaDir();
const MEMORIES_DIR = path.join(MEMORIA_DIR, "memories");
const DB_PATH = path.join(MEMORIA_DIR, "data", "memoria.sqlite");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
// memories/ too: path checks resolve it, and on a fresh store the first
// memory_write into a subfolder failed with ENOENT before creating anything.
fs.mkdirSync(MEMORIES_DIR, { recursive: true });

const DATA_DIR = path.join(MEMORIA_DIR, "data");

export { MEMORIA_DIR, MEMORIES_DIR, DB_PATH, DATA_DIR };

// ─── Helpers ────────────────────────────────────────────────

/**
 * Filename validation: allowed character set + .md extension, AND no traversal
 * or normalization tricks (no empty/`.`/`..` segment, no absolute/leading
 * slash). resolveMemoryPath() remains the authoritative containment guard;
 * this is defense in depth at the input layer. Exported so tests exercise the
 * real validator rather than a duplicated copy.
 */
const VALID_MEMORY_FILENAME = /^[a-zA-Z0-9_\-/.]+\.md$/;
export function isValidMemoryFilename(file: string): boolean {
  if (!VALID_MEMORY_FILENAME.test(file)) return false;
  if (file.startsWith("/")) return false; // no absolute paths
  return file.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

export function resolveMemoryPath(file: string): string {
  // Always resolve relative to memories/ — block path traversal
  const resolved = path.resolve(MEMORIES_DIR, file);

  // Ensure resolved path is within MEMORIES_DIR (trailing separator prevents prefix attacks)
  const prefix = MEMORIES_DIR.endsWith(path.sep) ? MEMORIES_DIR : MEMORIES_DIR + path.sep;
  if (resolved !== MEMORIES_DIR && !resolved.startsWith(prefix)) {
    throw new Error("Path traversal blocked: path must be within memories/");
  }

  // Block symlink escapes: verify the parent directory resolves inside MEMORIES_DIR
  try {
    const parentReal = fs.realpathSync(path.dirname(resolved));
    const memoriesReal = fs.realpathSync(MEMORIES_DIR);
    const realPrefix = memoriesReal.endsWith(path.sep) ? memoriesReal : memoriesReal + path.sep;
    if (parentReal !== memoriesReal && !parentReal.startsWith(realPrefix)) {
      throw new Error("Symlink traversal blocked: resolved path escapes memories/");
    }
  } catch (e: unknown) {
    // Parent doesn't exist yet (memory_write will create it) — verify the
    // closest existing ancestor still resolves inside MEMORIES_DIR, so a
    // symlinked ancestor can't be used to escape once the dir is created.
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
      const memoriesReal = fs.realpathSync(MEMORIES_DIR);
      const realPrefix = memoriesReal.endsWith(path.sep) ? memoriesReal : memoriesReal + path.sep;
      let ancestor = path.dirname(resolved);
      while (ancestor !== path.dirname(ancestor)) {
        if (fs.existsSync(ancestor)) {
          const ancestorReal = fs.realpathSync(ancestor);
          if (ancestorReal !== memoriesReal && !ancestorReal.startsWith(realPrefix)) {
            // eslint-disable-next-line preserve-caught-error -- reports the symlink escape, not the ENOENT being handled; `cause` would mislead
            throw new Error(
              "Symlink traversal blocked: nearest existing ancestor escapes memories/",
            );
          }
          break;
        }
        ancestor = path.dirname(ancestor);
      }
    } else {
      throw e;
    }
  }

  // Block symlink escapes at the LEAF itself. The parent/ancestor checks above
  // miss a symlink planted directly at the final path (e.g.
  // memories/leak.md -> /etc/passwd or a Windows junction): the parent resolves
  // cleanly inside memories/, but fs.readFileSync/fs.writeFileSync follow the
  // leaf symlink to read or overwrite an arbitrary host file. Memory files are
  // always regular files, so reject any symlinked leaf outright. lstatSync
  // reports a dangling symlink as a symlink too, so this also blocks a write
  // that would otherwise materialize a file off-tree through a broken link.
  let leafStat: fs.Stats | undefined;
  try {
    leafStat = fs.lstatSync(resolved);
  } catch (e: unknown) {
    // ENOENT => leaf doesn't exist yet (fresh memory_write); nothing to follow.
    if (!(e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT")) {
      throw e;
    }
  }
  if (leafStat?.isSymbolicLink()) {
    throw new Error("Symlink traversal blocked: memory path must not be a symlink");
  }

  return resolved;
}

export function getRelativePath(absPath: string): string {
  // Always emit forward slashes so the index keys are portable (the same
  // memory has the same key whether indexed on Windows or Linux/Cloud Run)
  // and so they render as valid links/paths in output. On POSIX path.sep is
  // already "/", so this is a no-op there.
  return path.relative(MEMORIES_DIR, absPath).split(path.sep).join("/");
}

export function readMemoryFile(filePath: string): { content: string; exists: boolean } {
  try {
    return { content: fs.readFileSync(filePath, "utf-8"), exists: true };
  } catch {
    return { content: "", exists: false };
  }
}

export function getAllMemoryFiles(): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      // Dirents describe the entry itself: a symlink is neither a directory
      // nor a file here, so linked folders and files are both skipped.
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
    }
  }
  walk(MEMORIES_DIR);
  return files;
}

export async function reindexFile(store: MemoryStore, filePath: string): Promise<number> {
  // Index regular files only. A symlink under memories/ can point anywhere
  // (a config file, another user's notes) and would put its content into
  // search results — the reason resolveMemoryPath already refuses to read or
  // write through one. The watcher and the sweeps reach files by name, so the
  // check belongs here, not only in the directory walk. A file that became a
  // symlink after it was indexed is dropped from the index.
  try {
    if (!fs.lstatSync(filePath).isFile()) {
      store.removeFile(getRelativePath(filePath));
      return 0;
    }
  } catch {
    return 0; // gone; the caller handles removal
  }
  const { content, exists } = readMemoryFile(filePath);
  if (!exists) return 0;

  const { metadata } = parseFrontmatter(content);
  const importance = typeof metadata.importance === "number" ? metadata.importance : 5;
  const relPath = getRelativePath(filePath);

  // Skip re-embedding if content hasn't changed
  if (!store.hasContentChanged(relPath, content)) {
    return 0;
  }

  const chunks = chunkMarkdown(content, relPath);
  if (chunks.length === 0) {
    // The body was emptied (or never had one): drop what was indexed for it.
    store.clearFile(relPath, content, importance);
    return 0;
  }
  let mtimeMs: number | undefined;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    // raced with a delete; the index date falls back to now
  }
  await store.indexChunks(chunks, importance, content, {
    contentDate: [metadata.updated, metadata.created],
    mtimeMs,
  });
  return chunks.length;
}

/**
 * Index every memory file, each on its own: one failure (an embedding API
 * error, a file that cannot be read) is logged and skipped rather than
 * aborting the pass. At startup an uncaught failure used to exit the
 * process, and the periodic sweep stopped at the first bad file. Index state
 * for files no longer on disk is dropped.
 */
/**
 * Index a file that was just written. The write is what the caller asked
 * for and it has happened; a failure to index it (embeddings unreachable,
 * say) must not turn into an error, or a retry writes the entry twice.
 * The content hash is stored only after a successful embed, so the next
 * sweep indexes the file. Returns a note to add to the result instead.
 */
export async function indexAfterWrite(
  store: MemoryStore,
  fullPath: string,
): Promise<{ chunks: number; note: string }> {
  try {
    return { chunks: await reindexFile(store, fullPath), note: "" };
  } catch (err) {
    process.stderr.write(
      `Memoria: indexing ${getRelativePath(fullPath)} deferred: ${(err as Error).message}\n`,
    );
    return {
      chunks: 0,
      note: ` (saved, but indexing is deferred: ${(err as Error).message}; the periodic reindex retries it)`,
    };
  }
}

/** The sweep in progress, if any, and how far it has got. */
let sweepInFlight: Promise<{ files: number; chunks: number; failed: string[] }> | null = null;
const sweepProgress = { done: 0, total: 0 };

/**
 * While a rebuild (provider or index format change) is still re-embedding
 * the store, a line saying search results may be incomplete; else null.
 * The server answers the client before that sweep finishes.
 */
export function indexRebuildNote(store: MemoryStore): string | null {
  if (!store.needsReindex || !sweepInFlight) return null;
  return (
    `Note: the search index is being rebuilt (${sweepProgress.done} of ${sweepProgress.total} ` +
    `files done); results may be incomplete until it finishes.`
  );
}

/**
 * Index every memory file (unchanged ones are skipped by hash) and drop the
 * index entries of deleted ones. One sweep runs at a time: a call while one
 * is running joins it, or with `fresh` (after a forced re-embed was asked
 * for) waits for it and then runs another.
 */
export async function reindexAll(
  store: MemoryStore,
  opts: { shouldStop?: () => boolean; fresh?: boolean } = {},
): Promise<{ files: number; chunks: number; failed: string[] }> {
  while (sweepInFlight) {
    if (!opts.fresh) return sweepInFlight;
    await sweepInFlight.catch(() => {});
  }
  const run = sweep(store, opts.shouldStop).finally(() => {
    sweepInFlight = null;
  });
  sweepInFlight = run;
  return run;
}

async function sweep(
  store: MemoryStore,
  shouldStop?: () => boolean,
): Promise<{ files: number; chunks: number; failed: string[] }> {
  const files = getAllMemoryFiles();
  let chunks = 0;
  const failed: string[] = [];
  sweepProgress.done = 0;
  sweepProgress.total = files.length;
  for (const f of files) {
    if (shouldStop?.() || store.fenced) break;
    try {
      chunks += await reindexFile(store, f);
    } catch (err) {
      failed.push(getRelativePath(f));
      process.stderr.write(
        `Memoria: indexing ${getRelativePath(f)} failed (skipped, retried on the next sweep): ${(err as Error).message}\n`,
      );
    }
    sweepProgress.done++;
    // Let I/O in between files: with a synchronous provider (hash) the
    // awaits above never reach the event loop, and a whole-store sweep held
    // off the client's requests, the handshake included, until it finished.
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!shouldStop?.() && !store.fenced) {
    // A file written while this pass ran is not in `files`; a second
    // listing finds it. It used to ask lstat, which on a case-insensitive
    // filesystem (macOS, Windows) also "found" a file under its old
    // spelling after a case-only rename, so the old key, with the text the
    // user had since removed, was never dropped.
    const fresh = new Set(getAllMemoryFiles().map(getRelativePath));
    store.retainFiles(files.map(getRelativePath), (rel) => fresh.has(rel));
    if (failed.length === 0) store.needsReindex = false;
  }
  return { files: files.length, chunks, failed };
}

/**
 * Everything a server runs after it has answered its client: the startup
 * sweep (a provider change or index upgrade re-embeds the whole store,
 * which took longer than an MCP client waits for the handshake), then the
 * watcher and the periodic jobs. Resolves when the startup sweep is done.
 */
export async function startBackgroundIndexing(
  store: MemoryStore,
  opts: { watch: boolean; shouldStop: () => boolean },
): Promise<void> {
  if (store.needsReindex) {
    process.stderr.write(
      "Memoria: full reindex (embedding provider or index format changed) running in the background...\n",
    );
  }
  // Per file: one failure is logged and skipped instead of exiting. A stop
  // signal during a long first index stops before shutdown() closes the
  // store under the next reindexFile. Files deleted while the server was
  // down are dropped.
  const indexed = await reindexAll(store, { shouldStop: opts.shouldStop });
  if (opts.shouldStop()) return;
  process.stderr.write(
    `Memoria: indexed ${indexed.files} memory files` +
      (indexed.failed.length ? ` (${indexed.failed.length} failed, see above).\n` : ".\n"),
  );
  if (opts.watch) setupWatcher(store);
  // fs.watch is inert on the GCS FUSE / Cloud Run mount, so sweep
  // periodically to pick up memory files changed by `git pull` elsewhere.
  setupPeriodicReindex(store);
  setupPeriodicOptimize(store); // no-op unless MEMORIA_AUTO_OPTIMIZE=true
  setupPeriodicCompile(store); // no-op unless MEMORIA_AUTO_COMPILE=true
  setupPrimaryTakeover(store); // no-op in the primary
}

// ─── File watcher (1.5s debounce) ───────────────────────────

/**
 * In a secondary server, try every 30s to take over the store lock (the
 * primary may have exited), and resume the collector once promoted.
 */
export function setupPrimaryTakeover(store: MemoryStore): NodeJS.Timeout | null {
  if (store.isPrimary) return null;
  const timer = setInterval(() => {
    try {
      if (store.tryBecomePrimary()) {
        clearInterval(timer);
        void resumeCollectorIfConfigured(store);
        for (const run of onPromotion) run();
        // Promotion found the index built by another provider and cleared
        // it: rebuild now rather than at the next periodic sweep.
        if (store.needsReindex) {
          void reindexAll(store).catch((err) =>
            process.stderr.write(
              `Memoria: rebuild after takeover failed: ${(err as Error).message}\n`,
            ),
          );
        }
      }
    } catch (err) {
      process.stderr.write(`Memoria: lock takeover check failed: ${(err as Error).message}\n`);
    }
  }, 30_000);
  timer.unref?.();
  return timer;
}

function existsWithExactName(file: string): boolean {
  try {
    return fs.readdirSync(path.dirname(file)).includes(path.basename(file));
  } catch {
    return false;
  }
}

export function setupWatcher(store: MemoryStore): void {
  if (!fs.existsSync(MEMORIES_DIR)) return;

  let watchDebounce: NodeJS.Timeout | null = null;
  const pendingChanges = new Set<string>();

  fs.watch(MEMORIES_DIR, { recursive: true }, (_event, filename) => {
    if (!filename || !filename.endsWith(".md")) return;
    const fullPath = path.join(MEMORIES_DIR, filename);
    pendingChanges.add(fullPath);

    if (watchDebounce) clearTimeout(watchDebounce);
    watchDebounce = setTimeout(async () => {
      // Snapshot and clear up front so changes arriving during the await aren't
      // lost, and so a throw can't leave stale entries pending.
      const changed = [...pendingChanges];
      pendingChanges.clear();
      for (const file of changed) {
        try {
          // By exact spelling: after a case-only rename, the old name still
          // "exists" on a case-insensitive filesystem; its key is dropped and
          // the new name, which has its own event, is indexed under its own.
          if (existsWithExactName(file)) {
            await reindexFile(store, file);
          } else {
            store.removeFile(getRelativePath(file));
          }
        } catch (err) {
          // One bad file must not drop the batch or escape as an unhandled
          // promise rejection (mirrors the periodic sweep's error handling).
          process.stderr.write(
            `Memoria: watcher reindex of ${file} failed: ${(err as Error).message}\n`,
          );
        }
      }
    }, 1500);
  });
}

// ─── Periodic reindex sweep ─────────────────────────────────

/**
 * Fallback reindexer for environments where fs.watch is unreliable or inert
 * (notably GCS FUSE / Cloud Run mounts, which don't emit inotify events, so
 * edits from `git pull` on another device would otherwise never get indexed).
 *
 * Cheap by design: reindexFile() skips unchanged files via content hashing, so
 * each sweep only re-embeds what actually changed. Deleted files are dropped
 * from the index. Interval overridable via MEMORIA_REINDEX_INTERVAL_MS.
 */
/** setInterval's limit: a longer delay overflows and fires every 1 ms. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * An interval from the environment, in ms. A value that is not a whole
 * number of ms in [minMs, MAX_TIMER_MS] ("5m", "0", "abc", a number past
 * setInterval's limit) used to reach setInterval as NaN, 0 or an overflow,
 * all of which run the job every millisecond. It is refused with a warning
 * and the default used.
 */
export function intervalFromEnv(name: string, defMs: number, minMs = 10_000): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defMs;
  return checkedInterval(Number(raw), defMs, minMs, `${name}=${raw}`);
}

function checkedInterval(ms: number, defMs: number, minMs: number, label: string): number {
  if (Number.isInteger(ms) && ms >= minMs && ms <= MAX_TIMER_MS) return ms;
  process.stderr.write(
    `Memoria: ignoring ${label}: an interval must be a whole number of milliseconds from ` +
      `${minMs} to ${MAX_TIMER_MS}; using ${defMs}.\n`,
  );
  return defMs;
}

/** Jobs to run as soon as a secondary becomes the primary (overdue passes). */
const onPromotion: Array<() => void> = [];

/**
 * Run `job` every `intervalMs`, counted across restarts: the time of its last
 * run is kept in the store (`metaKey`), and a check every hour (or every
 * interval, if shorter) runs it once that much time has passed. A plain
 * setInterval restarted its count with every process start, so a daily job
 * in a stdio server (one per Claude session) or a scale-to-zero deployment
 * practically never ran. Only the primary runs it; a secondary that takes
 * over runs whatever is overdue at once.
 */
function scheduleDue(
  store: MemoryStore,
  metaKey: string,
  intervalMs: number,
  job: () => Promise<void> | void,
): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (!store.isPrimary || store.fenced || running) return;
    const last = Number(store.getMeta(metaKey));
    // A minute's slack: an hourly check landing just short of the mark.
    if (Number.isFinite(last) && Date.now() - last < intervalMs - 60_000) return;
    running = true;
    try {
      await job();
      store.setMeta(metaKey, String(Date.now()));
    } catch (err) {
      process.stderr.write(`Memoria: scheduled ${metaKey} failed: ${(err as Error).message}\n`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), Math.min(intervalMs, 3_600_000));
  timer.unref?.();
  onPromotion.push(() => void tick());
  void tick();
  return timer;
}

export function setupPeriodicReindex(
  store: MemoryStore,
  intervalMs = intervalFromEnv("MEMORIA_REINDEX_INTERVAL_MS", 300_000),
): NodeJS.Timeout {
  intervalMs = checkedInterval(intervalMs, 300_000, 1_000, "the reindex interval");
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      // Per-file failures are logged inside; removed files are dropped.
      await reindexAll(store);
      // Keep MEMORY_INDEX.md fresh so it never drifts from the territory
      // (Karpathy rule VII). Idempotent — only writes when content changed.
      rebuildMarkdownIndex();
    } catch (err) {
      process.stderr.write(`Memoria: periodic reindex failed: ${(err as Error).message}\n`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(sweep, intervalMs);
  timer.unref?.();
  return timer;
}

/**
 * Optional autonomous maintenance: periodically run the idempotent optimize
 * passes (decay / promote / staleness) so the "self-managing" behaviors run
 * without an agent having to invoke memory_optimize. OFF by default to avoid
 * changing behavior for existing deployments — enable with
 * MEMORIA_AUTO_OPTIMIZE=true (interval via MEMORIA_OPTIMIZE_INTERVAL_MS,
 * default 24h). decay/promote track their last-run date, so repeated runs are
 * safe. Returns null when disabled.
 */
export function setupPeriodicOptimize(
  store: MemoryStore,
  intervalMs = intervalFromEnv("MEMORIA_OPTIMIZE_INTERVAL_MS", 24 * 60 * 60 * 1000),
): NodeJS.Timeout | null {
  if (process.env.MEMORIA_AUTO_OPTIMIZE !== "true") return null;
  intervalMs = checkedInterval(intervalMs, 24 * 60 * 60 * 1000, 10_000, "the optimize interval");

  // Only the primary maintains the store; a secondary sharing it skips.
  const run = () => {
    for (const action of ["decay", "promote", "detect_stale"] as const) {
      const r = runOptimize(store, action);
      if (r.affected > 0) {
        process.stderr.write(`Memoria auto-optimize: ${action} affected ${r.affected}\n`);
      }
    }
  };

  const timer = scheduleDue(store, "last_auto_optimize", intervalMs, run);
  process.stderr.write(
    `Memoria: auto-optimize enabled (every ${Math.round(intervalMs / 3_600_000)}h).\n`,
  );
  return timer;
}

/**
 * Optional autonomous compilation (Karpathy rule IV: "compile, don't retrieve").
 * Periodically rolls the daily-log firehose up into durable, linked entity
 * pages and refreshes the index, so the wiki *compounds* without an agent
 * having to invoke memory_entities. OFF by default — enable with
 * MEMORIA_AUTO_COMPILE=true (interval via MEMORIA_COMPILE_INTERVAL_MS, default
 * 24h). Deterministic and idempotent, so repeated runs are safe. When the P2
 * propagation queue has touched-source hints, only those pages are rebuilt;
 * otherwise it does a full rollup. Returns null when disabled.
 */
export function setupPeriodicCompile(
  store: MemoryStore,
  intervalMs = intervalFromEnv("MEMORIA_COMPILE_INTERVAL_MS", 24 * 60 * 60 * 1000),
): NodeJS.Timeout | null {
  if (process.env.MEMORIA_AUTO_COMPILE !== "true") return null;
  intervalMs = checkedInterval(intervalMs, 24 * 60 * 60 * 1000, 10_000, "the compile interval");

  const run = async () => {
    // Drain the ingest-driven queue (P2): if specific sources were touched
    // since the last run, rebuild just those; else do a full rollup.
    const touched = drainCompileQueue();
    const res = buildEntityPages(MEMORIES_DIR, touched.length > 0 ? { onlySources: touched } : {});
    for (const rel of res.written) {
      try {
        await reindexFile(store, resolveMemoryPath(rel));
      } catch (err) {
        process.stderr.write(
          `Memoria auto-compile: reindex of ${rel} failed: ${(err as Error).message}\n`,
        );
      }
    }
    if (res.written.length > 0) {
      rebuildMarkdownIndex();
      process.stderr.write(`Memoria auto-compile: updated ${res.written.length} entity page(s).\n`);
    }
  };

  const timer = scheduleDue(store, "last_auto_compile", intervalMs, run);
  process.stderr.write(
    `Memoria: auto-compile enabled (every ${Math.round(intervalMs / 3_600_000)}h).\n`,
  );
  return timer;
}

// ─── Ingest-driven compile queue (P2) ───────────────────────
//
// When the collector writes a new fact, it records the touched source name here
// so the next compile pass refreshes exactly the entity pages that fact changed,
// instead of rebuilding the whole store (Karpathy rule V: trace the implications
// of a source across the graph). Persisted as a sidecar under data/ so it
// survives restarts; never indexed as a memory.

const COMPILE_QUEUE_SIDECAR = ".compile-queue.json";
function compileQueuePath(): string {
  return path.join(DATA_DIR, COMPILE_QUEUE_SIDECAR);
}

/** Add source names to the compile queue (idempotent set semantics). */
export function enqueueCompileSources(sources: string[]): void {
  if (!sources || sources.length === 0) return;
  try {
    const existing = drainCompileQueuePeek();
    const merged = new Set([...existing, ...sources.filter((s) => s && s.trim())]);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    writeFileAtomic(compileQueuePath(), JSON.stringify([...merged]));
  } catch (err) {
    process.stderr.write(
      `Memoria: compile-queue enqueue failed (non-fatal): ${(err as Error).message}\n`,
    );
  }
}

function drainCompileQueuePeek(): string[] {
  try {
    const arr = JSON.parse(fs.readFileSync(compileQueuePath(), "utf-8"));
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

/** Read and clear the compile queue, returning the touched source names.
 * Claims the queue by atomic rename first, so an enqueue landing during the
 * drain writes a fresh queue file instead of being deleted unread (H3). */
export function drainCompileQueue(): string[] {
  // Clean orphaned claim files from crashed drains (older than an hour).
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (!f.startsWith(`${COMPILE_QUEUE_SIDECAR}.claim-`)) continue;
      const p = path.join(DATA_DIR, f);
      try {
        if (Date.now() - fs.statSync(p).mtimeMs > 3600_000) fs.rmSync(p, { force: true });
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort
  }
  const claim = `${compileQueuePath()}.claim-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(compileQueuePath(), claim);
  } catch {
    return [];
  }
  try {
    const arr = JSON.parse(fs.readFileSync(claim, "utf-8"));
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  } finally {
    try {
      fs.rmSync(claim, { force: true });
    } catch {
      // best-effort
    }
  }
}

// ─── Tool registration ──────────────────────────────────────

/**
 * Server description sent to every connecting client, shared by the stdio
 * (index.ts) and HTTP (http.ts) entry points so the two cannot drift apart.
 *
 * Deliberately encouraging rather than mandatory. Earlier versions told every
 * client that each session MUST write a daily log entry and that a session
 * without one "is a failed session" — the maintainer's own workflow, stated as
 * a rule for everyone who installs the package. Users who want that discipline
 * can still say so in their own instructions (a CLAUDE.md, a hook).
 */
export const SERVER_DESCRIPTION =
  "Persistent, plain-text memory for Claude: Markdown files the user owns, " +
  "searchable across sessions and devices. Search it when earlier context " +
  "would help. Record what is worth keeping — decisions, preferences, problems " +
  "solved, how a piece of work ended — with memory_daily, or memory_write for " +
  "lasting facts. A short entry after substantial work is usually enough.";

export function registerTools(server: McpServer, store: MemoryStore): void {
  // Tool 1: memory_search
  server.tool(
    "memory_search",
    "Semantic + keyword hybrid search across all memories. Uses three-signal scoring: 0.8·relevance + 0.1·recency + 0.1·importance.",
    {
      query: z.string().min(1).max(2000).describe("Search query (max 2000 characters)"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(10)
        .describe("Maximum results to return (1-100)"),
    },
    async ({ query, max_results }) => {
      const results = await store.search(query, max_results);
      const rebuilding = indexRebuildNote(store);
      if (results.length === 0) {
        const none = "No matching memories found.";
        return {
          content: [
            { type: "text" as const, text: rebuilding ? `${none}\n\n${rebuilding}` : none },
          ],
        };
      }

      // Results are returned in score order — the consumer is an LLM reading a
      // ranked list, so we don't apply human serial-position reordering.

      // Searching is the dominant access path; record it so frequently-surfaced
      // memories get boosted and don't get flagged stale. Best-effort: a write
      // hiccup (e.g. flaky storage) must never fail an otherwise-good search.
      const distinctFiles = [...new Set(results.map((r) => r.file))];
      try {
        store.trackAccessBatch(distinctFiles);
      } catch (err) {
        process.stderr.write(
          `Memoria: access tracking failed (non-fatal): ${(err as Error).message}\n`,
        );
      }

      let output = results
        .map(
          (r, i) =>
            `**${i + 1}. ${r.file}** (lines ${r.startLine}-${r.endLine})\n` +
            `   Score: ${r.score.toFixed(3)} (relevance: ${r.relevanceScore.toFixed(2)}, importance: ${r.importanceScore.toFixed(1)}, recency: ${r.recencyScore.toFixed(2)})\n` +
            `   ${r.text.slice(0, 300)}${r.text.length > 300 ? "..." : ""}`,
        )
        .join("\n\n");

      // Make partial recall visible (Karpathy-review B3): if the semantic scan
      // couldn't cover the whole store, say so instead of implying full recall.
      const cov = results[0];
      if (cov && cov.scannedChunks < cov.totalChunks) {
        output +=
          `\n\n*Coverage note: semantic scan sampled ${cov.scannedChunks}/${cov.totalChunks} chunks ` +
          `(store exceeds MEMORIA_VECTOR_SCAN_CAP). Keyword (FTS) matching still covered everything; ` +
          `raise the cap for exhaustive semantic recall.*`;
      }
      if (rebuilding) output += `\n\n*${rebuilding}*`;

      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  // Tool 2: memory_read
  server.tool(
    "memory_read",
    "Read a specific memory file. Returns empty text (not error) if file doesn't exist.",
    {
      file: z.string().describe("File path relative to memories/ directory"),
      start_line: z.number().int().min(1).optional().describe("Optional start line (1-based)"),
      count: z
        .number()
        .int()
        .min(1)
        .max(100000)
        .optional()
        .describe("Optional number of lines to read"),
    },
    async ({ file, start_line, count }) => {
      // Reject NUL bytes (would throw deep in fs); treat as "not found".
      if (file.includes("\0")) {
        return { content: [{ type: "text" as const, text: "" }] };
      }
      // memory_read's contract is graceful: a traversal/symlink-escape input
      // must return empty (like a missing file), not throw.
      let fullPath: string;
      try {
        fullPath = resolveMemoryPath(file);
      } catch {
        return { content: [{ type: "text" as const, text: "" }] };
      }
      const { content, exists } = readMemoryFile(fullPath);

      if (!exists) {
        return { content: [{ type: "text" as const, text: "" }] };
      }

      try {
        store.trackAccess(getRelativePath(fullPath));
      } catch (err) {
        process.stderr.write(
          `Memoria: access tracking failed (non-fatal): ${(err as Error).message}\n`,
        );
      }

      let output = content;
      if (start_line !== undefined) {
        const lines = content.split("\n");
        const start = Math.max(0, start_line - 1);
        const end = count !== undefined ? start + count : lines.length;
        output = lines.slice(start, end).join("\n");
      }

      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  // Tool 3: memory_write
  server.tool(
    "memory_write",
    "Create or update a memory file. Checks for similar existing memories before writing (dedup). Returns similar memories if found so the agent can decide: ADD, UPDATE, or NOOP.",
    {
      file: z
        .string()
        .describe("File path relative to memories/ directory (e.g., 'project/new-feature.md')"),
      content: z.string().describe("Full file content including YAML frontmatter"),
      force: z.boolean().optional().default(false).describe("Skip dedup check and write directly"),
    },
    async ({ file, content: fileContent, force }) => {
      // Validate filename shape (character set + .md). Containment against
      // traversal is enforced separately by resolveMemoryPath below.
      if (!isValidMemoryFilename(file)) {
        return {
          content: [
            { type: "text" as const, text: "Error: filename must match [a-zA-Z0-9_-/.]+.md" },
          ],
        };
      }

      // Content size limit: 100KB (measure BYTES, not UTF-16 code units, so
      // multi-byte content can't slip past the cap).
      if (Buffer.byteLength(fileContent, "utf8") > 100 * 1024) {
        return {
          content: [{ type: "text" as const, text: "Error: content exceeds 100KB limit" }],
        };
      }

      const fullPath = resolveMemoryPath(file);
      const relFile = getRelativePath(fullPath);

      // Write-time dedup: check top-3 similar memories before writing
      if (!force) {
        const { body } = parseFrontmatter(fileContent);
        if (body.trim()) {
          const similar = await store.findSimilar(body, 3);
          // Exclude self by the NORMALIZED relative path — the raw `file` input
          // may be unnormalized (e.g. "./project/x.md") and wouldn't match
          // s.file, causing a file to flag itself as its own duplicate.
          const highSimilarity = similar.filter((s) => s.similarity > 0.85 && s.file !== relFile);

          if (highSimilarity.length > 0) {
            const dupList = highSimilarity
              .map(
                (s) =>
                  `- **${s.file}** (similarity: ${(s.similarity * 100).toFixed(1)}%)\n  ${s.text.slice(0, 200)}...`,
              )
              .join("\n");

            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `**Potential duplicates found!** Review before writing:\n\n${dupList}\n\n` +
                    `Decide: **UPDATE** an existing file, **ADD** with force=true, or **NOOP** to skip.`,
                },
              ],
            };
          }
        }
      }

      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      writeFileAtomic(fullPath, fileContent);

      const indexed = await indexAfterWrite(store, fullPath);

      return {
        content: [
          {
            type: "text" as const,
            text: `Written: ${file} (${indexed.chunks} chunks indexed)${indexed.note}`,
          },
        ],
      };
    },
  );

  // Tool 4: memory_list
  server.tool(
    "memory_list",
    "List all memory files with their metadata. Optionally filter by type or tag.",
    {
      type: z.string().optional().describe("Filter by memory type"),
      tag: z.string().optional().describe("Filter by tag"),
    },
    async ({ type, tag }) => {
      const files = getAllMemoryFiles();
      const entries: Array<{
        file: string;
        name: string;
        type: string;
        importance: number;
        updated: string;
      }> = [];

      for (const f of files) {
        const { content } = readMemoryFile(f);
        const { metadata } = parseFrontmatter(content);
        const relPath = getRelativePath(f);

        const memType = (metadata.type as string) || "unknown";
        const memTags = frontmatterTags(metadata.tags);

        if (type && memType !== type) continue;
        if (tag && !memTags.includes(tag)) continue;

        entries.push({
          file: relPath,
          name: (metadata.name as string) || path.basename(f, ".md"),
          type: memType,
          importance: (metadata.importance as number) || 5,
          updated: (metadata.updated as string) || "unknown",
        });
      }

      if (entries.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No memories found matching filters." }],
        };
      }

      entries.sort((a, b) => b.importance - a.importance);

      const output = entries
        .map(
          (e) =>
            `- **${e.name}** (${e.type}, importance: ${e.importance})\n  ${e.file} — updated: ${e.updated}`,
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `${entries.length} memor${entries.length === 1 ? "y" : "ies"} found:\n\n${output}`,
          },
        ],
      };
    },
  );

  // Tool 5: memory_index
  server.tool(
    "memory_index",
    "Re-index changed memory files, drop deleted ones, and rebuild the MEMORY_INDEX.md catalog. Use after bulk changes. force=true re-embeds every file even if unchanged (repairs a damaged index).",
    {
      force: z
        .boolean()
        .optional()
        .describe("Re-embed every file, not only changed ones (default false)"),
    },
    async ({ force }) => {
      // Unchanged files are skipped by content hash, so without force this
      // could not repair an index whose rows were damaged.
      if (force) store.forgetContentHashes();
      const result = await reindexAll(store, { fresh: force });
      const files = { length: result.files };
      const totalChunks = result.chunks;

      const indexSummary = rebuildMarkdownIndex();

      return {
        content: [
          {
            type: "text" as const,
            text: `Indexed ${files.length} files → ${totalChunks} chunks\n${indexSummary}`,
          },
        ],
      };
    },
  );

  // Tool 6: memory_daily
  server.tool(
    "memory_daily",
    "Append an entry to today's daily log (the file is created if it doesn't exist). Use it for what is worth remembering later: decisions made, preferences learned, problems solved, how a piece of work ended. A short summary after substantial work is a good default; routine or trivial sessions don't need one.",
    {
      // Same ceiling as the dashboard journal. Without one, a single call
      // could append megabytes to a file every later read and reindex pays for.
      entry: z.string().max(50_000).describe("The text to append to today's daily log"),
    },
    async ({ entry }) => {
      // Daily logs are UTC days (the dashboard journal and ingestion agree).
      const today = new Date().toISOString().split("T")[0];
      // Refuses a symlinked daily/ or log (see daily-paths.ts).
      const dailyFile = dailyLogPath(MEMORIES_DIR, today);

      // Daily logs are append-only and may be written concurrently by the
      // collector's ingestion path (which uses appendFileSync). A
      // read-modify-write here would clobber an append that landed between our
      // read and write, so append atomically (O_APPEND) instead — and create
      // the file exclusively, so two writers that both find it missing cannot
      // truncate each other's first entry.
      const header = `---\nname: Daily log ${today}\ndescription: Session log for ${today}\ntype: session\nimportance: 3\ncreated: ${today}\nupdated: ${today}\ntags: [daily]\n---\n\n# Daily Log — ${today}\n\n`;
      createOrAppend(dailyFile, header + entry, `\n${entry}`);

      const indexed = await indexAfterWrite(store, dailyFile);
      // Refresh the index so a new day's log is immediately navigable
      // (idempotent — no-op when the catalog is unchanged).
      try {
        rebuildMarkdownIndex();
      } catch (err) {
        process.stderr.write(
          `Memoria: index refresh after daily write failed (non-fatal): ${(err as Error).message}\n`,
        );
      }

      return {
        content: [
          { type: "text" as const, text: `Appended to daily log: ${today}${indexed.note}` },
        ],
      };
    },
  );

  // Tool 7: memory_optimize
  server.tool(
    "memory_optimize",
    "Run memory optimization: decay old importance, promote frequent memories, detect stale, find duplicates.",
    {
      action: z
        .enum(["decay", "promote", "detect_stale", "find_duplicates"])
        .describe("Optimization action to run"),
    },
    async ({ action }) => {
      const result = runOptimize(store, action);
      return {
        content: [
          {
            type: "text" as const,
            text: `**${result.action}** — ${result.affected} affected\n\n${result.details.join("\n")}`,
          },
        ],
      };
    },
  );

  // Tool 8: memory_reflect
  server.tool(
    "memory_reflect",
    "Read recent daily logs and return their content for the agent to synthesize reflections.",
    {
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .default(7)
        .describe("Number of days of daily logs to read (1-365)"),
      max_chars: z
        .number()
        .int()
        .min(1)
        .max(100000)
        .optional()
        .default(50000)
        .describe("Max characters of log content to return, newest first (1-100000)"),
    },
    async ({ days, max_chars }) => {
      const dailyDir = path.join(MEMORIES_DIR, "daily");
      if (!fs.existsSync(dailyDir)) {
        return { content: [{ type: "text" as const, text: "No daily logs found." }] };
      }

      const files = listDailyLogNames(MEMORIES_DIR).sort().reverse().slice(0, days);

      if (files.length === 0) {
        return { content: [{ type: "text" as const, text: "No daily logs found." }] };
      }

      // Bounded, newest first: a year of collector logs in one response
      // went past the stdio transport's 10 MB message limit and dropped the
      // connection.
      const logs: string[] = [];
      let budget = max_chars;
      for (const f of files) {
        if (budget <= 0) break;
        const content = fs.readFileSync(path.join(dailyDir, f), "utf-8");
        const block = `## ${f}\n\n${content}`;
        logs.push(block.length > budget ? block.slice(0, budget) : block);
        budget -= block.length;
      }
      const truncated =
        budget < 0 || logs.length < files.length
          ? `\n\n*(truncated at max_chars=${max_chars}: ${logs.length} of ${files.length} log(s) shown, ` +
            `the last one cut; raise max_chars or lower days)*`
          : "";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${files.length} daily log(s). Review these for recurring themes and synthesize reflections:\n\n` +
              logs.join("\n\n---\n\n") +
              truncated,
          },
        ],
      };
    },
  );

  // Tool 9: memory_stats
  server.tool(
    "memory_stats",
    "Get memory store health metrics: total memories, importance distribution, stale count, access patterns, and health warnings.",
    {},
    async () => {
      const stats = store.getStats();
      const fileCount = getAllMemoryFiles().length;

      // Build importance distribution bar chart
      const distLines: string[] = [];
      for (let i = 1; i <= 10; i++) {
        const count = stats.importanceDistribution[i] || 0;
        const bar = "█".repeat(Math.min(count, 30));
        if (count > 0) {
          distLines.push(`  ${i.toString().padStart(2)}: ${bar} ${count}`);
        }
      }

      // Health warnings
      const warnings: string[] = [];
      if (stats.avgImportance > 7) {
        warnings.push("- Score inflation: avg importance > 7 — consider recalibrating scores");
      }
      if (stats.staleCount > stats.totalFiles * 0.3) {
        warnings.push(
          `- ${stats.staleCount} stale files (>30% of total) — run memory_optimize detect_stale`,
        );
      }
      if (fileCount > stats.totalFiles + 2) {
        warnings.push(
          `- ${fileCount - stats.totalFiles} files on disk not indexed — run memory_index`,
        );
      }

      // Source activity: scan last 7 daily logs to count events per source
      const sourceCounts = new Map<string, number>();
      const dailyDir = path.join(MEMORIES_DIR, "daily");
      let dailyLogCount = 0;
      let totalRecentEvents = 0;
      if (fs.existsSync(dailyDir)) {
        const recent = listDailyLogNames(MEMORIES_DIR).sort().reverse().slice(0, 7);
        dailyLogCount = recent.length;
        for (const f of recent) {
          const content = fs.readFileSync(path.join(dailyDir, f), "utf-8");
          const matches = content.matchAll(
            new RegExp(String.raw`^## ${TIME_LABEL_SRC} — ([\w-]+)`, "gm"),
          );
          for (const m of matches) {
            sourceCounts.set(m[1], (sourceCounts.get(m[1]) || 0) + 1);
            totalRecentEvents++;
          }
        }
      }
      const topSources = Array.from(sourceCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

      // Detect repetitive sources (likely scheduled jobs flooding the log)
      const repetitiveSources = topSources.filter(([, n]) => n > 50);
      if (repetitiveSources.length > 0) {
        warnings.push(
          `- ${repetitiveSources.length} source(s) generating >50 events/week — consider rate-limiting or filtering: ` +
            repetitiveSources.map(([s, n]) => `${s} (${n})`).join(", "),
        );
      }

      // Detect importance flatness (the actual bug found in the audit)
      if (stats.totalChunks > 100 && stats.medianImportance === stats.avgImportance) {
        warnings.push(
          `- Importance flatness: all ${stats.totalChunks} chunks have the same importance. ` +
            `Per-event scoring is being lost. Check if daily-log frontmatter is bumping with events.`,
        );
      }

      // Detect zero-access state (memory is write-only)
      const zeroAccessCount = stats.topAccessed.filter((f) => f.access_count === 0).length;
      if (stats.topAccessed.length > 0 && zeroAccessCount === stats.topAccessed.length) {
        warnings.push(
          `- All top files have 0 accesses — Memoria is being WRITTEN to but never QUERIED. ` +
            `Memory only compounds when agents call memory_search before answering.`,
        );
      }

      const output = [
        `**Memory Store Health**`,
        ``,
        `- Files on disk: ${fileCount}`,
        `- Indexed chunks: ${stats.totalChunks}`,
        `- Indexed files: ${stats.totalFiles}`,
        `- Average importance: ${stats.avgImportance}`,
        `- Median importance: ${stats.medianImportance}`,
        `- Stale files (>90d no access, importance <5): ${stats.staleCount}`,
        ``,
        `**Importance distribution:**`,
        ...(distLines.length > 0 ? distLines : ["  (no chunks indexed yet)"]),
        ``,
        `**Recent ingest (last ${dailyLogCount} daily logs, ${totalRecentEvents} events):**`,
        ...(topSources.length > 0
          ? topSources.map(([s, n]) => `- ${s}: ${n} events`)
          : ["  (no recent events)"]),
        ``,
        `**Most accessed:**`,
        ...(stats.topAccessed.length > 0
          ? stats.topAccessed.map((f) => `- ${f.file} (${f.access_count} accesses)`)
          : ["  (no access tracking yet)"]),
        ...(warnings.length > 0
          ? [``, `**Health warnings:**`, ...warnings]
          : [``, `No health warnings.`]),
        ...(indexRebuildNote(store) ? [``, indexRebuildNote(store)!] : []),
      ].join("\n");

      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  // Tool 10: memory_lint
  server.tool(
    "memory_lint",
    "Run proactive health checks: contradiction scan, orphan detection, stale cross-references, missing descriptions, gap analysis. Returns issues for agent review.",
    {},
    async () => {
      const result = await runLint(store, MEMORIES_DIR, getAllMemoryFiles, getRelativePath);
      const report = formatLintReport(result);
      return { content: [{ type: "text" as const, text: report }] };
    },
  );

  // Tool 11: memory_compile
  server.tool(
    "memory_compile",
    "Compile analysis results into a structured core memory. Auto-generates frontmatter, runs dedup check, places file in the correct subdirectory, and updates MEMORY_INDEX.md. Use this to make good query answers persist as permanent knowledge.",
    {
      content: z.string().describe("The analysis/answer text to compile into a memory"),
      name: z.string().describe("Short descriptive title"),
      type: z
        .enum(["user", "project", "decision", "feedback", "reference", "reflection", "pattern"])
        .describe("Memory type — determines subdirectory"),
      tags: z
        .array(z.string().max(100))
        .max(50)
        .describe("Tags for categorization (max 50, each max 100 characters)"),
      related: z
        .array(z.string().max(500))
        .max(50)
        .optional()
        .describe("Related memory file paths (e.g., ['user/profile.md']) (max 50)"),
    },
    async ({ content: bodyContent, name: memName, type: memType, tags, related }) => {
      // Size cap (matches memory_write; BYTES, not UTF-16 code units)
      if (Buffer.byteLength(bodyContent, "utf8") > 100 * 1024) {
        return {
          content: [{ type: "text" as const, text: "Error: content exceeds 100KB limit" }],
        };
      }

      // Compute importance based on type
      const TYPE_IMPORTANCE: Record<string, number> = {
        user: 8,
        decision: 7,
        feedback: 7,
        pattern: 7,
        project: 6,
        reference: 5,
        reflection: 6,
      };
      let importance = TYPE_IMPORTANCE[memType] || 5;
      if (bodyContent.length > 1000) importance = Math.min(10, importance + 1);
      if (bodyContent.length > 3000) importance = Math.min(10, importance + 1);

      // Generate filename slug
      const baseSlug =
        memName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60) || "memory";

      const TYPE_DIR: Record<string, string> = {
        user: "user",
        project: "project",
        decision: "decisions",
        feedback: "feedback",
        reference: "references",
        reflection: "sessions",
        pattern: "patterns",
      };
      const dir = TYPE_DIR[memType];
      if (!dir) {
        // Fail loudly instead of silently creating a non-standard directory.
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: unmapped type "${memType}". Update TYPE_DIR in tools.ts.`,
            },
          ],
        };
      }

      // Acquire a per-directory lock to serialize concurrent compiles to the
      // same dir. Ensures that collision detection + write happen atomically.
      const dirLockKey = `compile:${dir}`;
      while (compileLocks.has(dirLockKey)) {
        await compileLocks.get(dirLockKey);
      }
      let releaseLock!: () => void;
      const lockPromise = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      compileLocks.set(dirLockKey, lockPromise);

      // Collision detection: append -2, -3, etc. if filename exists.
      let slug = baseSlug;
      let relFile = `${dir}/${slug}.md`;
      let counter = 2;
      // resolveMemoryPath throws on a symlinked path: release the lock then,
      // or every later compile into this directory waited forever.
      const exists = (rel: string): boolean => {
        try {
          return fs.existsSync(resolveMemoryPath(rel));
        } catch (err) {
          compileLocks.delete(dirLockKey);
          releaseLock();
          throw err;
        }
      };
      while (exists(relFile)) {
        slug = `${baseSlug}-${counter}`;
        relFile = `${dir}/${slug}.md`;
        counter++;
        if (counter > 100) {
          compileLocks.delete(dirLockKey);
          releaseLock();
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: too many filename collisions for "${baseSlug}"`,
              },
            ],
          };
        }
      }

      // Auto-generate description (first sentence, max 120 chars).
      // Always strip newlines from the fallback so the description is valid YAML.
      const flat = bodyContent.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      const firstSentence = flat.match(/^.{1,120}[.!?]/)?.[0] || flat.slice(0, 120).trim();

      // Build frontmatter via js-yaml (proper escaping for quotes, commas, special chars)
      const today = new Date().toISOString().split("T")[0];
      const frontmatterObj: Record<string, unknown> = {
        name: memName,
        description: firstSentence,
        type: memType,
        importance,
        created: today,
        updated: today,
        last_accessed: today,
        access_count: 0,
        tags: tags.filter((t) => t && t.trim().length > 0),
        origin: "compiled",
      };
      if (related && related.length > 0) {
        frontmatterObj.related = related;
      }
      const frontmatterYaml = dump(frontmatterObj, {
        lineWidth: 200,
        schema: FRONTMATTER_WRITE_SCHEMA,
      });
      const fileContent = `---\n${frontmatterYaml}---\n\n${bodyContent}`;

      try {
        // Dedup check (same as memory_write)
        const similar = await store.findSimilar(bodyContent, 3);
        const highSimilarity = similar.filter((s) => s.similarity > 0.85 && s.file !== relFile);

        if (highSimilarity.length > 0) {
          const dupList = highSimilarity
            .map(
              (s) =>
                `- **${s.file}** (similarity: ${(s.similarity * 100).toFixed(1)}%)\n  ${s.text.slice(0, 200)}...`,
            )
            .join("\n");

          return {
            content: [
              {
                type: "text" as const,
                text:
                  `**Potential duplicates found!** Review before compiling:\n\n${dupList}\n\n` +
                  `To compile anyway, use memory_write with force=true for file "${relFile}".`,
              },
            ],
          };
        }

        // Write file. Exclusive create: the check above is in this process
        // only, and another server on the store (a second Claude window) may
        // have created the same name meanwhile; renaming over it lost that
        // file while both reported success. Take the next free name instead.
        let fullPath = resolveMemoryPath(relFile);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        while (!writeFileExclusive(fullPath, fileContent)) {
          if (counter > 100) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: too many filename collisions for "${baseSlug}"`,
                },
              ],
            };
          }
          slug = `${baseSlug}-${counter}`;
          relFile = `${dir}/${slug}.md`;
          fullPath = resolveMemoryPath(relFile);
          counter++;
        }

        const indexed = await indexAfterWrite(store, fullPath);
        let indexSummary = "";
        try {
          indexSummary = rebuildMarkdownIndex();
        } catch (err) {
          process.stderr.write(
            `Memoria: index refresh after compile failed (non-fatal): ${(err as Error).message}\n`,
          );
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Compiled: ${relFile} (importance: ${importance}, ${indexed.chunks} chunks indexed)${indexed.note}\n${indexSummary}`,
            },
          ],
        };
      } finally {
        compileLocks.delete(dirLockKey);
        releaseLock();
      }
    },
  );

  // Tool 12: memory_compact
  server.tool(
    "memory_compact",
    "Read the last N days of daily logs and return them grouped + de-duplicated " +
      "(by source + content) so the agent can summarize into a reflection memory. " +
      "Use this to compress the firehose of automated events into compounding " +
      "knowledge — call memory_compile with the synthesized output.",
    {
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .default(7)
        .describe("Number of recent daily logs to compact (1-365)"),
      max_chars: z
        .number()
        .int()
        .min(1)
        .max(100000)
        .optional()
        .default(15000)
        .describe("Max characters of output context (1-100000)"),
    },
    async ({ days, max_chars }) => {
      const dailyDir = path.join(MEMORIES_DIR, "daily");
      if (!fs.existsSync(dailyDir)) {
        return { content: [{ type: "text" as const, text: "No daily logs to compact." }] };
      }

      const files = listDailyLogNames(MEMORIES_DIR).sort().reverse().slice(0, days);

      if (files.length === 0) {
        return { content: [{ type: "text" as const, text: "No daily logs to compact." }] };
      }

      // Aggregate per-source (source -> sample content -> count)
      // This collapses repetitive automated events into a single line each.
      interface SourceStats {
        source: string;
        totalEvents: number;
        uniquePatterns: Map<string, number>; // first-100-chars -> count
        firstSeen: string;
        lastSeen: string;
      }
      const sources = new Map<string, SourceStats>();
      const allEntries: Array<{
        time: string;
        source: string;
        content: string;
        importance: number;
      }> = [];

      for (const file of files.reverse()) {
        const filePath = path.join(dailyDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const date = path.basename(file, ".md");

        // Parse `## TIME — SOURCE\n\nCONTENT\n*importance: N*` blocks
        const entryRegex = new RegExp(
          String.raw`## (${TIME_LABEL_SRC}) — ([\w-]+)(?:\s*\*\([^)]+\)\*)?\s*\n([\s\S]*?)(?=\n## |$)`,
          "g",
        );
        let m: RegExpExecArray | null;
        while ((m = entryRegex.exec(content)) !== null) {
          const [, time, source, body] = m;
          const imp = entryImportance(body);
          const cleanBody = stripImportanceTrailer(body).trim();
          const fingerprint = cleanBody.slice(0, 100);

          allEntries.push({ time: `${date} ${time}`, source, content: cleanBody, importance: imp });

          let stats = sources.get(source);
          if (!stats) {
            stats = {
              source,
              totalEvents: 0,
              uniquePatterns: new Map(),
              firstSeen: date,
              lastSeen: date,
            };
            sources.set(source, stats);
          }
          stats.totalEvents++;
          stats.uniquePatterns.set(fingerprint, (stats.uniquePatterns.get(fingerprint) || 0) + 1);
          stats.lastSeen = date;
        }
      }

      // Build the digest
      const lines: string[] = [];
      lines.push(`# Daily Log Digest (last ${files.length} days)\n`);
      lines.push(`Total events: ${allEntries.length} across ${sources.size} sources.\n`);

      // High-importance (>=7) events get listed individually
      const highImportance = allEntries.filter((e) => e.importance >= 7);
      if (highImportance.length > 0) {
        lines.push(`## High-importance events (${highImportance.length})\n`);
        for (const e of highImportance.slice(0, 30)) {
          lines.push(
            `- **${e.time}** [${e.source}] (importance ${e.importance}): ${e.content.slice(0, 200)}`,
          );
        }
        lines.push("");
      }

      // Per-source summary with deduped patterns
      lines.push(`## Source activity summary\n`);
      const sortedSources = Array.from(sources.values()).sort(
        (a, b) => b.totalEvents - a.totalEvents,
      );
      for (const s of sortedSources) {
        const distinctPatterns = s.uniquePatterns.size;
        const dedupRatio =
          s.totalEvents > 0 ? ((1 - distinctPatterns / s.totalEvents) * 100).toFixed(0) : "0";
        lines.push(`### ${s.source}`);
        lines.push(
          `- ${s.totalEvents} events | ${distinctPatterns} distinct patterns | ${dedupRatio}% repetitive`,
        );
        lines.push(`- Active ${s.firstSeen} → ${s.lastSeen}`);

        // Top 3 patterns by frequency
        const topPatterns = Array.from(s.uniquePatterns.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        for (const [pattern, count] of topPatterns) {
          lines.push(`  - ${count}× "${pattern.slice(0, 80)}..."`);
        }
        lines.push("");
      }

      lines.push(`---\n`);
      lines.push(
        `**Next step**: synthesize this into a reflection memory using \`memory_compile\` with ` +
          `\`type: "reflection"\` and importance 6-8 based on what you find. ` +
          `Focus on: recurring failure patterns, anomalies, decisions, things worth remembering.`,
      );

      let output = lines.join("\n");
      if (output.length > max_chars) {
        output = output.slice(0, max_chars) + "\n\n*(truncated)*";
      }

      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  // Tool 13: memory_entities
  server.tool(
    "memory_entities",
    "Compile the daily-log firehose into durable, linked **entity pages** (one " +
      "per source) under entities/. This is the 'compile, don't retrieve' loop: " +
      "scattered dated events become a stable, always-current rollup page that " +
      "links back to its source logs and is listed in the index. Deterministic " +
      "(no LLM) — for semantic synthesis use memory_compact + memory_compile. " +
      "Idempotent; never overwrites a page a human has taken over.",
    {
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .default(30)
        .describe("How many recent daily logs to roll up"),
      min_events: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(3)
        .describe("Minimum events from a source before it earns a page"),
    },
    async ({ days, min_events }) => {
      const res = buildEntityPages(MEMORIES_DIR, { days, minEvents: min_events });
      // Reindex new/changed pages and refresh the catalog so they're navigable.
      const notIndexed = new Set<string>();
      for (const rel of res.written) {
        try {
          await reindexFile(store, resolveMemoryPath(rel));
        } catch (err) {
          notIndexed.add(rel);
          process.stderr.write(
            `Memoria: reindex of ${rel} failed (non-fatal): ${(err as Error).message}\n`,
          );
        }
      }
      if (res.written.length > 0) rebuildMarkdownIndex();

      const lines = [
        `**Entity compilation** — scanned ${res.eventsScanned} events across ${res.sourcesSeen} source(s).`,
        `- Pages written/updated: ${res.written.length}`,
        ...res.written.map(
          (f) => `  - ${f}${notIndexed.has(f) ? " (not indexed yet; the next sweep retries)" : ""}`,
        ),
        ...(res.skipped.length > 0
          ? [
              `- Skipped (human-owned): ${res.skipped.length}`,
              ...res.skipped.map((f) => `  - ${f}`),
            ]
          : []),
      ];
      if (res.written.length === 0 && res.skipped.length === 0) {
        lines.push(`- No source met the ${min_events}-event threshold in the last ${days} days.`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}

// In-flight per-directory locks for memory_compile to prevent slug collisions
// when two requests target the same dir concurrently.
const compileLocks = new Map<string, Promise<void>>();

// ─── Markdown index rebuilder ──────────────────────────────────

/**
 * Escape characters that have meaning inside markdown link text.
 * Covers: backslash, brackets, backticks, asterisks, underscores, tilde.
 */
function escapeMarkdownText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/`/g, "\\`")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/~/g, "\\~");
}

/** Encode characters that are unsafe in markdown link URLs: spaces, `(`, `)`. */
function escapeMarkdownUrl(s: string): string {
  // Convert Windows backslashes to forward slashes for URL safety
  // "%" first, so a file name that contains one links to itself instead of
  // to whatever its "%xx" decodes to (or to a malformed URI).
  return s
    .replace(/\\/g, "/")
    .replace(/%/g, "%25")
    .replace(/ /g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

/** Escape pipes in table cells. */
function escapeTableCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Sentinel marking the start of a hand-curated appendix in MEMORY_INDEX.md.
 * Everything from this line to EOF is preserved verbatim across auto-rebuilds,
 * so curated cross-store pointers / sync notes survive the generator.
 */
const INDEX_MANUAL_SENTINEL =
  "<!-- MEMORIA:MANUAL — content below is preserved across auto-rebuilds -->";

/**
 * Rebuild MEMORY_INDEX.md as a navigable catalog grouped by type.
 * Inspired by Karpathy's index.md pattern for LLM wikis.
 *
 * Idempotent: only writes when the generated content actually changes, so it is
 * safe to call on every reindex sweep without churning the file (or its git
 * history / the file watcher). Returns a summary string for tool output.
 */
export function rebuildMarkdownIndex(): string {
  const files = getAllMemoryFiles();
  const today = new Date().toISOString().split("T")[0];

  interface IndexEntry {
    relPath: string;
    name: string;
    description: string;
    type: string;
    importance: number;
    updated: string;
    linkCount: number;
  }

  // Count inbound references
  const refCounts = new Map<string, number>();
  const entries: IndexEntry[] = [];

  for (const file of files) {
    const relPath = getRelativePath(file);
    // The index never lists itself.
    if (relPath === "MEMORY_INDEX.md" || relPath.endsWith("/MEMORY_INDEX.md")) continue;
    const content = fs.readFileSync(file, "utf-8");
    const { metadata } = parseFrontmatter(content);
    const related = metadata.related;
    if (Array.isArray(related)) {
      for (const ref of related) {
        const r = String(ref);
        refCounts.set(r, (refCounts.get(r) || 0) + 1);
      }
    }

    entries.push({
      relPath,
      name: String(metadata.name || path.basename(file, ".md")),
      description: String(metadata.description || ""),
      type: String(metadata.type || "unknown"),
      importance: typeof metadata.importance === "number" ? metadata.importance : 5,
      updated: String(metadata.updated || "unknown"),
      linkCount: 0, // filled below
    });
  }

  // Fill link counts
  for (const entry of entries) {
    entry.linkCount = refCounts.get(entry.relPath) || 0;
  }

  // Group by type
  const typeOrder = [
    "user",
    "project",
    "decision",
    "feedback",
    "reference",
    "reflection",
    "pattern",
    "source-rollup",
    "session",
  ];
  const groups = new Map<string, IndexEntry[]>();

  for (const entry of entries) {
    // Separate daily logs
    // getRelativePath() always emits forward slashes (see its comment), so this
    // must compare against "/" and NOT path.sep — on Windows path.sep is "\\",
    // the test never matched, and every daily log leaked into the core type
    // groups instead of the capped "## Daily Logs" section.
    if (entry.relPath.startsWith("daily/")) continue;

    const group = groups.get(entry.type) || [];
    group.push(entry);
    groups.set(entry.type, group);
  }

  // Sort within groups by importance descending
  for (const group of groups.values()) {
    group.sort((a, b) => b.importance - a.importance);
  }

  // Collect daily logs separately
  const dailyLogs = entries
    .filter((e) => e.relPath.startsWith("daily/"))
    .sort((a, b) => b.relPath.localeCompare(a.relPath));

  // Build markdown
  const lines: string[] = [
    "# Memory Index",
    "",
    `> Auto-generated by \`memory_index\`. Last rebuilt: ${today}`,
    "",
  ];

  for (const typeName of typeOrder) {
    const group = groups.get(typeName);
    if (!group || group.length === 0) continue;

    const label = typeName.charAt(0).toUpperCase() + typeName.slice(1);
    lines.push(`## ${label}`);
    lines.push("");
    lines.push("| Memory | Importance | Updated | Links |");
    lines.push("|--------|-----------|---------|-------|");

    for (const entry of group) {
      const name = escapeMarkdownText(entry.name);
      const url = escapeMarkdownUrl(entry.relPath);
      const desc = entry.description ? ` — ${escapeTableCell(entry.description.slice(0, 80))}` : "";
      lines.push(
        `| [${name}](${url})${desc} | ${entry.importance} | ${escapeTableCell(entry.updated)} | ${entry.linkCount} |`,
      );
    }
    lines.push("");
  }

  // Any types not in the standard order
  for (const [typeName, group] of groups) {
    if (typeOrder.includes(typeName)) continue;
    const label = typeName.charAt(0).toUpperCase() + typeName.slice(1);
    lines.push(`## ${label}`);
    lines.push("");
    for (const entry of group) {
      const name = escapeMarkdownText(entry.name);
      const url = escapeMarkdownUrl(entry.relPath);
      lines.push(`- [${name}](${url}) (importance: ${entry.importance})`);
    }
    lines.push("");
  }

  // Daily logs
  if (dailyLogs.length > 0) {
    lines.push("## Daily Logs");
    lines.push("");
    for (const entry of dailyLogs.slice(0, 30)) {
      const date = path.basename(entry.relPath, ".md");
      const url = escapeMarkdownUrl(entry.relPath);
      lines.push(`- [${date}](${url})`);
    }
    if (dailyLogs.length > 30) {
      lines.push(`- *...and ${dailyLogs.length - 30} more*`);
    }
    lines.push("");
  }

  // Write
  const indexPath = path.join(MEMORIES_DIR, "MEMORY_INDEX.md");
  fs.mkdirSync(MEMORIES_DIR, { recursive: true });

  // Preserve a hand-curated appendix (cross-store pointers, sync notes) that the
  // generator can't reproduce: everything from the sentinel to EOF is carried
  // over verbatim. Without this, auto-rebuild would silently drop curated notes.
  let manualAppendix = "";
  try {
    const existing = fs.readFileSync(indexPath, "utf-8");
    const idx = existing.indexOf(INDEX_MANUAL_SENTINEL);
    if (idx !== -1) manualAppendix = existing.slice(idx);
  } catch {
    // No existing index yet — nothing to preserve.
  }

  let body = lines.join("\n");
  if (manualAppendix) body += "\n" + manualAppendix;

  // Idempotent: skip the write (and the watcher/git churn it causes) when the
  // generated content is byte-identical to what's already on disk. This is what
  // makes it safe to call on every reindex sweep.
  let changed: boolean;
  try {
    changed = fs.readFileSync(indexPath, "utf-8") !== body;
  } catch {
    changed = true;
  }
  if (changed) writeFileAtomic(indexPath, body);

  const typeCount = Array.from(groups.values()).reduce((sum, g) => sum + g.length, 0);
  return `Rebuilt MEMORY_INDEX.md: ${typeCount} memories in ${groups.size} categories${changed ? "" : " (unchanged)"}`;
}

// ─── Collector subsystem (sub-memory agent) ───────────────────

/** Member events already written as part of a fused activity: key -> epoch ms. */
const FUSED_SIDECAR = ".fused-events.json";
const FUSED_WINDOW_MS = 3 * 24 * 3600 * 1000;

function fusedEventKey(e: { source: string; id: string }): string {
  return createHash("sha256").update(`${e.source}:${e.id}`).digest("hex").slice(0, 24);
}

function loadFusedEvents(): Record<string, number> {
  const now = Date.now();
  let seen: Record<string, number> = {};
  try {
    seen = JSON.parse(fs.readFileSync(path.join(DATA_DIR, FUSED_SIDECAR), "utf-8")) as Record<
      string,
      number
    >;
  } catch {
    // none yet, or unreadable: start fresh
  }
  for (const [k, t] of Object.entries(seen)) {
    if (typeof t !== "number" || now - t > FUSED_WINDOW_MS) delete seen[k];
  }
  return seen;
}

/**
 * The events not yet part of a written fused activity. Fusion runs over
 * these only: memory_fuse fuses unsynced events that the daemon later
 * ingests and fuses again (with its own window), so clusters overlapped
 * and the shared events were written into a second activity.
 */
export function unfusedEvents<T extends { source: string; id: string }>(events: T[]): T[] {
  const seen = loadFusedEvents();
  return events.filter((e) => !(fusedEventKey(e) in seen));
}

/**
 * Write fused activities to today's daily log and record their events as
 * fused (3-day window). An activity made only of already-fused events is
 * skipped. Returns the activities written.
 */
export function writeFusedActivities(activities: FusedActivity[]): FusedActivity[] {
  if (activities.length === 0) return [];
  const seen = loadFusedEvents();
  const now = Date.now();
  const fresh = activities.filter((a) => a.sourceEvents.some((e) => !(fusedEventKey(e) in seen)));
  if (fresh.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const dailyFile = dailyLogPath(MEMORIES_DIR, today);
    // createOrAppend, not a bare append: when no event has been written
    // today yet, a bare append created a daily log with no frontmatter.
    for (const activity of fresh) {
      const entry = formatFusedActivity(activity);
      createOrAppend(dailyFile, collectorDailyHeader(today) + entry, `\n${entry}`);
      for (const e of activity.sourceEvents) seen[fusedEventKey(e)] = now;
    }
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    writeFileAtomic(path.join(DATA_DIR, FUSED_SIDECAR), JSON.stringify(seen));
  } catch {
    // best effort: worst case a later run writes an activity twice
  }
  return fresh;
}

let registry: SourceRegistry | null = null;
let buffer: EventBuffer | null = null;
let daemon: CollectorDaemon | null = null;
let ingestion: IngestionPipeline | null = null;
let fusion: TemporalFusion | null = null;
let collectorInitPromise: Promise<void> | null = null;
let collectorReady = false;
let resumeRetryTimer: NodeJS.Timeout | null = null;

/** How often enabled sources that failed to start are tried again. */
const RESUME_RETRY_MS = 10 * 60 * 1000;

/** Thrown when a secondary server is asked for the collector. */
export const COLLECTOR_IN_PRIMARY =
  "The collector runs in the Memoria server that opened this store first";

/**
 * Why this server cannot reach the collector, and the ways out. The
 * dashboard variant must not send the user to "the dashboard": in a
 * secondary it IS the dashboard that cannot help.
 */
export function collectorInPrimaryMessage(
  store: MemoryStore,
  surface: "mcp" | "dashboard" = "mcp",
): string {
  const holder = store.holderPid !== undefined ? ` (pid ${store.holderPid})` : "";
  const ways =
    "Close the other Memoria sessions on this store (this server takes over within 30 s), " +
    "or start memoria-mcp-http before any Claude session so the dashboard is the first server.";
  return surface === "dashboard"
    ? `${COLLECTOR_IN_PRIMARY}${holder}, for example a Claude Code or Claude Desktop ` +
        `session. Source consent and settings are only available from that server. ${ways}`
    : `${COLLECTOR_IN_PRIMARY}${holder}; this session's server shares its memories but ` +
        `not its collector. Use that server's dashboard if it is the HTTP server. ${ways}`;
}

async function ensureCollector(store: MemoryStore): Promise<void> {
  // One collector per store: its registry state file is last-writer-wins
  // and two daemons would poll every source twice.
  if (!store.isPrimary) throw new Error(collectorInPrimaryMessage(store));
  // The fast path keys on completion, not on `registry` being set: the
  // registry is assigned before init's first await, so callers used to
  // proceed against a half-built collector (no ingestion yet, buffer not
  // initialised).
  if (collectorReady) return;
  // If init is already in flight, wait for it instead of starting a second one
  if (!collectorInitPromise) {
    collectorInitPromise = doInitCollector(store)
      .then(() => {
        collectorReady = true;
      })
      .finally(() => {
        collectorInitPromise = null;
      });
  }
  return collectorInitPromise;
}

async function doInitCollector(store: MemoryStore): Promise<void> {
  registry = new SourceRegistry(DATA_DIR);
  buffer = new EventBuffer(DATA_DIR);
  await buffer.init();

  ingestion = new IngestionPipeline({
    memoriesDir: MEMORIES_DIR,
    searchMemories: async (query, limit) => {
      const results = await store.search(query, limit);
      return results.map((r) => ({
        file: r.file,
        content: r.text,
        score: r.relevanceScore,
      }));
    },
  });

  fusion = new TemporalFusion();

  daemon = new CollectorDaemon(registry, buffer);

  // Wire ingestion: when daemon has events, run through pipeline + fusion
  daemon.onIngestion(async (events) => {
    let result: Awaited<ReturnType<IngestionPipeline["ingest"]>>;

    // Run ingestion pipeline — wrap so failures are visible, not silent
    try {
      result = await ingestion!.ingest(events);
    } catch (err) {
      process.stderr.write(`Memoria: ingestion pipeline failed: ${(err as Error).message}\n`);
      throw err; // re-throw so the daemon doesn't mark events synced
    }

    // Propagate the new facts to the entity pages they touch (rule V): queue the
    // written sources so the next compile pass refreshes just those pages.
    if (result && result.writtenSources.length > 0) {
      enqueueCompileSources(result.writtenSources);
    }

    // Run cross-source fusion (best-effort — fusion failure shouldn't block
    // ingestion) over the events this cycle actually wrote. Fusing the whole
    // batch also fused events scored below threshold, and rate-limited ones,
    // which come back next cycle and were fused (and written) again.
    const written = new Set(
      (result?.outcomes ?? [])
        .filter((o) => o.outcome === "written")
        .map((o) => `${o.source}:${o.id}`),
    );
    const fusable = unfusedEvents(events.filter((e) => written.has(`${e.source}:${e.id}`)));
    if (fusion && fusable.length >= 2) {
      try {
        writeFusedActivities(fusion.fuse(fusable));
      } catch (err) {
        process.stderr.write(
          `Memoria: fusion write failed (non-fatal): ${(err as Error).message}\n`,
        );
      }
    }

    if (result && result.written > 0) {
      process.stderr.write(
        `Memoria: ingested ${result.written} events (${result.deduplicated} deduped, ${result.rateLimited} rate-limited)\n`,
      );
    }

    // Return per-event outcomes so the daemon syncs only durably-handled
    // events (rate-limited → retried next cycle; errored → attempt-counted).
    return result;
  });

  daemon.start();

  // Resume the sources left enabled before a restart, each on its own and
  // in the background: a slow login or dependency install must not hold up
  // the collector, and the registry serializes a resume against a
  // concurrent enable of the same source. Sources that fail (offline at
  // boot, say) are retried periodically rather than staying dead until the
  // next restart.
  const reg = registry;
  const d = daemon;
  const resume = () =>
    reg
      .restoreEnabledSources(() => d.syncPollTimers())
      .catch((err) =>
        process.stderr.write(`Memoria: resuming sources failed: ${(err as Error).message}\n`),
      );
  void resume();
  resumeRetryTimer = setInterval(resume, RESUME_RETRY_MS);
  resumeRetryTimer.unref();
}

/**
 * Start the collector at server startup when it has been used before, so
 * enabled sources resume collecting without waiting for a collector tool,
 * the dashboard or /ingest to initialise it. A store that never used the
 * collector has no config file, and starting it would create a master key
 * for nothing.
 */
export async function resumeCollectorIfConfigured(store: MemoryStore): Promise<void> {
  if (!store.isPrimary) return;
  if (!fs.existsSync(path.join(DATA_DIR, "collector-config.enc"))) return;
  try {
    // A config can exist with every source off; then there is nothing to
    // resume and no reason to run the daemon.
    if (!new SourceRegistry(DATA_DIR).hasEnabledSources()) return;
    await ensureCollector(store);
  } catch (err) {
    process.stderr.write(`Memoria: collector did not start: ${(err as Error).message}\n`);
  }
}

/**
 * Register collector-specific MCP tools (sub-memory agent).
 */
export function registerCollectorTools(server: McpServer, store: MemoryStore): void {
  // Tool 10: memory_sources — list, enable, disable, add, remove data sources
  server.tool(
    "memory_sources",
    "Manage data sources for the sub-memory collector. List available sources, enable/disable them, or add custom sources. User consent for a source can only be granted in the Memoria dashboard, never through this tool.",
    {
      action: z
        .enum(["list", "enable", "disable", "add_custom", "remove_custom", "configure"])
        .describe("Action to perform"),
      source: z
        .string()
        .optional()
        .describe("Source ID (required for enable/disable/remove/configure)"),
      config: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Scheduling overrides for enable/configure: pollIntervalSec (>= 10) and importanceThreshold (1-10). Source settings such as hosts, credentials and paths can only be changed in the Memoria dashboard.",
        ),
      custom_definition: z
        .object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          mode: z.enum(["file_watcher", "shell_command", "webhook"]),
          watchPath: z.string().optional(),
          fileFormat: z.enum(["json", "csv", "lines"]).optional(),
          command: z.string().optional(),
          webhookPath: z.string().optional(),
          jsonPath: z.string().optional(),
          fieldMap: z
            .object({
              content: z.string().optional(),
              timestamp: z.string().optional(),
              id: z.string().optional(),
              meta: z.array(z.string()).optional(),
            })
            .optional(),
        })
        .optional()
        .describe("Custom source definition (for add_custom)"),
    },
    async ({ action, source, config, custom_definition }) => {
      await ensureCollector(store);

      switch (action) {
        case "list": {
          const sources = registry!.listSources();
          if (sources.length === 0) {
            return { content: [{ type: "text" as const, text: "No data sources registered." }] };
          }

          const output = sources
            .map((s) => {
              const status = s.enabled ? "enabled" : "disabled";
              const installed = s.installed ? "installed" : "not installed";
              const error = s.error ? ` | ERROR: ${s.error}` : "";
              return (
                `- **${s.name}** (\`${s.id}\`) — ${status}, ${installed}\n` +
                `  ${s.description}\n` +
                `  Platforms: ${s.platforms.join(", ")} | Events: ${s.eventCount} | Last poll: ${s.lastPoll ?? "never"}${error}`
              );
            })
            .join("\n\n");

          return { content: [{ type: "text" as const, text: `**Data Sources**\n\n${output}` }] };
        }

        case "enable": {
          if (!source)
            return { content: [{ type: "text" as const, text: "Error: source ID required" }] };
          const result = await registry!.enableSource(source, config, "agent");
          if (result.success) daemon!.syncPollTimers();
          return { content: [{ type: "text" as const, text: result.message }] };
        }

        case "disable": {
          if (!source)
            return { content: [{ type: "text" as const, text: "Error: source ID required" }] };
          const result = await registry!.disableSource(source);
          if (result.success) daemon!.syncPollTimers();
          return { content: [{ type: "text" as const, text: result.message }] };
        }

        case "add_custom": {
          if (!custom_definition) {
            return {
              content: [{ type: "text" as const, text: "Error: custom_definition required" }],
            };
          }
          const result = registry!.addCustomSource(custom_definition as CustomSourceDefinition);
          return { content: [{ type: "text" as const, text: result.message }] };
        }

        case "remove_custom": {
          if (!source)
            return { content: [{ type: "text" as const, text: "Error: source ID required" }] };
          const result = await registry!.removeCustomSource(source);
          if (result.success) daemon!.syncPollTimers();
          return { content: [{ type: "text" as const, text: result.message }] };
        }

        case "configure": {
          if (!source)
            return { content: [{ type: "text" as const, text: "Error: source ID required" }] };
          if (!config)
            return { content: [{ type: "text" as const, text: "Error: config required" }] };
          const result = registry!.updateSourceConfig(source, config, "agent");
          // A new pollIntervalSec applies to the running source right away.
          if (result.success) daemon!.syncPollTimers();
          return { content: [{ type: "text" as const, text: result.message }] };
        }

        default:
          return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }] };
      }
    },
  );

  // Tool 11: memory_ingest — manually trigger ingestion from buffer to core
  server.tool(
    "memory_ingest",
    "Manually trigger ingestion of buffered events into core memory. Useful after enabling a new source or for testing.",
    {
      batch_size: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(50)
        .describe("Max events to ingest (1-500)"),
      source_filter: z.string().optional().describe("Only ingest events from this source"),
    },
    async ({ batch_size, source_filter }) => {
      await ensureCollector(store);

      const batch = source_filter
        ? buffer!.fetchUnsyncedBySource(source_filter, batch_size)
        : buffer!.fetchUnsynced(batch_size);

      if (batch.length === 0) {
        return { content: [{ type: "text" as const, text: "No unsynced events in buffer." }] };
      }

      const events = batch.map((b) => b.event);
      const result = await ingestion!.ingest(events);

      // Sync ONLY durably-handled events (written/duplicate/below_threshold).
      // Rate-limited events stay unsynced for the next cycle; errored events
      // get an attempt recorded and dead-letter after the retry cap.
      const rowidByKey = new Map<string, number>();
      for (const b of batch) rowidByKey.set(`${b.event.source} ${b.event.id}`, b.rowid);
      const handled: number[] = [];
      const errored: number[] = [];
      let deferred = 0;
      for (const o of result.outcomes) {
        const rowid = rowidByKey.get(`${o.source} ${o.id}`);
        if (rowid === undefined) continue;
        if (o.outcome === "rate_limited") deferred++;
        else if (o.outcome === "error") errored.push(rowid);
        else handled.push(rowid);
      }
      buffer!.markSynced(handled);
      const dl =
        errored.length > 0
          ? buffer!.recordFailedAttempts(errored)
          : { retried: 0, deadLettered: 0 };

      // Queue touched sources so the next compile pass refreshes their pages.
      if (result.writtenSources.length > 0) enqueueCompileSources(result.writtenSources);

      const output = [
        `**Ingestion Result**`,
        `- Processed: ${result.processed}`,
        `- Written to memory: ${result.written}`,
        `- Deduplicated: ${result.deduplicated}`,
        `- Rate-limited (deferred, will retry): ${result.rateLimited}`,
        ...(deferred + errored.length > 0
          ? [
              `- Left unsynced for retry: ${deferred + dl.retried}${dl.deadLettered > 0 ? ` | dead-lettered: ${dl.deadLettered}` : ""}`,
            ]
          : []),
        ...(result.errors.length > 0 ? [`- Errors: ${result.errors.join("; ")}`] : []),
      ].join("\n");

      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  // Tool 12: memory_fuse — run cross-source temporal fusion
  server.tool(
    "memory_fuse",
    "Detect patterns across data sources by correlating events within time windows. Creates higher-level activity records.",
    {
      hours: z
        .number()
        .int()
        .min(1)
        .max(720)
        .optional()
        .default(24)
        .describe("Look back this many hours (1-720)"),
      window_minutes: z
        .number()
        .int()
        .min(1)
        .max(1440)
        .optional()
        .default(30)
        .describe("Fusion time window in minutes (1-1440)"),
    },
    async ({ hours, window_minutes }) => {
      await ensureCollector(store);

      // Fetch recent unsynced events from buffer
      const allEvents = buffer!.fetchUnsynced(500);
      if (allEvents.length < 2) {
        return {
          content: [
            { type: "text" as const, text: "Not enough events for fusion (need at least 2)." },
          ],
        };
      }

      const cutoff = Date.now() - hours * 3600_000;
      const recentEvents = allEvents
        .filter((b) => new Date(b.event.timestamp).getTime() >= cutoff)
        .map((b) => b.event);

      const fusionEngine = new TemporalFusion({
        windowMs: window_minutes * 60_000,
      });

      const activities = writeFusedActivities(fusionEngine.fuse(unfusedEvents(recentEvents)));

      if (activities.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No cross-source patterns found in ${recentEvents.length} events (${hours}h window, ${window_minutes}min fusion).`,
            },
          ],
        };
      }

      const summary = activities
        .map(
          (a) =>
            `- **${a.label}** (${a.sourceCount} sources, importance: ${a.importance})\n` +
            `  ${a.startTime.slice(11, 16)} – ${a.endTime.slice(11, 16)} | Tags: ${a.tags.join(", ")}`,
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `**Fused ${activities.length} activit${activities.length === 1 ? "y" : "ies"}**\n\n${summary}`,
          },
        ],
      };
    },
  );

  // Tool 13: memory_priority — view/adjust collector priority settings
  server.tool(
    "memory_priority",
    "View or adjust the priority and filtering settings for the collector daemon. Shows buffer status and active poll timers.",
    {
      action: z.enum(["status", "set_threshold", "flush_buffer"]).describe("Action to perform"),
      source: z.string().optional().describe("Source ID (for set_threshold)"),
      threshold: z
        .number()
        .optional()
        .describe("New importance threshold 1-10 (for set_threshold)"),
    },
    async ({ action, source, threshold }) => {
      await ensureCollector(store);

      switch (action) {
        case "status": {
          const daemonStatus = daemon!.getStatus();
          const bufferStats = buffer!.getStats();

          const lines = [
            `**Collector Status**`,
            `- Running: ${daemonStatus.running}`,
            `- Active sources: ${daemonStatus.activeSources}`,
            ``,
            `**Buffer**`,
            `- Total events: ${bufferStats.totalEvents}`,
            `- Unsynced: ${bufferStats.unsyncedEvents}`,
            `- Synced: ${bufferStats.syncedEvents}`,
            `- Size: ${(bufferStats.bufferSizeBytes / 1024).toFixed(1)} KB`,
            `- Oldest unsynced: ${bufferStats.oldestUnsynced ?? "none"}`,
            ...(bufferStats.droppedUnsynced > 0
              ? [
                  `- ⚠ Unsynced events DROPPED at capacity (data loss): ${bufferStats.droppedUnsynced}`,
                ]
              : []),
            ...(bufferStats.droppedHeld > 0
              ? [`- ⚠ Held (undecryptable) events DROPPED at capacity: ${bufferStats.droppedHeld}`]
              : []),
            ...(bufferStats.deadLettered > 0
              ? [
                  `- ⚠ Dead-lettered after retry cap (see data/.dead-letter.jsonl): ${bufferStats.deadLettered}`,
                ]
              : []),
            ``,
            `**Poll Timers**`,
          ];

          for (const pt of daemonStatus.pollTimers) {
            const status = pt.inBackoff ? `in backoff (${pt.errors} errors)` : "active";
            lines.push(`- ${pt.sourceId}: every ${pt.intervalMs / 1000}s — ${status}`);
          }

          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        }

        case "set_threshold": {
          if (!source)
            return { content: [{ type: "text" as const, text: "Error: source ID required" }] };
          if (threshold === undefined || threshold < 1 || threshold > 10) {
            return { content: [{ type: "text" as const, text: "Error: threshold must be 1-10" }] };
          }
          const result = registry!.updateSourceConfig(
            source,
            { importanceThreshold: threshold },
            "agent",
          );
          return { content: [{ type: "text" as const, text: result.message }] };
        }

        case "flush_buffer": {
          const cleaned = buffer!.cleanup();
          return {
            content: [
              {
                type: "text" as const,
                text: `Flushed ${cleaned} synced events from buffer.`,
              },
            ],
          };
        }

        default:
          return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }] };
      }
    },
  );
}

/**
 * Get the collector's buffer and ingestion pipeline for the /ingest HTTP endpoint.
 * Lazily initializes the collector if needed.
 */
export async function getCollectorPipeline(store: MemoryStore): Promise<{
  buffer: EventBuffer;
  ingestion: IngestionPipeline;
}> {
  await ensureCollector(store);
  return { buffer: buffer!, ingestion: ingestion! };
}

/**
 * Get the shared collector singletons (registry + buffer + daemon) for callers
 * such as the dashboard that manage sources. Routes through the same
 * init-locked `ensureCollector`, so there is exactly ONE registry/daemon over
 * the on-disk collector state. (Previously the dashboard built a second set,
 * which double-polled every source and let the two RegistryState snapshots
 * clobber each other's agreement/checkpoints on save.)
 */
export async function getCollector(store: MemoryStore): Promise<{
  registry: SourceRegistry;
  buffer: EventBuffer;
  daemon: CollectorDaemon;
}> {
  await ensureCollector(store);
  return { registry: registry!, buffer: buffer!, daemon: daemon! };
}

/**
 * Clean up collector subsystem on shutdown.
 */
/**
 * For a server whose store was taken over (see MemoryStore.fenced): stop
 * the collector's timers and nothing else. destroyCollector's flush and
 * buffer close write the shared data directory, which the new holder is
 * using; the process ends without them (exitWithoutCheckpoint).
 */
export function haltCollector(): void {
  if (resumeRetryTimer) clearInterval(resumeRetryTimer);
  resumeRetryTimer = null;
  collectorReady = false;
  daemon?.halt();
}

export async function destroyCollector(): Promise<void> {
  // Flush any buffered provenance records before teardown (batched writes).
  try {
    (await import("./collector/provenance.js")).flushRawArchive();
  } catch {
    // best-effort
  }
  if (resumeRetryTimer) clearInterval(resumeRetryTimer);
  resumeRetryTimer = null;
  collectorReady = false;
  if (daemon) await daemon.stop();
  if (buffer) await buffer.destroy();
  if (registry) await registry.destroy();
  daemon = null;
  buffer = null;
  registry = null;
  ingestion = null;
  fusion = null;
}
