/**
 * Single-process guard for a memory store directory (review H3).
 * Two server processes on one store race: SQLite writers hit SQLITE_BUSY
 * with no retry, and the collector registry's whole-state replace is
 * last-writer-wins. Taking an exclusive lock file at store open makes the
 * second process fail loudly at startup instead.
 *
 * The lock records, one per line: the pid, the hostname, the start time
 * in epoch ms (read by 0.3.0; no longer compared), `pidspace:<id>` and
 * `start:<raw>`. Its holder refreshes the file's mtime every HEARTBEAT_MS.
 *
 * The pid space says whose pids these are: on Linux the boot id plus the
 * pid namespace, on macOS the boot session. A lock from this pid space is
 * judged by its pid whatever the hostname (a laptop's hostname changes
 * with the network); `start:` is the kernel's own record of when that
 * process started (/proc ticks since boot, ps lstart), compared exactly,
 * so a clock step cannot make a live holder look like a reused pid. 0.3.0
 * derived the start time from the wall clock, which moves when the clock
 * is stepped.
 *
 * A lock is stale, and reclaimed, when:
 *
 * - it is from this pid space and its pid is gone (ESRCH);
 * - it names our own pid but this process does not hold it: a container
 *   restarted after a crash usually hands node the same small pid, and the
 *   leftover lock used to block every restart;
 * - its pid is alive but started at a different time (a reused pid);
 * - it was written on this host before a reboot;
 * - it is from another pid space (another host, a shared mount), whose
 *   pid means nothing here, and its heartbeat stopped more than STALE_MS
 *   ago.
 *
 * A live local holder is never judged by its heartbeat: a process paused
 * by SIGSTOP or a laptop's sleep misses beats while still running, and
 * taking its lock would put two writers on one store. Where the start
 * time cannot be read (Windows; a lock written by 0.3.0), a live pid
 * counts as the holder: refusing wrongly is safe, since a shared open then
 * runs as a secondary.
 *
 * A fresh lock from another host is waited on for up to one stale window
 * (its holder may just have crashed), then refused. A deployment that
 * deliberately overlaps instances on one shared store, as a Cloud Run
 * rollout does, sets MEMORIA_LOCK_TAKEOVER=true: the new instance must
 * start while the old one still runs, so it takes the lock over, then
 * waits one heartbeat so the old holder notices and fences itself (see
 * `onLost`) before the new one opens the database.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HEARTBEAT_MS = 15_000;
const STALE_MS = 60_000;
/** A lock caught between create and its content being written. */
const UNWRITTEN_GRACE_MS = 5_000;
const MAX_RECLAIMS = 5;

/** Locks held by this process, by real path, with their heartbeat timers. */
const heldLocks = new Map<string, NodeJS.Timeout>();

function parseLock(text: string): {
  pid: number;
  host: string | null;
  pidSpace: string | null;
  startRaw: string | null;
} {
  const lines = text.split("\n");
  const tagged = (tag: string) => {
    const line = lines.find((l) => l.startsWith(`${tag}:`));
    return line ? line.slice(tag.length + 1).trim() || null : null;
  };
  return {
    pid: parseInt((lines[0] ?? "").trim(), 10),
    host: lines[1]?.trim() || null,
    pidSpace: tagged("pidspace"),
    startRaw: tagged("start"),
  };
}

/**
 * When a process started, in epoch ms, from /proc (Linux only). Field 22 of
 * /proc/<pid>/stat is the start time in clock ticks since boot (USER_HZ,
 * 100 on every mainstream Linux); /proc/stat's btime is the boot time.
 * Written to the lock for 0.3.0 readers only: btime moves when the clock
 * is stepped, so it is not compared.
 */
function linuxProcessStartMs(pid: number): number | undefined {
  const ticks = linuxStartTicks(pid);
  if (ticks === undefined) return undefined;
  try {
    const btime = Number(/^btime (\d+)$/m.exec(fs.readFileSync("/proc/stat", "utf-8"))?.[1]);
    return Number.isFinite(btime) ? btime * 1000 + Number(ticks) * 10 : undefined;
  } catch {
    return undefined;
  }
}

/** Field 22 of /proc/<pid>/stat: start time in ticks since boot. */
function linuxStartTicks(pid: number): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
    // The command name may contain spaces or parentheses; fields resume
    // after its last ")". The first field there is field 3 (state).
    const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[22 - 3];
    return ticks && /^\d+$/.test(ticks) ? ticks : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The kernel's record of when `pid` started, as an opaque string compared
 * exactly; undefined when it cannot be read (the caller then treats a live
 * pid as the holder). macOS: ps's lstart, the process's recorded start
 * time, printed in UTC so a time zone change does not alter it.
 */
function processStartRaw(pid: number): string | undefined {
  if (process.platform === "linux") return linuxStartTicks(pid);
  if (process.platform === "darwin") {
    try {
      const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
        encoding: "utf-8",
        env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      }).trim();
      return out || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

let cachedPidSpace: string | null | undefined;

/**
 * Which pid space this process's pids belong to, or null when unknown.
 * Linux: "<boot id>/<pid namespace>", so two containers on one host are
 * told apart. macOS: the boot session UUID. Elsewhere unknown, and locks
 * are judged by hostname as before.
 */
function ownPidSpace(): string | null {
  if (cachedPidSpace !== undefined) return cachedPidSpace;
  cachedPidSpace = null;
  try {
    if (process.platform === "linux") {
      const boot = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf-8").trim();
      const ns = fs.readlinkSync("/proc/self/ns/pid");
      if (boot && ns) cachedPidSpace = `${boot}/${ns}`;
    } else if (process.platform === "darwin") {
      const uuid = execFileSync("sysctl", ["-n", "kern.bootsessionuuid"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      }).trim();
      if (uuid) cachedPidSpace = uuid;
    }
  } catch {
    // unknown: hostname rules apply
  }
  return cachedPidSpace;
}

/** The boot part of a pid space: what a reboot changes. */
function bootOf(pidSpace: string): string {
  return pidSpace.split("/")[0];
}

function ownStartMs(): number {
  return linuxProcessStartMs(process.pid) ?? Math.round(Date.now() - process.uptime() * 1000);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

type Verdict =
  | { kind: "gone" }
  | { kind: "stale"; observed: string; why: string }
  | { kind: "foreign"; observed: string; host: string; pid: number }
  | { kind: "pending" }
  | { kind: "held"; pid: number };

function inspect(lockPath: string): Verdict {
  let observed: string;
  let ageMs: number;
  try {
    observed = fs.readFileSync(lockPath, "utf-8");
    ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { kind: "gone" };
    return { kind: "held", pid: NaN }; // unreadable: treat as held rather than race
  }
  const { pid, host, pidSpace, startRaw } = parseLock(observed);
  if (!Number.isFinite(pid)) {
    return ageMs > UNWRITTEN_GRACE_MS
      ? { kind: "stale", observed, why: "it is empty" }
      : { kind: "pending" };
  }
  const mySpace = ownPidSpace();
  const sameHost = host === os.hostname();
  // Whether the pid in the lock means anything here. A lock that names its
  // pid space is local exactly when that is ours, whatever the hostname.
  // Without one (0.3.0, or a platform where it is unknown) the hostname
  // decides; a lock without a host predates heartbeats and is local too.
  let local: boolean;
  if (pidSpace !== null && mySpace !== null) {
    local = pidSpace === mySpace;
    if (!local && sameHost && bootOf(pidSpace) !== bootOf(mySpace)) {
      return { kind: "stale", observed, why: "it was written before this machine restarted" };
    }
  } else {
    local = host === null || sameHost;
  }
  if (!local) {
    return ageMs > STALE_MS
      ? { kind: "stale", observed, why: `its holder on "${host}" stopped refreshing it` }
      : { kind: "foreign", observed, host: host ?? "another host", pid };
  }
  if (pid === process.pid) {
    // Held by this process (a second open), or a leftover from an earlier
    // process that had the same pid.
    return heldLocks.has(lockPath)
      ? { kind: "held", pid }
      : { kind: "stale", observed, why: "it is a leftover with this process's pid" };
  }
  try {
    process.kill(pid, 0);
  } catch (killErr) {
    // Only ESRCH proves the holder is gone. EPERM means a live process
    // owned by another user.
    if ((killErr as NodeJS.ErrnoException).code === "ESRCH") {
      return { kind: "stale", observed, why: `pid ${pid} is gone` };
    }
  }
  // Alive. Ours only if it is the same process that wrote the lock: a
  // different start time means the pid was reused.
  if (startRaw !== null) {
    const live = processStartRaw(pid);
    if (live !== undefined && live !== startRaw) {
      return { kind: "stale", observed, why: `pid ${pid} now belongs to another process` };
    }
  }
  return { kind: "held", pid };
}

/**
 * Move a stale lock out of the way, but only the lock that was judged: if
 * another process reclaimed it and created its own in between, the file
 * now at the path is that fresh lock, and it is put back. Returns whether
 * the path is free to create.
 */
function reclaim(lockPath: string, observed: string): boolean {
  const aside = `${lockPath}.stale-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(lockPath, aside);
  } catch {
    return false; // someone else moved it first
  }
  let moved: string;
  try {
    moved = fs.readFileSync(aside, "utf-8");
  } catch {
    // unreadable: assume it was the one we judged
    moved = observed;
  }
  if (moved !== observed) {
    try {
      fs.linkSync(aside, lockPath); // fails if yet another lock exists
    } catch {
      // the path is taken again either way; the caller re-inspects
    }
    fs.rmSync(aside, { force: true });
    return false;
  }
  fs.rmSync(aside, { force: true });
  return true;
}

/** The store is held by another live Memoria process. */
export class StoreInUseError extends Error {
  constructor(
    readonly dir: string,
    readonly holderPid: number,
    cause?: unknown,
    /** The holder is on another host (a shared network mount). */
    readonly foreign = false,
  ) {
    super(
      `Memoria store at ${dir} is already in use by another Memoria process` +
        (Number.isFinite(holderPid) ? ` (pid ${holderPid})` : "") +
        `. Stop that process first; running two servers on one store corrupts the index.`,
      { cause },
    );
    this.name = "StoreInUseError";
  }
}

function inUse(dir: string, pid: number, cause?: unknown, foreign = false): Error {
  return new StoreInUseError(dir, pid, cause, foreign);
}

export interface StoreLockOptions {
  /** How long to wait on a fresh lock from another host before refusing. */
  foreignWaitMs?: number;
  /**
   * Called once if another process takes this lock over (MEMORIA_LOCK_TAKEOVER
   * on the new instance). The holder must stop writing the store: two hosts
   * writing one SQLite WAL corrupt it.
   */
  onLost?: () => void;
  /** Tests: the heartbeat period. */
  heartbeatMs?: number;
  /** Tests: the wait after a takeover (default one heartbeat plus 2 s). */
  takeoverGraceMs?: number;
}

export function acquireStoreLock(dbPath: string, opts: StoreLockOptions = {}): () => void {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  // Per database file: the two server entry points share one DB_PATH, while
  // tests/tools may legitimately open a different sqlite file beside it.
  // Real path, so two spellings of one directory are one lock.
  const lockPath = path.join(fs.realpathSync(dir), `.${path.basename(dbPath)}.lock`);
  const takeover = process.env.MEMORIA_LOCK_TAKEOVER === "true";
  const foreignWaitMs = opts.foreignWaitMs ?? STALE_MS + HEARTBEAT_MS;
  const foreignDeadline = Date.now() + foreignWaitMs;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  let reclaims = 0;
  let tookOver = false;

  for (;;) {
    let fd: number;
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const v = inspect(lockPath);
      switch (v.kind) {
        case "gone":
          continue;
        case "held":
          throw inUse(dir, v.pid, err);
        case "pending":
          sleepSync(250);
          continue;
        case "foreign":
          if (takeover) {
            process.stderr.write(
              `Memoria: taking over the store lock at ${lockPath} from host "${v.host}" ` +
                `(pid ${v.pid}) because MEMORIA_LOCK_TAKEOVER=true.\n`,
            );
            if (reclaim(lockPath, v.observed)) {
              tookOver = true;
              continue;
            }
            if (++reclaims < MAX_RECLAIMS) continue;
            throw inUse(dir, v.pid, err, true);
          }
          if (Date.now() < foreignDeadline) {
            if (reclaims === 0) {
              process.stderr.write(
                `Memoria: the store at ${dir} is locked by host "${v.host}" (pid ${v.pid}); ` +
                  `waiting up to ${Math.round(foreignWaitMs / 1000)}s in case it has stopped.\n`,
              );
              reclaims = -1; // only announce once
            }
            sleepSync(1_000);
            continue;
          }
          throw inUse(dir, v.pid, err, true);
        case "stale":
          process.stderr.write(`Memoria: reclaiming the store lock at ${lockPath}: ${v.why}.\n`);
          if (reclaim(lockPath, v.observed) || ++reclaims < MAX_RECLAIMS) continue;
          throw inUse(dir, NaN, err);
      }
    }

    const written = [
      process.pid,
      os.hostname(),
      ownStartMs(),
      `pidspace:${ownPidSpace() ?? ""}`,
      `start:${processStartRaw(process.pid) ?? ""}`,
    ].join("\n");
    fs.writeFileSync(fd, written, "utf-8");
    fs.closeSync(fd);
    // Everything below acts only while the file still holds what we wrote:
    // after a takeover, the old holder must neither refresh nor delete its
    // successor's lock.
    const stillOurs = () => {
      try {
        return fs.readFileSync(lockPath, "utf-8") === written;
      } catch {
        return false;
      }
    };
    let lost = false;
    const heartbeat = setInterval(() => {
      if (lost) return;
      if (!stillOurs()) {
        lost = true;
        clearInterval(heartbeat);
        heldLocks.delete(lockPath);
        process.stderr.write(
          `Memoria: the store lock at ${lockPath} was taken over by another process; ` +
            `this server stops writing the store.\n`,
        );
        try {
          opts.onLost?.();
        } catch (e) {
          process.stderr.write(`Memoria: stepping down failed: ${(e as Error).message}\n`);
        }
        return;
      }
      try {
        const now = new Date();
        fs.utimesSync(lockPath, now, now);
      } catch {
        // best effort; a missed beat only risks a takeover after STALE_MS
      }
    }, heartbeatMs);
    heartbeat.unref();
    heldLocks.set(lockPath, heartbeat);

    // Taken over from a live holder: give it one heartbeat to notice and
    // stop writing before this process opens the database.
    if (tookOver) sleepSync(opts.takeoverGraceMs ?? heartbeatMs + 2_000);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      heldLocks.delete(lockPath);
      try {
        if (stillOurs()) fs.rmSync(lockPath, { force: true });
      } catch {
        // best-effort release
      }
    };
  }
}
