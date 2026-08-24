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
