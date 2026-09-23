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

## [0.2.0] — 2026-09-23

First release published to npm, as **`@agrippa87/memoria-mcp`**. The name
planned for 0.1.0, `@memoria/mcp`, turned out to be unavailable — the
`@memoria` npm organisation belongs to an unrelated project — so it was never
published. Do not install anything under `@memoria/*` expecting this project.

### Changed

- **Gentler default guidance to connected clients.** The server description and
  the `memory_daily` tool previously told every client that each session MUST
  write a daily log entry and that a session without one "is a failed session".
  That was the maintainer's own workflow, stated as a rule for everyone. Both
  now encourage logging what is worth keeping, and say routine sessions need no
  entry. If you want the stricter discipline, put it in your own instructions
  (a `CLAUDE.md`, a hook). The description is now defined once and shared by the
  stdio and HTTP servers, so the two cannot drift apart.
- **Requires Node 20 or newer.** `package.json` previously claimed Node 18, but
  `better-sqlite3` supports nothing older than 20, so an install on Node 18
  could not have worked. The declared range now tells the truth.
- Upgraded `js-yaml` 4 → 5, the library that reads and writes every memory
  file's frontmatter. **The file format is unchanged**: across 190 real
  frontmatter blocks, v5 parses to identical values and writes byte-identical
  YAML. Two things needed care. v5 has no default export, and under this
  project's TypeScript settings the old `import yaml from "js-yaml"` still
  compiled — then failed at link time in Node, which would have stopped the
  server starting. And v5's core schema stopped quoting `yes`, `no`, `on` and
  `off` on write; Memoria reads those correctly either way, but YAML 1.1 readers
  such as PyYAML would see booleans, so the write schema restores the quotes.
  A new round-trip test pins that every string written comes back identical.

### Security

- Replaced the unmaintained `@xenova/transformers` with its maintained
  successor `@huggingface/transformers` v3, and pinned `sharp` to a patched
  release. This clears all five open advisories — four high and one critical —
  which all descended from that one optional dependency's `onnx-proto` /
  `protobufjs` chain. `npm audit` now reports zero vulnerabilities.

### Fixed

- Pinned the local embedding model to its int8 weights (`dtype: "q8"`).
  transformers.js v3 changed the default to fp32 under the same model id, which
  would have shifted the vector space by cosine 0.993 — close enough to look
  correct, and invisible to the provider-change check, which keys on provider
  name and dimension. Existing stores would have silently mixed two vector
  spaces. Vectors are now byte-identical to every previously written index, and
  `npm run verify:vectors` guards that going forward.

### Added

- `scripts/verify-vector-space.mjs` and a committed reference-vector fixture:
  a regression guard asserting the local embedding provider still produces the
  same vectors. Run it whenever the embedding dependency, model id or dtype
  changes.
- CI now builds the Docker image and smoke-tests it against `/health`. Nothing
  previously exercised the Dockerfile, so a base-image or native-module break
  could reach `main` unverified.

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

- Package names: `memoria-mcp` reserved on PyPI. The npm name planned here,
  `@memoria/mcp`, was never published — that scope belongs to an unrelated
  project. See 0.2.0 for the real one.
- Known limitations — single static key, partial coverage of the tool handlers
  and dashboard JS, no staging environment, and a single-writer scaling ceiling
  from the SQLite index living on a FUSE mount — are listed in the
  [README](README.md#known-limitations) rather than glossed over.

[Unreleased]: https://github.com/Agripp87/memoria_mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Agripp87/memoria_mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Agripp87/memoria_mcp/releases/tag/v0.1.0
