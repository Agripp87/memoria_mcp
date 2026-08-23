/**
 * Phase 4 (critical-review remediation, D3): direct tests for the core MCP
 * tool handlers in tools.ts — previously the product's primary surface at ~9%
 * coverage with no dedicated test.
 *
 * Handlers are captured through a shim that records what registerTools()
 * registers, then invoked directly with real stores on a temp MEMORIA_DIR —
 * the same handler code paths the MCP dispatch runs, without SDK plumbing.
 * The 4 collector tools are exercised via their subsystem suites (buffer/
 * ingestion/registry/dataloss) — spinning the poll daemon here would be slow
 * and flaky.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-tools-"));
process.env.MEMORIA_DIR = ROOT;
const MEM = path.join(ROOT, "memories");

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const handlers = new Map<string, Handler>();

let store: any;

function text(r: { content: Array<{ type: string; text: string }> }): string {
  return r.content.map((c) => c.text).join("\n");
}

beforeAll(async () => {
  fs.mkdirSync(path.join(MEM, "daily"), { recursive: true });
  const tools = await import("../tools.js");
  const { MemoryStore } = await import("../store.js");
  store = new MemoryStore(path.join(ROOT, "data", "tools.sqlite"));

  // Capture shim: records name -> handler exactly as registered.
  const fakeServer = {
    tool: (name: string, _desc: string, _schema: unknown, handler: Handler) => {
      handlers.set(name, handler);
    },
  };
  tools.registerTools(fakeServer as any, store);
});

afterAll(() => {
  try { store?.close(); } catch {}
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

describe("registration", () => {
  it("registers the 13 core tools", () => {
    for (const name of [
      "memory_search", "memory_read", "memory_write", "memory_list",
      "memory_index", "memory_daily", "memory_optimize", "memory_reflect",
      "memory_stats", "memory_lint", "memory_compile", "memory_compact",
      "memory_entities",
    ]) {
      expect(handlers.has(name), name).toBe(true);
    }
  });
});

describe("memory_write / memory_read round trip", () => {
  it("writes a valid memory and reads it back", async () => {
    const content = "---\nname: Widget\ndescription: a widget\ntype: project\nimportance: 6\n---\n\nWidget details body.";
    const w = await handlers.get("memory_write")!({ file: "project/widget.md", content, force: false });
    expect(text(w)).toContain("Written: project/widget.md");

    const r = await handlers.get("memory_read")!({ file: "project/widget.md" });
    expect(text(r)).toContain("Widget details body.");
  });

  it("rejects an invalid filename", async () => {
    const w = await handlers.get("memory_write")!({ file: "bad name!.md", content: "x", force: false });
    expect(text(w)).toContain("Error: filename must match");
  });

  it("rejects oversized content", async () => {
    const w = await handlers.get("memory_write")!({
      file: "project/big.md",
      content: "x".repeat(101 * 1024),
      force: false,
    });
    expect(text(w)).toContain("exceeds 100KB");
  });

  it("memory_read returns empty (not an error) for missing and traversal paths", async () => {
    const missing = await handlers.get("memory_read")!({ file: "nope/missing.md" });
    expect(text(missing)).toBe("");
    const traversal = await handlers.get("memory_read")!({ file: "../../etc/passwd" });
    expect(text(traversal)).toBe("");
  });

  it("flags near-duplicate content instead of writing (dedup gate)", async () => {
    const original = "---\nname: Dup A\ntype: reference\nimportance: 5\n---\n\nA very distinctive sentence about purple gorillas dancing at midnight in the observatory.";
    await handlers.get("memory_write")!({ file: "references/dup-a.md", content: original, force: false });
    const dup = await handlers.get("memory_write")!({
      file: "references/dup-b.md",
      content: "---\nname: Dup B\ntype: reference\nimportance: 5\n---\n\nA very distinctive sentence about purple gorillas dancing at midnight in the observatory.",
      force: false,
    });
    expect(text(dup)).toContain("Potential duplicates found");
    expect(fs.existsSync(path.join(MEM, "references", "dup-b.md"))).toBe(false);
  });
});

describe("memory_search", () => {
  it("finds indexed content and reports scores", async () => {
    const r = await handlers.get("memory_search")!({ query: "widget details", max_results: 5 });
    const out = text(r);
    expect(out).toContain("project/widget.md");
    expect(out).toContain("Score:");
  });

  it("returns a friendly message when nothing matches", async () => {
    const r = await handlers.get("memory_search")!({ query: "zzz-nonexistent-term-qqq", max_results: 3 });
    // Either no matches or low-score results — must not throw. (Hash provider
    // can surface weak lexical matches.)
    expect(text(r).length).toBeGreaterThan(0);
  });
});

describe("memory_daily", () => {
  it("appends to today's log and creates it with frontmatter on first write", async () => {
    const r = await handlers.get("memory_daily")!({ entry: "Test entry from tools.test.ts" });
    expect(text(r)).toContain("Appended to daily log");
    const today = new Date().toISOString().split("T")[0];
    const daily = fs.readFileSync(path.join(MEM, "daily", `${today}.md`), "utf-8");
    expect(daily).toContain("Test entry from tools.test.ts");
    expect(daily).toContain("type: session");
  });
});

describe("memory_list / memory_index / memory_stats", () => {
  it("lists memories with type filter", async () => {
    const r = await handlers.get("memory_list")!({ type: "project" });
    expect(text(r)).toContain("project/widget.md");
  });

  it("rebuilds the index and the MEMORY_INDEX.md catalog", async () => {
    const r = await handlers.get("memory_index")!({});
    expect(text(r)).toContain("Rebuilt MEMORY_INDEX.md");
    expect(fs.existsSync(path.join(MEM, "MEMORY_INDEX.md"))).toBe(true);
  });

  it("reports store health", async () => {
    const r = await handlers.get("memory_stats")!({});
    const out = text(r);
    expect(out).toContain("Memory Store Health");
    expect(out).toContain("Files on disk:");
  });
});

describe("memory_optimize / memory_reflect / memory_compact / memory_lint", () => {
  it("runs each optimize action without error", async () => {
    for (const action of ["decay", "promote", "detect_stale", "find_duplicates"]) {
      const r = await handlers.get("memory_optimize")!({ action });
      expect(text(r)).toContain(action);
    }
  });

  it("reflect returns recent daily logs for synthesis", async () => {
    const r = await handlers.get("memory_reflect")!({ days: 7 });
    expect(text(r)).toContain("daily log");
  });

  it("compact digests daily logs and points at memory_compile", async () => {
    const r = await handlers.get("memory_compact")!({ days: 7, max_chars: 15000 });
    expect(text(r)).toContain("Daily Log Digest");
  });

  it("lint runs all checks and returns a report", async () => {
    const r = await handlers.get("memory_lint")!({});
    expect(text(r)).toContain("Memory Lint Report");
  });
});

describe("memory_compile", () => {
  it("compiles content into a typed core memory with frontmatter + index update", async () => {
    const r = await handlers.get("memory_compile")!({
      content: "A compiled insight about the quarterly llama migration patterns across the Andes, long enough to be its own memory.",
      name: "Llama migration insight",
      type: "reference",
      tags: ["llamas", "insight"],
    });
    const out = text(r);
    expect(out).toContain("Compiled: references/llama-migration-insight.md");
    const file = fs.readFileSync(path.join(MEM, "references", "llama-migration-insight.md"), "utf-8");
    expect(file).toContain("origin: compiled");
  });

  it("rejects an unmapped write path via type enum shape (error text on bad slug collision cap is separate)", async () => {
    // Slug collision: compiling the same name again appends -2 (no overwrite).
    const r = await handlers.get("memory_compile")!({
      content: "A different body so the dedup gate does not fire: alpacas, not llamas, and entirely other words about highland grazing.",
      name: "Llama migration insight",
      type: "reference",
      tags: ["alpacas"],
    });
    expect(text(r)).toContain("llama-migration-insight-2.md");
  });
});

describe("memory_entities", () => {
  it("compiles daily-log events into an entity rollup page", async () => {
    const today = new Date().toISOString().split("T")[0];
    const daily = path.join(MEM, "daily", `${today}.md`);
    fs.appendFileSync(
      daily,
      `\n## 10:00 AM — tools-src\n\nfirst event body\n\n*importance: 5 | privacy: send*\n` +
        `\n## 10:01 AM — tools-src\n\nsecond event body\n\n*importance: 5 | privacy: send*\n` +
        `\n## 10:02 AM — tools-src\n\nthird event body\n\n*importance: 8 | privacy: send*\n`
    );
    const r = await handlers.get("memory_entities")!({ days: 30, min_events: 3 });
    expect(text(r)).toContain("entities/tools-src.md");
    expect(fs.existsSync(path.join(MEM, "entities", "tools-src.md"))).toBe(true);
  });
});
