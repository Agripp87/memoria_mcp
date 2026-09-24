/**
 * Crash- and concurrency-safe file writes.
 *
 * A plain fs.writeFileSync truncates the target and then writes it. A crash,
 * a full disk or a concurrent reader in between sees an empty or half-written
 * file — for a memory file that is lost content, for the collector's encrypted
 * config it is every stored credential, and for a daily log it drops whatever
 * another writer appended during the gap.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// Windows refuses to rename over a file another process holds open without
// FILE_SHARE_DELETE — antivirus, the search indexer, some editors — and says
// EPERM, EACCES or EBUSY. It clears within milliseconds, so retry briefly.
const RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_ATTEMPTS = 10;

/** Block the thread for `ms` milliseconds (for short synchronous retries). */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (process.platform !== "win32" || !RENAME_RETRY_CODES.has(code)) throw err;
      if (attempt >= RENAME_ATTEMPTS) throw err;
      // A directory in the way is permanent; no amount of waiting fixes it.
      if (fs.statSync(to, { throwIfNoEntry: false })?.isDirectory()) throw err;
      sleepSync(attempt * 20);
    }
  }
}

export interface AtomicWriteOptions {
  /**
   * File mode for the new file. Defaults to the existing file's mode, so a
   * replace never loosens permissions someone set; 0o666 minus the umask for a
   * new file, like fs.writeFileSync.
   */
  mode?: number;
  /**
   * Checked immediately before the new content replaces the old. Returning
   * false abandons the write (the target is untouched) and writeFileAtomic
   * returns false. Read-modify-write callers use it to detect that the file
   * changed since they read it.
   */
  precondition?: () => boolean;
}

/**
 * Replace `file` with `data` atomically: write a temp file beside it, fsync,
 * then rename over the target. Readers — and a crash at any point — see the
 * old content or the new, never a mix. Returns false only when
 * `precondition` vetoed the write.
 *
 * The temp file is a dotfile ending in `.tmp`, so nothing that looks for
 * `*.md` (indexing, the watcher) ever picks one up, even one left behind by a
 * crash.
 */
export function writeFileAtomic(
  file: string,
  data: string | Buffer,
  opts: AtomicWriteOptions = {},
): boolean {
  let mode = opts.mode;
  if (mode === undefined) {
    try {
      mode = fs.statSync(file).mode & 0o777;
    } catch {
      mode = 0o666;
    }
  }
  const dir = path.dirname(file);
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const fd = fs.openSync(tmp, "wx", mode);
  let renamed = false;
  try {
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (opts.precondition && !opts.precondition()) return false;
    renameWithRetry(tmp, file);
    renamed = true;
  } finally {
    if (!renamed) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // already gone
      }
    }
  }
  // Persist the rename itself. POSIX only: Windows cannot open a directory
  // for fsync, and NTFS journals the rename.
  if (process.platform !== "win32") {
    try {
      const dfd = fs.openSync(dir, "r");
      try {
        fs.fsyncSync(dfd);
      } finally {
        fs.closeSync(dfd);
      }
    } catch {
      // Some filesystems (FUSE mounts among them) reject a directory fsync.
    }
  }
  return true;
}

/**
 * Append to an append-only log, creating it with `initial` if it does not
 * exist. Use this instead of `existsSync ? append : writeFileSync`: when two
 * writers both saw "missing", the second writeFileSync truncated whatever the
 * first had just written.
 *
 * Creation uses O_CREAT|O_EXCL|O_APPEND ("ax"): exactly one writer creates the
 * file, and because its write is an append too, even a writer that appends in
 * the instant between the create and the write is kept, not overwritten.
 */
export function createOrAppend(
  file: string,
  initial: string,
  appended: string,
): "created" | "appended" {
  try {
    fs.writeFileSync(file, initial, { encoding: "utf-8", flag: "ax" });
    return "created";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  fs.appendFileSync(file, appended, "utf-8");
  return "appended";
}
