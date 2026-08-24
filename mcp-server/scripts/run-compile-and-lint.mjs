#!/usr/bin/env node
/**
 * One-shot: run the entity-compile loop and the full lint suite against the
 * REAL memory store, from the command line. This is the first time either has
 * run against real data (2026-07-25 review, finding 6: `entities/` did not
 * exist and memory_lint had never been invoked).
 *
 * Usage: node scripts/run-compile-and-lint.mjs   (from mcp-server/, after tsc)
 */

process.env.MEMORIA_DIR = process.env.MEMORIA_DIR || "C:\\Users\\egber\\memoria";

const { MemoryStore } = await import("../dist/store.js");
const tools = await import("../dist/tools.js");
const { buildEntityPages } = await import("../dist/entities.js");
const { runLint, formatLintReport } = await import("../dist/lint.js");

const store = new MemoryStore(tools.DB_PATH);

// ── 1. Entity compile ──────────────────────────────────────
const res = buildEntityPages(tools.MEMORIES_DIR, { days: 30, minEvents: 3 });
console.log(`ENTITY COMPILE: scanned ${res.eventsScanned} events, ${res.sourcesSeen} source(s)`);
console.log(`  written: ${res.written.length ? res.written.join(", ") : "(none)"}`);
console.log(`  skipped (human-owned): ${res.skipped.length ? res.skipped.join(", ") : "(none)"}`);

for (const rel of res.written) {
  await tools.reindexFile(store, tools.resolveMemoryPath(rel));
}
if (res.written.length > 0) console.log("  " + tools.rebuildMarkdownIndex());

// ── 2. Lint ────────────────────────────────────────────────
const lint = await runLint(
  store,
  tools.MEMORIES_DIR,
  tools.getAllMemoryFiles,
  tools.getRelativePath,
);
console.log("\n" + formatLintReport(lint));

store.close();
