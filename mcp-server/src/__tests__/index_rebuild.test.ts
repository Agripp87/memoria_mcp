import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

// tools.ts reads MEMORIA_DIR at import time, so set it before importing.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-idx-"));
process.env.MEMORIA_DIR = ROOT;
const MEM = path.join(ROOT, "memories");

let rebuildMarkdownIndex: () => string;
let runLint: typeof import("../lint.js").runLint;
let MemoryStore: typeof import("../store.js").MemoryStore;
let tools: typeof import("../tools.js");
let store: any;

function writeMemory(rel: string, frontmatter: Record<string, unknown>, body: string) {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`)
    .join("\n");
  const full = path.join(MEM, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `---\n${fm}\n---\n\n${body}\n`, "utf-8");
  return full;
}

beforeAll(async () => {
  fs.mkdirSync(MEM, { recursive: true });
  writeMemory(
    "user/profile.md",
    {
      name: "User profile",
      description: "Who the user is",
      type: "user",
      importance: 9,
      updated: "2026-06-01",
    },
    "The user is Alex.",
  );
  writeMemory(
    "decisions/use-sqlite.md",
    {
      name: "Use SQLite",
      description: "Index store choice",
      type: "decision",
      importance: 7,
      updated: "2026-06-02",
    },
    "We chose SQLite for the derived index.",
  );
  writeMemory(
    "daily/2026-06-05.md",
    {
      name: "Daily log",
      description: "log",
      type: "session",
      importance: 3,
      updated: "2026-06-05",
    },
    "## 10:00 — orchestrator\n\nran a job",
  );

  tools = await import("../tools.js");
  rebuildMarkdownIndex = tools.rebuildMarkdownIndex;
  ({ runLint } = await import("../lint.js"));
  ({ MemoryStore } = await import("../store.js"));
  store = new MemoryStore(path.join(ROOT, "data", "idx.sqlite"));
});

afterAll(() => {
  try {
    store?.close();
  } catch {}
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {}
});

describe("rebuildMarkdownIndex (P1)", () => {
  const indexPath = () => path.join(MEM, "MEMORY_INDEX.md");

  it("lists core memories grouped by type and excludes itself", () => {
    rebuildMarkdownIndex();
    const txt = fs.readFileSync(indexPath(), "utf-8");
    expect(txt).toContain("user/profile.md");
    expect(txt).toContain("decisions/use-sqlite.md");
    // Daily logs appear under their own section, not the core type groups.
    expect(txt).toContain("## Daily Logs");
    // The index never lists itself.
    expect(txt).not.toContain("](MEMORY_INDEX.md)");
  });

  it("is idempotent — a second rebuild reports unchanged and doesn't rewrite", () => {
    rebuildMarkdownIndex();
    const before = fs.statSync(indexPath()).mtimeMs;
    const summary = rebuildMarkdownIndex();
    expect(summary).toContain("unchanged");
    expect(fs.statSync(indexPath()).mtimeMs).toBe(before);
  });

  it("preserves a hand-curated manual appendix across rebuilds", () => {
    const sentinel = "<!-- MEMORIA:MANUAL — content below is preserved across auto-rebuilds -->";
    const curated = `${sentinel}\n\n## Cross-store pointers\n\n- Project store lives elsewhere.\n`;
    fs.appendFileSync(indexPath(), "\n" + curated, "utf-8");
    // Add a new memory so the generated part definitely changes and a write happens.
    writeMemory(
      "references/note.md",
      {
        name: "A note",
        description: "ref",
        type: "reference",
        importance: 5,
        updated: "2026-06-10",
      },
      "reference body",
    );
    rebuildMarkdownIndex();
    const txt = fs.readFileSync(indexPath(), "utf-8");
    expect(txt).toContain("references/note.md"); // regenerated section
    expect(txt).toContain("Cross-store pointers"); // appendix survived
    expect(txt).toContain(sentinel);
  });
});

describe("lint index drift (P1)", () => {
  it("flags a core memory that is missing from the index", async () => {
    // Write a brand-new core memory but DON'T rebuild the index.
    writeMemory(
      "feedback/be-terse.md",
      {
        name: "Be terse",
        description: "style",
        type: "feedback",
        importance: 7,
        updated: "2026-06-11",
      },
      "Prefer terse answers.",
    );
    const result = await runLint(store, MEM, tools.getAllMemoryFiles, tools.getRelativePath);
    expect(result.indexDrift.missingFromIndex).toContain("feedback/be-terse.md");
  });

  it("clears the drift once the index is rebuilt", async () => {
    rebuildMarkdownIndex();
    const result = await runLint(store, MEM, tools.getAllMemoryFiles, tools.getRelativePath);
    expect(result.indexDrift.missingFromIndex).not.toContain("feedback/be-terse.md");
  });
});

describe("lint with %, spaces and parentheses in file names (2026-10 re-review F43)", () => {
  it("resolves, and reports none of them missing or stale", async () => {
    for (const name of ["50%-plan.md", "my plan.md", "a%41b.md", "notes (v2).md"]) {
      writeMemory(`decisions/${name}`, { name, description: "d", type: "decision" }, "body");
    }
    rebuildMarkdownIndex();
    const r = await runLint(store, MEM, tools.getAllMemoryFiles, tools.getRelativePath);
    for (const name of ["50%-plan.md", "my plan.md", "a%41b.md", "notes (v2).md"]) {
      expect(r.indexDrift.missingFromIndex).not.toContain(`decisions/${name}`);
      expect(r.indexDrift.staleInIndex).not.toContain(`decisions/${name}`);
    }
    // A link that cannot be decoded is reported, not fatal.
    fs.appendFileSync(path.join(MEM, "MEMORY_INDEX.md"), "\n- [bad](decisions/bad%zz.md)\n");
    const again = await runLint(store, MEM, tools.getAllMemoryFiles, tools.getRelativePath);
    expect(again.indexDrift.staleInIndex).toContain("decisions/bad%zz.md");
    for (const name of ["50%-plan.md", "my plan.md", "a%41b.md", "notes (v2).md"]) {
      fs.rmSync(path.join(MEM, "decisions", name));
    }
    rebuildMarkdownIndex();
  });
});

describe("a case-only rename drops the old index key (2026-10 re-review F40)", () => {
  it("keeps only the spelling on disk, even where lstat ignores case", async () => {
    const old = writeMemory(
      "decisions/API-Plan.md",
      { name: "p", type: "decision" },
      "zebrafish sprint",
    );
    await tools.reindexAll(store);
    expect(store.getIndexedFiles()).toContain("decisions/API-Plan.md");
    // Rename to a new case; emulate a case-insensitive filesystem's lstat.
    fs.renameSync(old, path.join(MEM, "decisions", "api-plan.md"));
    fs.writeFileSync(
      path.join(MEM, "decisions", "api-plan.md"),
      "---\nname: p\ntype: decision\n---\n\nmanatee sprint\n",
    );
    const lstat = fs.lstatSync;
    (fs as any).lstatSync = (p: fs.PathLike, ...rest: any[]) =>
      (lstat as any)(String(p).replace("API-Plan.md", "api-plan.md"), ...rest);
    try {
      await tools.reindexAll(store);
    } finally {
      (fs as any).lstatSync = lstat;
    }
    const files = store.getIndexedFiles();
    expect(files).toContain("decisions/api-plan.md");
    expect(files).not.toContain("decisions/API-Plan.md");
    expect((await store.search("zebrafish sprint", 5)).map((r: any) => r.file)).not.toContain(
      "decisions/API-Plan.md",
    );
    fs.rmSync(path.join(MEM, "decisions", "api-plan.md"));
    await tools.reindexAll(store);
  });
});

describe("MEMORIA_DIR default (2026-10 re-review F48)", () => {
  it("warns about a 0.2.x store in /data/memoria and does not switch to it", () => {
    const warnings: string[] = [];
    const dir = tools.resolveDefaultMemoriaDir({
      env: {},
      homedir: "/home/u",
      exists: (p) => p === "/data/memoria/memories",
      warn: (m) => warnings.push(m),
    });
    expect(dir).toBe(path.join("/home/u", ".memoria"));
    expect(warnings.join("")).toMatch(/MEMORIA_DIR=\/data\/memoria/);
    expect(tools.resolveDefaultMemoriaDir({ env: { DOCKER: "true" }, exists: () => true })).toBe(
      "/data/memoria",
    );
    const quiet: string[] = [];
    tools.resolveDefaultMemoriaDir({ env: {}, exists: () => false, warn: (m) => quiet.push(m) });
    expect(quiet).toEqual([]);
  });
});
