# memoria-mcp

**Persistent, plain-text memory for Claude over MCP — Markdown files you own.**

This PyPI package holds the `memoria-mcp` name. **The server itself is not
distributed here** — Memoria is a Node application, published on npm and
installable as a Claude Code plugin.

- **Project and documentation:** <https://github.com/Agripp87/memoria_mcp>
- **License:** Apache-2.0

## What Memoria is

An [MCP](https://modelcontextprotocol.io) server giving Claude Code, claude.ai
and any other MCP client a shared long-term memory. Memories are Markdown files
with YAML frontmatter in a directory you control; a derived SQLite + FTS5 index
provides hybrid semantic and keyword search; agentic tools keep the store
healthy. The Markdown files are the source of truth — the index is derived and
can be rebuilt from them at any time.

## Installing the actual server

```bash
# As a Claude Code plugin
/plugin marketplace add Agripp87/memoria_mcp
/plugin install memoria@memoria
```

See the [repository README](https://github.com/Agripp87/memoria_mcp) for the
stdio and HTTP transports, deployment, and multi-device sync.

## Why this package exists

Two reasons, and neither is "there is Python code here yet":

1. To keep the `memoria-mcp` name pointing at the real project rather than at
   whatever else might claim it.
2. Memoria ships a small Python client for pushing events into the server's
   `/ingest` endpoint from external agent systems
   ([`integrations/orchestrator_hook.py`](https://github.com/Agripp87/memoria_mcp/blob/main/integrations/orchestrator_hook.py)).
   If that grows into something worth installing, this is where it will live.

Until then, importing this package prints where to actually go.
