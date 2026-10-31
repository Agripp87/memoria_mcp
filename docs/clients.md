# Memoria in other MCP clients

Memoria is a standard [MCP](https://modelcontextprotocol.io) server over **stdio** (local) or **HTTP** with OAuth (remote). Claude Code and claude.ai are documented in the [README](../README.md); this page covers additional clients contributors have actually run.

Only configurations verified in a real environment are listed. If something does not match your setup, open an issue with the client name and version.

## Cursor

**Tested with:** Memoria `@agrippa87/memoria-mcp` from npm (stdio via `npx`); terminal startup and indexing verified on Linux with Node 20+. Cursor’s MCP UI was not re-tested for this doc — use **Output → MCP Logs** if tools do not appear.

Cursor loads MCP servers from JSON. Use a **global** file for every project, or a **project** file to share config with your team.

| Scope | Path |
|-------|------|
| Global | `~/.cursor/mcp.json` (Windows: `%USERPROFILE%\.cursor\mcp.json`) |
| Project | `.cursor/mcp.json` at the **root of the folder you open** in Cursor |

After saving, restart Cursor or reload MCP from **Customize → MCPs**. Check **Output → MCP Logs** if the server does not appear.

### Recommended: npm (no clone)

```json
{
  "mcpServers": {
    "memoria": {
      "command": "npx",
      "args": ["-y", "@agrippa87/memoria-mcp"],
      "env": {
        "MEMORIA_DIR": "${userHome}/.memoria"
      }
    }
  }
}
```

- **`MEMORIA_DIR`** — directory for Markdown memories and the derived SQLite index. Created on first write if missing. Omit `env` entirely to use the default `~/.memoria`.
- **`OPENAI_API_KEY`** — optional; only used when you also set `MEMORIA_EMBEDDINGS=openai` (see README). Do not put secrets in committed project `mcp.json`; use `${env:OPENAI_API_KEY}` or a local-only global config.

### Windows paths

Cursor’s `${userHome}` interpolation can expand to a URI form that breaks some stdio spawns on Windows. Prefer:

```json
"MEMORIA_DIR": "${env:USERPROFILE}/.memoria"
```

Use forward slashes or escaped backslashes in JSON if you point at a custom folder (e.g. `D:/memoria-store`).

### Development: run from a git checkout

If you are hacking on Memoria itself, use the launcher script (same as Claude Code) so `tsc` runs before stdio starts:

```json
{
  "mcpServers": {
    "memoria": {
      "command": "node",
      "args": ["/absolute/path/to/memoria_mcp/mcp-server/scripts/mcp-start.mjs"],
      "env": {
        "MEMORIA_DIR": "/absolute/path/to/your/memory-store"
      }
    }
  }
}
```

Replace paths with your checkout and store. Build once with `npm run build` in `mcp-server/` if you bypass `mcp-start.mjs`.

### Cursor-specific notes

- **Tool count:** Memoria registers many tools (memory, collector, lint, compile, …). Cursor may warn when total MCP tools across all servers grow large; disable individual tools you do not need under **Customize → MCPs** rather than trimming Memoria’s surface in code.
- **First start:** Without OpenAI embeddings, the server downloads the local MiniLM model once (~23 MB). Allow network on the first `npx` launch. From a git checkout you can prefetch with `node scripts/prefetch-model.mjs` in `mcp-server/` (same script the Docker build uses).
- **Collector consent:** Enabling ingestion sources still requires consent in the **dashboard**; MCP clients cannot consent on your behalf (see README security notes). The dashboard runs in the HTTP server, so start `memoria-mcp-http` before Cursor or Claude when you want to set up sources: the server that opens the store first runs the collector.

### Quick sanity check (terminal)

This is the same process Cursor spawns; it should print startup lines and then wait on stdio (Ctrl+C to exit). Since 0.3.1 the server answers the client before it indexes, so the index line follows the startup line:

```bash
export MEMORIA_DIR="${MEMORIA_DIR:-/tmp/memoria-mcp-test}"
npx -y @agrippa87/memoria-mcp
# → "Memoria MCP server started."
# → "Memoria: indexed N memory files."
```

## Contributing another client

Open a PR that adds a section here (one client per PR is fine). Include the config snippet, client version, OS, and how you verified tools connect (e.g. listed in the client’s MCP UI or a successful `tools/list`).
