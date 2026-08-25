# Changelog

All notable changes to Memoria are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Memoria is pre-1.0: the memory **file format** is stable and treated as such
(your Markdown will keep working), but env-var names, HTTP endpoints and tool
signatures may still change in a minor release. Anything that would break an
existing store gets a migration note here.

## [Unreleased]

Nothing yet.

## [0.1.0] — 2026-08-25

First public release. The server had been running as the maintainer's daily
driver since spring 2026; this release is the extraction of that work into a
clean, public repository. Development history before this point lives in a
private repo that cannot be published — it is a memory store, not just code —
so the public history starts here.

### Added

- **MCP server** with two transports: stdio for Claude Code, and Streamable
  HTTP/SSE with full OAuth 2.1 (authorization code + mandatory PKCE S256,
  client credentials, RFC 7591 dynamic registration, RFC 8414/9728 discovery)
  for claude.ai and other remote clients.
- **17 MCP tools** — search, read, write with write-time dedup, list, index
  rebuild, daily logs, optimize, reflect, stats, lint, compile, compact, entity
  compilation, and four collector controls.
- **Hybrid retrieval**: `0.2 × recency + 0.3 × importance + 0.5 × relevance`,
  where relevance is `0.7 × vector cosine + 0.3 × FTS5 BM25`. Three embedding
  providers auto-selected: OpenAI `text-embedding-3-small` → local
  `all-MiniLM-L6-v2` (offline) → n-gram hashing. Scan coverage is always
  reported, so partial scans are never silent.
- **Sub-memory collector** (experimental) with adapters for iMessage, macOS
  Calendar, IMAP, Gmail, Google Calendar, Google Drive and user-defined custom
  sources; consent gating, privacy tiers, AES-256-GCM encryption at rest, a
  ring buffer with backpressure, and no-silent-loss ingestion guarantees.
- **Web dashboard** with a cross-linked wiki view, journal, memory browser and
  source management, behind an httpOnly session cookie.
- **Claude Code plugin** — `/plugin marketplace add Agripp87/memoria_mcp` then
  `/plugin install memoria@memoria` registers the MCP server and the sync
  hooks. First launch bootstraps its own dependencies.
- **Multi-device sync** (`scripts/sync/`): fail-soft pull/push hooks for any
  git remote, with an optional object-storage mirror hook. Same-day daily-log
  conflicts resolve themselves via git's built-in `union` merge driver, enabled
  by the `.gitattributes` in `store-template/`.
- **Deployment**: multi-stage Docker image (non-root, pre-baked embedding
  model), `docker-compose.yml`, and a reference Cloud Run + GCS FUSE template
  under `deploy/gcp/` with CI/CD and auto-rollback.
- **Python `/ingest` client** (`integrations/orchestrator_hook.py`) for pushing
  events from external agent systems.
- 248 tests with per-file coverage floors, running on Ubuntu and Windows;
  ESLint, Prettier, shellcheck and a full-history gitleaks scan in CI.

### Security

- Documented the trust model honestly in [SECURITY.md](SECURITY.md): Memoria is
  single-tenant, `/authorize` auto-approves (the client secret is what actually
  gates access), and in every shipped network deployment a single static bearer
  key is the only access control. Read it before exposing an instance.
- The collector is shipped but labelled **experimental** — it is the most
  personal-data-sensitive and least adversarially tested surface.

### Notes

- Package names: `@memoria/mcp` on npm (publish pending), `memoria-mcp`
  reserved on PyPI.
- Known limitations — single static key, partial coverage of the tool handlers
  and dashboard JS, no staging environment, and a single-writer scaling ceiling
  from the SQLite index living on a FUSE mount — are listed in the
  [README](README.md#known-limitations) rather than glossed over.

[Unreleased]: https://github.com/Agripp87/memoria_mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Agripp87/memoria_mcp/releases/tag/v0.1.0
