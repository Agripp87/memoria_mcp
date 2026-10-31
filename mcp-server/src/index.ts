#!/usr/bin/env node

/**
 * Memoria MCP Server — stdio transport for Claude Code.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryStore } from "./store.js";
import {
  DB_PATH,
  startBackgroundIndexing,
  registerTools,
  registerCollectorTools,
  destroyCollector,
  haltCollector,
  resumeCollectorIfConfigured,
  SERVER_DESCRIPTION,
} from "./tools.js";

// Shared: every Claude Code window and Claude Desktop session starts its own
// stdio server on the same store. The first is the primary; the rest run as
// secondaries (see MemoryStore).
const store = new MemoryStore(DB_PATH, { shared: true });

const server = new McpServer({
  name: "memoria",
  version: "0.3.1",
  description: SERVER_DESCRIPTION,
});

registerTools(server, store);
registerCollectorTools(server, store);

// Declared before main() runs: its first loop iteration reads it
// synchronously, before the rest of this module has been evaluated.
let shuttingDown = false;

async function main(): Promise<void> {
  // Another instance took the store over: stop collecting (see fenced).
  store.onFenced(haltCollector);

  const transport = new StdioServerTransport();
  // Exit when the client goes away. Without this a server whose client died
  // without sending a signal lived on (the file watcher keeps the event loop
  // busy), holding the store lock for every later session.
  // (Several of these fire for one disconnect; only signals escalate a
  // second request to a forced exit.)
  const clientGone = () => {
    if (!shuttingDown) void shutdown();
  };
  transport.onclose = clientGone;
  process.stdin.on("end", clientGone);
  process.stdin.on("close", clientGone);
  // Answer the client first. The startup sweep re-embeds the whole store
  // after a provider change or an index upgrade, which on a few thousand
  // chunks took longer than the client waits for the handshake (30 s in
  // Claude Code), and the session came up without memory tools.
  await server.connect(transport);
  process.stderr.write("Memoria MCP server started.\n");

  // After connecting, so a slow source (an IMAP login) never delays the
  // client's handshake. Errors are logged inside.
  void resumeCollectorIfConfigured(store);
  await startBackgroundIndexing(store, { watch: true, shouldStop: () => shuttingDown });
}

main().catch((err) => {
  // Once shutting down, an error from work cut short is expected; exiting 1
  // here would pre-empt shutdown()'s clean exit(0).
  if (shuttingDown) return;
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});

// SIGTERM as well as SIGINT: a client stopping this stdio server, a service
// manager, or a container runtime sends SIGTERM, and without a handler the
// process died without closing SQLite or flushing the collector. A second
// signal while shutting down forces the exit.

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    process.exit(1);
  }
  // Taken over: no flush, no close (both write the store the new holder
  // is using), and no normal exit, which closes SQLite handles too.
  if (store.fenced) MemoryStore.exitWithoutCheckpoint();
  shuttingDown = true;
  setTimeout(() => process.exit(1), 8_000).unref();
  let exitCode = 0;
  try {
    await destroyCollector();
  } catch (err) {
    process.stderr.write(`Memoria: error during shutdown: ${err}\n`);
    exitCode = 1;
  } finally {
    store.close();
  }
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown());
}
