# Memoria fact sheet

The only facts the DevRel and marketing agents may state about Memoria. Every
line cites where it comes from; when the source changes, this file changes in
the same PR. A claim that is not here (or directly in a cited file) does not go
into a draft — add it here first, with a source, and have a human approve it.

Last checked against: `README.md`, `CHANGELOG.md`, `SECURITY.md`,
`CONTRIBUTING.md`, `mcp-server/package.json` at version 0.2.1 plus
`[Unreleased]`.

## Identity

| Fact | Source |
|------|--------|
| One-liner: "Persistent, plain-text memory for Claude — as a Markdown repo you own." | `README.md` (title) |
| It is an MCP server for Claude Code, claude.ai (Chat / CoWork) and any other MCP client | `README.md` (intro) |
| License: Apache-2.0 | `LICENSE`, `README.md` §License |
| Current release: 0.2.1 | `mcp-server/package.json` |
| npm package: `@agrippa87/memoria-mcp` (Node 20+) | `README.md` §Quick Start |
| Claude Code plugin: `/plugin marketplace add Agripp87/memoria_mcp` then `/plugin install memoria@memoria` | `README.md` §Option A |
| Repo: https://github.com/Agripp87/memoria_mcp | `.claude-plugin/plugin.json` |
| Status: **early public release**, pre-1.0. The memory file format is stable; env-var names, endpoints and tool signatures may change in a minor release | `README.md` (status note), `CHANGELOG.md` (header) |
| Solo-maintained in spare time; review is asynchronous | `CONTRIBUTING.md` §Expectations |
| Has run as the maintainer's daily driver since spring 2026 | `README.md` (status note) |

## What it does

| Fact | Source |
|------|--------|
| Memories are Markdown files with YAML frontmatter in a directory you control; the SQLite + FTS5 index is derived and fully rebuildable | `README.md` (intro, Architecture) |
| 17 MCP tools: 13 core memory tools + 4 collector tools | `README.md` §MCP Tools |
| Hybrid search: vector cosine similarity (0.7) + FTS5 BM25 (0.3) | `README.md` §Features |
| Retrieval score: `0.2 × recency + 0.3 × importance + 0.5 × relevance` | `README.md` §Features |
| Embeddings: local `all-MiniLM-L6-v2` (offline after a ~23 MB one-time download), n-gram hashing fallback, OpenAI only with explicit `MEMORIA_EMBEDDINGS=openai` | `README.md` §Features, `CHANGELOG.md` [Unreleased] |
| Every search result reports its scan coverage | `README.md` ("Honest about search") |
| Write-time dedup checks the top-3 similar memories before every write | `README.md` §Features |
| Agentic maintenance: reflect, lint (contradictions, orphans, gaps, index drift…), compact, compile, entity pages ("compile, don't retrieve") | `README.md` §MCP Tools |
| Multi-device sync through git, no sync service; daily logs merge with git's `union` driver so same-day entries from two machines are never lost | `README.md` §Multi-device sync |
| Plugin install wires SessionStart/Stop git-sync hooks when the store is a git repo | `README.md` §Option A, `hooks/hooks.json` |
| Two transports: stdio (Claude Code) and Streamable HTTP/SSE with OAuth 2.1 (authorization_code + PKCE, client_credentials, dynamic client registration, metadata discovery) | `README.md` §Features, §Security |
| Works as a claude.ai custom connector | `README.md` ("Spec-complete remote transport") |
| Web dashboard with a wiki view; `npm run demo` serves fake data in ~30 seconds | `README.md` §Dashboard, §Try it on fake data |
| Docker image (non-root) and a reference Cloud Run + GCS FUSE template | `README.md` §Features |
| Optional collector (iMessage, macOS Calendar, IMAP, Gmail, Google Calendar, Google Drive, custom sources) — **experimental** | `README.md` (status note), `SECURITY.md` §The collector |
| Collector data is AES-256-GCM encrypted at rest; memory files themselves are plain text | `SECURITY.md` (encryption row) |
| Collector consent is granted only in the dashboard, never through MCP | `CHANGELOG.md` [Unreleased], `SECURITY.md` |
| CI runs the test suite on Ubuntu and Windows, with per-file coverage floors | `README.md` (status note, Features) |
| npm releases are staged from GitHub Actions with signed provenance | `README.md` §Roadmap |

## Things we must say carefully (or not at all)

| Topic | The honest version | Source |
|-------|--------------------|--------|
| Security | Single-tenant, single-user; one static API key perimeter; no per-client scopes yet. Never say "secure" without that scope. | `SECURITY.md` §Trust model |
| Collector | Experimental; far less adversarial testing than the core. Always say so when the collector is mentioned. | `SECURITY.md` §The collector |
| Test coverage | About 60% of lines; tool handlers and dashboard JS have gaps | `README.md` §Known Limitations |
| Hosted scaling | Single writer (`max-instances 1`) on the reference deploy | `README.md` §Known Limitations |
| Performance / benchmarks | No published numbers. The retrieval eval harness exists (`mcp-server/eval/`) but quote no figures from it until results are published in the repo. | `mcp-server/eval/README.md` |
| "Production-ready", "enterprise", "battle-tested" | Not claimed. Use "early public release". | `README.md` (status note) |

## Roadmap (state as "planned", never as shipped)

From `README.md` §Roadmap:

- `server.json` + listing in the official MCP Registry; Docker MCP Catalog
- Raise tool-handler and dashboard-JS coverage
- Per-client API keys / scoped tokens
- Move the derived index off FUSE so hosted instances can scale past one writer
