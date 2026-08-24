#!/usr/bin/env node

/**
 * Memoria MCP Server — stdio transport for Claude Code.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryStore } from "./store.js";
import {
  DB_PATH,
  getAllMemoryFiles,
  reindexFile,
  setupWatcher,
  setupPeriodicReindex,
  setupPeriodicOptimize,
  setupPeriodicCompile,
  registerTools,
  registerCollectorTools,
  destroyCollector,
} from "./tools.js";

const store = new MemoryStore(DB_PATH);

const server = new McpServer({
  name: "memoria",
  version: "0.1.0",
  description:
    "Persistent, plain-text memory for Claude. MANDATORY: Every session MUST produce at least one daily log entry via memory_daily. At session start, read today's daily log. Before session ends, write a session summary. A session without a daily log entry is a failed session.",
});

registerTools(server, store);
registerCollectorTools(server, store);

async function main(): Promise<void> {
  const files = getAllMemoryFiles();
  if (store.needsReindex) {
    process.stderr.write("Memoria: full reindex triggered by provider change...\n");
  }
  for (const f of files) {
    await reindexFile(store, f);
  }
  process.stderr.write(`Memoria MCP server started. Indexed ${files.length} files.\n`);

  setupWatcher(store);
  setupPeriodicReindex(store);
  setupPeriodicOptimize(store); // no-op unless MEMORIA_AUTO_OPTIMIZE=true
  setupPeriodicCompile(store); // no-op unless MEMORIA_AUTO_COMPILE=true

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await destroyCollector();
  store.close();
  process.exit(0);
});
