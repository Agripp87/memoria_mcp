import { describe, it, expect } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// 2026-10 re-review F13: the stdio server re-embedded the whole store before
// it answered the MCP handshake. After an index upgrade that took longer than
// a client waits (30 s in Claude Code), and the session had no memory tools.
// Runs the built server (CI builds before testing).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(__dirname, "..", "..", "dist", "index.js");

describe("stdio startup", () => {
  it.skipIf(!fs.existsSync(ENTRY))(
    "answers initialize before the startup reindex finishes",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-handshake-"));
      fs.mkdirSync(path.join(dir, "memories", "notes"), { recursive: true });
      for (let i = 0; i < 300; i++) {
        const words = Array.from({ length: 300 }, (_, j) => `word${(i * 31 + j) % 997}`).join(" ");
        fs.writeFileSync(
          path.join(dir, "memories", "notes", `n${i}.md`),
          `---\nname: n${i}\n---\n${words}\n`,
        );
      }
      const child = spawn(process.execPath, [ENTRY], {
        env: { ...process.env, MEMORIA_DIR: dir, MEMORIA_EMBEDDINGS: "hash" },
      });
      const events: string[] = [];
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(events.join("\n"))), 60_000);
          child.stdout.on("data", (d) => {
            if (String(d).includes('"protocolVersion"')) events.push("initialized");
          });
          child.stderr.on("data", (d) => {
            if (/indexed \d+ memory files/.test(String(d))) {
              events.push("indexed");
              clearTimeout(timer);
              resolve();
            }
          });
          child.stdin.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: { name: "test", version: "1" },
              },
            }) + "\n",
          );
        });
        expect(events).toEqual(["initialized", "indexed"]);
      } finally {
        child.kill();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    70_000,
  );
});
