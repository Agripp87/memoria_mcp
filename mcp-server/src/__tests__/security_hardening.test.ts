/**
 * Regression tests for the 2026-10 whole-repo review fixes (H1-H4, M1-M6,
 * L1-L5). Each test names the finding it pins.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { execFileSync } from "node:child_process";
import { z } from "zod";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-hardening-"));
process.env.MEMORIA_DIR = ROOT;

type Handler = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }> }>;
const handlers = new Map<string, Handler>();
const schemas = new Map<string, Record<string, z.ZodTypeAny>>();
let store: any;

function capture(name: string, _d: string, schema: unknown, handler: Handler) {
  handlers.set(name, handler);
  schemas.set(name, schema as Record<string, z.ZodTypeAny>);
}
function parseOk(tool: string, args: Record<string, unknown>): boolean {
  return z.object(schemas.get(tool)!).safeParse(args).success;
}
function text(r: { content: Array<{ type: string; text: string }> }): string {
  return r.content.map((c) => c.text).join("\n");
}

beforeAll(async () => {
  fs.mkdirSync(path.join(ROOT, "memories", "daily"), { recursive: true });
  const tools = await import("../tools.js");
  const { MemoryStore } = await import("../store.js");
  store = new MemoryStore(path.join(ROOT, "data", "hardening.sqlite"));
  const fakeServer = { tool: capture };
  tools.registerTools(fakeServer as any, store);
  tools.registerCollectorTools(fakeServer as any, store);
});

afterAll(() => {
  try {
    store?.close();
  } catch {}
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {}
});

describe("H1: consent is not grantable through MCP", () => {
  it("memory_sources no longer accepts the agree action", () => {
    expect(parseOk("memory_sources", { action: "agree", source: "email" })).toBe(false);
    expect(parseOk("memory_sources", { action: "list" })).toBe(true);
  });
});

describe("H2/L1: tool inputs are bounded at the schema", () => {
  it("rejects unbounded reflect/compact/ingest/search/compile inputs", () => {
    expect(parseOk("memory_reflect", { days: 100000 })).toBe(false);
    expect(parseOk("memory_reflect", { days: 7 })).toBe(true);
    expect(parseOk("memory_compact", { days: 100000 })).toBe(false);
    expect(parseOk("memory_compact", { max_chars: 100000000 })).toBe(false);
    expect(parseOk("memory_ingest", { batch_size: 100000000 })).toBe(false);
    expect(parseOk("memory_ingest", { batch_size: 50 })).toBe(true);
    expect(parseOk("memory_search", { query: "x".repeat(3000) })).toBe(false);
    expect(parseOk("memory_fuse", { hours: 10000 })).toBe(false);
    expect(parseOk("memory_fuse", { window_minutes: 100000 })).toBe(false);
    expect(parseOk("memory_fuse", { hours: 24, window_minutes: 30 })).toBe(true);
    expect(
      parseOk("memory_compile", {
        content: "c",
        name: "n",
        type: "project",
        tags: Array.from({ length: 51 }, (_, i) => `t${i}`),
      }),
    ).toBe(false);
  });

  it("memory_compile's 100KB cap measures bytes, not characters (L1)", async () => {
    const r = await handlers.get("memory_compile")!({
      content: "é".repeat(60000), // 60000 chars, 120000 bytes
      name: "Bytes",
      type: "project",
      tags: [],
    });
    expect(text(r)).toContain("exceeds 100KB");
  });
});

describe("H4: a remote embedding provider requires explicit opt-in", () => {
  it("OPENAI_API_KEY alone never selects OpenAI", async () => {
    const { selectProvider } = await import("../embeddings.js");
    expect(selectProvider("auto", true, true)).toBe("minilm");
    expect(selectProvider("auto", true, false)).toBe("local");
    expect(selectProvider(undefined, true, false)).toBe("local");
    expect(selectProvider("openai", true, false)).toBe("openai");
    expect(selectProvider("hash", true, true)).toBe("local");
  });
});

describe("H3: one process per store directory", () => {
  it("a second MemoryStore on the same file fails, and succeeds after close", async () => {
    const { MemoryStore } = await import("../store.js");
    const db = path.join(ROOT, "data", "lock-test.sqlite");
    const first = new MemoryStore(db);
    try {
      expect(() => new MemoryStore(db)).toThrow(/already in use/);
    } finally {
      first.close();
    }
    const second = new MemoryStore(db);
    second.close();
  });

  it("reclaims a lock left by a dead pid, but not a live one", async () => {
    const { MemoryStore } = await import("../store.js");
    const db = path.join(ROOT, "data", "stale-test.sqlite");
    const lock = path.join(ROOT, "data", ".stale-test.sqlite.lock");
    fs.writeFileSync(lock, "999999"); // no such process -> ESRCH -> stale
    const s = new MemoryStore(db);
    s.close();
    // A lock naming another live local process must block, never be reclaimed.
    fs.writeFileSync(lock, `${process.ppid}\n${os.hostname()}`);
    expect(() => new MemoryStore(db)).toThrow(/already in use/);
    fs.rmSync(lock, { force: true });
  });

  it("reclaims a leftover lock that names this pid but is not held (container restart)", async () => {
    // A restarted container usually gives node the same pid as the crashed
    // process. Its lock then named a live process (us), and the server
    // refused to start forever.
    const { MemoryStore } = await import("../store.js");
    const db = path.join(ROOT, "data", "pid-reuse.sqlite");
    const lock = path.join(ROOT, "data", ".pid-reuse.sqlite.lock");
    for (const contents of [String(process.pid), `${process.pid}\n${os.hostname()}`]) {
      fs.writeFileSync(lock, contents);
      const s = new MemoryStore(db);
      // ...while a lock this process actually holds still blocks a second open.
      expect(() => new MemoryStore(db)).toThrow(/already in use/);
      s.close();
      expect(fs.existsSync(lock)).toBe(false);
    }
  });

  it("respects a fresh lock from another host, reclaims a stale one", async () => {
    const { acquireStoreLock } = await import("../store-lock.js");
    const db = path.join(ROOT, "data", "foreign.sqlite");
    const lock = path.join(ROOT, "data", ".foreign.sqlite.lock");
    // process.ppid is alive here, but on the other host it means nothing:
    // only the heartbeat (mtime) can say whether that holder is running.
    fs.writeFileSync(lock, `${process.ppid}\nsome-other-host`);
    expect(() => acquireStoreLock(db, { foreignWaitMs: 0 })).toThrow(/already in use/);
    const old = new Date(Date.now() - 5 * 60_000);
    fs.utimesSync(lock, old, old);
    const release = acquireStoreLock(db, { foreignWaitMs: 0 });
    expect(fs.readFileSync(lock, "utf-8")).toMatch(
      new RegExp(`^${process.pid}\\n${os.hostname()}\\n\\d+\\npidspace:.*\\nstart:.*$`),
    );
    release();
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("MEMORIA_LOCK_TAKEOVER takes a fresh foreign lock (Cloud Run rollouts)", async () => {
    const { acquireStoreLock } = await import("../store-lock.js");
    const db = path.join(ROOT, "data", "takeover.sqlite");
    const lock = path.join(ROOT, "data", ".takeover.sqlite.lock");
    fs.writeFileSync(lock, `${process.ppid}\nold-revision`);
    process.env.MEMORIA_LOCK_TAKEOVER = "true";
    try {
      const release = acquireStoreLock(db, { foreignWaitMs: 0, takeoverGraceMs: 0 });
      release();
    } finally {
      delete process.env.MEMORIA_LOCK_TAKEOVER;
    }
  });

  it("release never deletes a successor's lock, even one with the same pid", async () => {
    // A rollout or recreated container: both node processes are often pid 7.
    const { acquireStoreLock } = await import("../store-lock.js");
    const db = path.join(ROOT, "data", "successor.sqlite");
    const lock = path.join(ROOT, "data", ".successor.sqlite.lock");
    const release = acquireStoreLock(db);
    fs.writeFileSync(lock, `${process.pid}\ncontainer-b`); // taken over
    release();
    expect(fs.readFileSync(lock, "utf-8")).toBe(`${process.pid}\ncontainer-b`);
    fs.rmSync(lock);
  });

  it("a live local holder is judged by its start time, never by a missed heartbeat", async () => {
    // A holder paused by SIGSTOP or a laptop's sleep misses beats while
    // still running; taking its lock would put two writers on one store.
    const { acquireStoreLock } = await import("../store-lock.js");
    const db = path.join(ROOT, "data", "reused.sqlite");
    const lock = path.join(ROOT, "data", ".reused.sqlite.lock");
    const old = new Date(Date.now() - 5 * 60_000);
    const write = (contents: string) => {
      fs.writeFileSync(lock, contents);
      fs.utimesSync(lock, old, old);
    };
    // No start time recorded (0.3.0, or a platform without one): a live pid
    // is the holder, even with a recorded start time that looks wrong.
    write(`${process.ppid}\n${os.hostname()}`);
    expect(() => acquireStoreLock(db)).toThrow(/already in use/);
    write(`${process.ppid}\n${os.hostname()}\n1000`);
    expect(() => acquireStoreLock(db)).toThrow(/already in use/);
    fs.rmSync(lock);

    const mine = ownLockLines(acquireStoreLock, db, lock);
    if (!mine.pidspace || !mine.start) return; // no start record on this platform
    const parentStart = parentStartRaw();
    // The wall-clock line is off by an hour (a clock step): still the holder.
    write(
      `${process.ppid}\n${os.hostname()}\n${Date.now() - 3_600_000}\npidspace:${mine.pidspace}\nstart:${parentStart}`,
    );
    expect(() => acquireStoreLock(db)).toThrow(/already in use/);
    // A different kernel start record: the pid was reused.
    write(`${process.ppid}\n${os.hostname()}\n0\npidspace:${mine.pidspace}\nstart:${parentStart}9`);
    acquireStoreLock(db)();
    // Written on this host before a reboot.
    write(
      `${process.ppid}\n${os.hostname()}\n0\npidspace:other-boot/${mine.pidspace.split("/")[1]}\nstart:${parentStart}`,
    );
    acquireStoreLock(db)();
  });

  it("a hostname change does not make a live local holder foreign (2026-10 re-review F10)", async () => {
    const { acquireStoreLock, StoreInUseError } = await import("../store-lock.js");
    const { MemoryStore } = await import("../store.js");
    const db = path.join(ROOT, "data", "renamed.sqlite");
    const lock = path.join(ROOT, "data", ".renamed.sqlite.lock");
    const mine = ownLockLines(acquireStoreLock, db, lock);
    if (!mine.pidspace) return;
    fs.writeFileSync(
      lock,
      `${process.ppid}\nold-hostname.local\n0\npidspace:${mine.pidspace}\nstart:${parentStartRaw()}`,
    );
    let err: unknown;
    try {
      acquireStoreLock(db, { foreignWaitMs: 0 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StoreInUseError);
    expect((err as InstanceType<typeof StoreInUseError>).foreign).toBe(false);
    // So a shared open runs as a secondary at once instead of waiting 75 s.
    const started = Date.now();
    const s = new MemoryStore(db, { shared: true });
    expect(s.isPrimary).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
    s.close();
    fs.rmSync(lock);
  });

  it("a holder whose lock is taken over is told, once (2026-10 re-review F11)", async () => {
    const { acquireStoreLock } = await import("../store-lock.js");
    const db = path.join(ROOT, "data", "fenced.sqlite");
    const lock = path.join(ROOT, "data", ".fenced.sqlite.lock");
    let lost = 0;
    const release = acquireStoreLock(db, { heartbeatMs: 20, onLost: () => lost++ });
    await new Promise((r) => setTimeout(r, 60));
    expect(lost).toBe(0);
    fs.writeFileSync(lock, `${process.pid}\nnew-revision\n0\npidspace:x\nstart:y`);
    await new Promise((r) => setTimeout(r, 100));
    expect(lost).toBe(1);
    release();
    expect(fs.existsSync(lock)).toBe(true); // the successor's lock stays
    fs.rmSync(lock);
  });

  it("two spellings of one directory are one lock", async () => {
    const { acquireStoreLock } = await import("../store-lock.js");
    const db = path.join(ROOT, "data", "spelling.sqlite");
    const release = acquireStoreLock(db);
    try {
      const alias = path.join(ROOT, "data-alias");
      try {
        fs.symlinkSync(path.join(ROOT, "data"), alias, "dir");
      } catch {
        return; // platform cannot symlink: nothing to test
      }
      expect(() => acquireStoreLock(path.join(alias, "spelling.sqlite"))).toThrow(/already in use/);
    } finally {
      release();
    }
  });
});

describe("M4: adapter installs are pinned", () => {
  it("known adapters resolve to exact versions, unknown names are refused", async () => {
    const { pinnedInstallSpec, installDependencies } = await import("../collector/deps.js");
    expect(pinnedInstallSpec("imapflow")).toBe("imapflow@2.4.0");
    expect(pinnedInstallSpec("googleapis")).toBe("googleapis@185.0.0");
    expect(pinnedInstallSpec("some-unpinned-package")).toBeNull();
    const r = await installDependencies(["some-unpinned-package"]);
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/unpinned/);
  });
});

describe("M1: provenance archive stores no plaintext content", () => {
  it("send-tier content is encrypted on disk but round-trips on read", async () => {
    const prov = await import("../collector/provenance.js");
    const dataDir = path.join(ROOT, "prov-data");
    const secret = "plaintext-provenance-body-12345";
    prov.appendRawArchive(
      dataDir,
      {
        id: "evt-enc",
        source: "test-src",
        eventType: "agent_result",
        content: secret,
        timestamp: "2026-06-15T12:00:00Z",
        meta: {},
        importanceEstimate: 5,
        privacyTier: "send",
      } as any,
      secret,
    );
    prov.flushRawArchive();
    const file = fs.readFileSync(
      path.join(prov.rawArchiveDir(dataDir), "test-src", "2026-06.jsonl"),
      "utf-8",
    );
    expect(file).not.toContain(secret);
    const recs = prov.readRawArchive(dataDir, "test-src");
    expect(recs.find((r) => r.id === "evt-enc")?.content).toBe(secret);
  });
});

describe("shared stores: concurrent sessions (review 2026-10)", () => {
  it("a second shared open runs as a secondary, and takes over when the primary closes", async () => {
    const { MemoryStore } = await import("../store.js");
    const { chunkMarkdown } = await import("../chunker.js");
    const db = path.join(ROOT, "data", "shared.sqlite");
    const first = new MemoryStore(db, { shared: true });
    const second = new MemoryStore(db, { shared: true });
    try {
      expect(first.isPrimary).toBe(true);
      expect(second.isPrimary).toBe(false);
      // Both read and write the one index.
      const c = "---\nname: s\n---\nzebra launch window decided";
      await second.indexChunks(chunkMarkdown(c, "s.md"), 5, c);
      expect((await first.search("zebra launch window", 1))[0].file).toBe("s.md");
      expect(second.tryBecomePrimary()).toBe(false);
      first.close();
      expect(second.tryBecomePrimary()).toBe(true);
      expect(second.isPrimary).toBe(true);
    } finally {
      second.close();
    }
  });

  it("without `shared` a second open still fails (tools and tests that must be alone)", async () => {
    const { MemoryStore } = await import("../store.js");
    const db = path.join(ROOT, "data", "exclusive.sqlite");
    const first = new MemoryStore(db);
    try {
      expect(() => new MemoryStore(db)).toThrow(/already in use/);
    } finally {
      first.close();
    }
  });
});

describe("shared stores stay on one host (review 2026-10)", () => {
  it("a shared open refuses a live lock held on another host instead of becoming a secondary", async () => {
    const { MemoryStore } = await import("../store.js");
    const { StoreInUseError } = await import("../store-lock.js");
    const db = path.join(ROOT, "data", "netmount.sqlite");
    const lock = path.join(ROOT, "data", ".netmount.sqlite.lock");
    const foreign = `${process.ppid}\nother-host\n0\npidspace:another-machine\nstart:1`;
    fs.writeFileSync(lock, foreign);
    let err: unknown;
    try {
      new MemoryStore(db, { shared: true, foreignWaitMs: 0 }).close();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StoreInUseError);
    expect((err as InstanceType<typeof StoreInUseError>).foreign).toBe(true);
    expect(fs.readFileSync(lock, "utf-8")).toBe(foreign);
    fs.rmSync(lock);
    const s = new MemoryStore(db, { shared: true, foreignWaitMs: 0 });
    expect(s.isPrimary).toBe(true);
    s.close();
  });
});

/** The pidspace and start lines this process writes into its own lock. */
function ownLockLines(
  acquire: (db: string) => () => void,
  db: string,
  lock: string,
): { pidspace: string; start: string } {
  const release = acquire(db);
  const text = fs.readFileSync(lock, "utf-8");
  release();
  const tag = (t: string) =>
    (text.split("\n").find((l) => l.startsWith(`${t}:`)) ?? "").slice(t.length + 1);
  return { pidspace: tag("pidspace"), start: tag("start") };
}

/** The parent process's start record, as the lock reads it (Linux, macOS). */
function parentStartRaw(): string {
  if (process.platform === "linux") {
    const stat = fs.readFileSync(`/proc/${process.ppid}/stat`, "utf-8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  }
  return execFileSync("ps", ["-o", "lstart=", "-p", String(process.ppid)], {
    encoding: "utf-8",
    env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
  }).trim();
}

describe("shared stores and embedding providers (2026-10 re-review F8)", () => {
  it("a secondary with another provider refuses to open instead of wiping the index", async () => {
    const { MemoryStore } = await import("../store.js");
    const { chunkMarkdown } = await import("../chunker.js");
    const db = path.join(ROOT, "data", "providers.sqlite");
    const primary = new MemoryStore(db, { shared: true });
    try {
      const c = "---\nname: p\n---\nquokka habitat survey results";
      await primary.indexChunks(chunkMarkdown(c, "p.md"), 5, c);
      // The index was built by another provider than this process uses.
      (primary as any).db
        .prepare("UPDATE store_meta SET value = 'openai' WHERE key = 'embedding_provider'")
        .run();
      expect(() => new MemoryStore(db, { shared: true })).toThrow(/MEMORIA_EMBEDDINGS/);
      expect(primary.getStats().totalChunks).toBe(1);
      // This process's vectors do not belong in that index either.
      const d = "---\nname: q\n---\nwombat burrow depth notes";
      await expect(primary.indexChunks(chunkMarkdown(d, "q.md"), 5, d)).rejects.toThrow(
        /another embedding provider/,
      );
      // Search still works, by keywords.
      expect((await primary.search("quokka habitat", 1))[0].file).toBe("p.md");
    } finally {
      primary.close();
    }
  });
});

describe("overlapping indexers keep a memory's own date (2026-10 re-review F12)", () => {
  it("the second of two concurrent indexes of one content is a no-op", async () => {
    const { MemoryStore } = await import("../store.js");
    const { chunkMarkdown } = await import("../chunker.js");
    const s = new MemoryStore(path.join(ROOT, "data", "overlap.sqlite"));
    try {
      const c = "---\nname: o\nupdated: 2024-03-01\n---\nplatypus migration decided";
      const dates = { contentDate: "2024-03-01", mtimeMs: Date.now() };
      await Promise.all([
        s.indexChunks(chunkMarkdown(c, "o.md"), 5, c, dates),
        s.indexChunks(chunkMarkdown(c, "o.md"), 5, c, dates),
      ]);
      const rows = (s as any).db
        .prepare("SELECT updated_at, last_accessed FROM chunks WHERE file = 'o.md'")
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0].updated_at.slice(0, 10)).toBe("2024-03-01");
      const meta = (s as any).db
        .prepare("SELECT updated_at FROM file_meta WHERE file = 'o.md'")
        .get();
      expect(meta.updated_at.slice(0, 10)).toBe("2024-03-01");
    } finally {
      s.close();
    }
  });
});

describe("a store whose lock was taken over stops writing (2026-10 re-review F11)", () => {
  it("refuses writes, never retakes the lock, and tells its listeners", async () => {
    const { MemoryStore } = await import("../store.js");
    const { chunkMarkdown } = await import("../chunker.js");
    const s = new MemoryStore(path.join(ROOT, "data", "fence.sqlite"), { shared: true });
    let told = 0;
    s.onFenced(() => told++);
    (s as any).lockOptions().onLost(); // what the heartbeat calls on a takeover
    expect(told).toBe(1);
    expect(s.fenced).toBe(true);
    expect(s.isPrimary).toBe(false);
    const c = "---\nname: f\n---\nnarwhal tusk length";
    await expect(s.indexChunks(chunkMarkdown(c, "f.md"), 5, c)).rejects.toThrow(
      /lost the store lock/,
    );
    expect(() => s.removeFile("f.md")).toThrow(/lost the store lock/);
    expect(s.tryBecomePrimary()).toBe(false);
    s.close(); // a no-op while fenced: no WAL checkpoint into the new holder's file
    expect(() => s.getStats()).not.toThrow();
    (s as any).fenced = false;
    s.close();
  });
});

describe("store lock edge cases (2026-10 final review)", () => {
  it("one unreadable beat does not fence a healthy holder", async () => {
    const { acquireStoreLock } = await import("../store-lock.js");
    const db = path.join(ROOT, "data", "flaky.sqlite");
    const lock = path.join(ROOT, "data", ".flaky.sqlite.lock");
    let lost = 0;
    const release = acquireStoreLock(db, { heartbeatMs: 20, onLost: () => lost++ });
    const aside = `${lock}.aside`;
    fs.renameSync(lock, aside); // a transient read failure
    await new Promise((r) => setTimeout(r, 70));
    fs.renameSync(aside, lock);
    await new Promise((r) => setTimeout(r, 70));
    expect(lost).toBe(0);
    release();
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("a fresh lock from another boot with this hostname is another machine, not a leftover", async () => {
    const { acquireStoreLock, StoreInUseError } = await import("../store-lock.js");
    const db = path.join(ROOT, "data", "samename.sqlite");
    const lock = path.join(ROOT, "data", ".samename.sqlite.lock");
    const mine = ownLockLines(acquireStoreLock, db, lock);
    if (!mine.pidspace.includes("/")) return; // Linux pid spaces only
    const other = `${process.ppid}\n${os.hostname()}\n0\npidspace:other-boot/${mine.pidspace.split("/")[1]}\nstart:1`;
    fs.writeFileSync(lock, other);
    let err: unknown;
    try {
      acquireStoreLock(db, { foreignWaitMs: 0 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StoreInUseError);
    expect((err as InstanceType<typeof StoreInUseError>).foreign).toBe(true);
    // Last refreshed before this machine booted: a leftover, reclaimed.
    const beforeBoot = new Date(Date.now() - os.uptime() * 1000 - 60_000);
    fs.utimesSync(lock, beforeBoot, beforeBoot);
    acquireStoreLock(db, { foreignWaitMs: 0 })();
  });

  it("this container's previous run's lock is reclaimed after one missed heartbeat", async () => {
    const { acquireStoreLock } = await import("../store-lock.js");
    const db = path.join(ROOT, "data", "restarted.sqlite");
    const lock = path.join(ROOT, "data", ".restarted.sqlite.lock");
    const mine = ownLockLines(acquireStoreLock, db, lock);
    if (!mine.pidspace.includes("/")) return;
    const boot = mine.pidspace.split("/")[0];
    fs.writeFileSync(lock, `7\n${os.hostname()}\n0\npidspace:${boot}/pid:[1]\nstart:1`);
    const old = new Date(Date.now() - 30_000);
    fs.utimesSync(lock, old, old);
    const started = Date.now();
    acquireStoreLock(db, { foreignWaitMs: 0 })();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
