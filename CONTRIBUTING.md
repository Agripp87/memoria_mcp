# Contributing to Memoria

Thanks for your interest. Memoria is maintained by one person in spare time, so
this file is mostly about setting expectations honestly and making it easy for a
PR to be merged without a long back-and-forth.

## Expectations

- **Review is asynchronous.** Issues and PRs get a response, but it may take a
  week. A PR that sits is not being ignored.
- **Open an issue before a large change.** Anything that adds a dependency,
  changes the memory file format, alters the search scoring, or touches the auth
  surface should start as an issue so we can agree on direction before you spend
  an evening on it. Small fixes can go straight to a PR.
- **Questions belong in [Discussions](https://github.com/Agripp87/memoria_mcp/discussions)**,
  not issues. Issues are for bugs and concrete proposals.
- **Security issues never go in a public issue.** See [SECURITY.md](SECURITY.md).

## Never include personal data

This is the one hard rule. Memoria's whole subject matter is somebody's private
memory, which makes it unusually easy to paste something you did not mean to
share.

- No real memory files, daily logs, `MEMORY_INDEX.md` contents, API keys,
  bearer tokens, refresh tokens, or personal identifiers in issues, PRs, test
  fixtures, screenshots or commit messages.
- Redact hostnames and URLs of your own deployment.
- Need realistic data for a repro or a fixture? Generate it:
  ```bash
  cd mcp-server && npm run demo:gen -- --out /tmp/store
  ```
  This writes ~29 cross-linked fake memories (an "Alex Rivera" persona) with no
  connection to anyone real.
- CI runs [gitleaks](https://github.com/gitleaks/gitleaks) over the full history
  on every push and PR, and GitHub push protection is on. If a scan blocks you,
  do not work around it — rotate whatever leaked first.

## Development setup

```bash
git clone https://github.com/Agripp87/memoria_mcp.git
cd memoria_mcp/mcp-server
npm install
npm run build
npm test
```

Node 18+ is required; CI builds on Node 22 (matching the Docker image) on both
Ubuntu and Windows. `better-sqlite3` is a native module, so a first install
needs a working toolchain (build-essential / Xcode CLT / MSVC Build Tools).

Useful commands, all from `mcp-server/`:

| Command | What it does |
|---------|--------------|
| `npm test` | Full Vitest suite (248 tests, no network or API keys needed) |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Suite + the coverage floors CI enforces |
| `npm run lint` | ESLint |
| `npm run format` | Prettier, write mode |
| `npm run format:check` | Prettier, check mode (what CI runs) |
| `npm run demo` | Build, generate a throwaway store, serve the dashboard on `:3110` |
| `npm run build` | `tsc` |

Point `MEMORIA_DIR` at a scratch directory while developing so you never touch a
real store:

```bash
MEMORIA_DIR=/tmp/memoria-dev node dist/http.js
```

## Before you open a PR

1. **`npm test` is green** and you added tests for behavior you changed. The
   coverage floors in `vitest.config.ts` are per-file and CI fails on a
   regression — raise them if your change lifts coverage, never lower them.
2. **`npm run lint` and `npm run format:check` are clean.**
3. **`npm run build` succeeds** (TypeScript is `strict`; no `any` smuggling and
   no `@ts-ignore` without a comment explaining why).
4. **Shell scripts pass `shellcheck --severity=warning`.**
5. **Commits are signed off** — see below.
6. Docs updated if you changed behavior: the env-var table, the tool table and
   `SECURITY.md` are the three that go stale fastest. User-visible changes get
   a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).

## Sign-off (DCO)

Contributions are accepted under the
[Developer Certificate of Origin](https://developercertificate.org/). It is a
short statement that you wrote the patch or otherwise have the right to submit
it under the project's licence. Certify it by signing off each commit:

```bash
git commit -s -m "Your message"
```

which appends `Signed-off-by: Your Name <your@email>`. Forgot on the last
commit? `git commit --amend -s`. On a branch? `git rebase --signoff main`.

There is no separate CLA. The project is Apache-2.0 and contributions are
licensed the same way.

## Code conventions

- **TypeScript, ESM, Node 18+ APIs.** `type: "module"`, `Node16` resolution —
  relative imports need the `.js` extension.
- **Comments explain *why*.** The codebase's convention is a short paragraph
  above non-obvious code describing the failure it prevents (often with the date
  and the incident). Keep that up — it is the most useful documentation here.
- **Markdown files are the source of truth.** The SQLite index is derived and
  must stay fully rebuildable from the files. Any change that makes the DB
  authoritative for something will be rejected.
- **Fail soft on the sync/collector path, fail loud on the auth path.** A
  collector adapter that throws must not take down ingestion; an auth check that
  cannot be evaluated must deny.
- **No silent data loss.** Events are only marked synced once durably handled;
  daily logs are append-only. If your change can drop a user's entry, it needs a
  test proving it does not.

## Security-sensitive areas

Changes here get a slower, closer review — that is not distrust, it is the blast
radius:

`src/http.ts` (auth, OAuth, rate limits) · `src/collector/crypto.ts` ·
`src/collector/registry.ts` (consent, shell sources) ·
`src/collector/ingestion.ts` (privacy tiers, redaction) · path resolution in
`src/tools.ts` · `src/wiki.ts` (HTML escaping).

## Releasing (maintainer)

1. `npm test && npm run build && npm run lint && npm run format:check`
2. Bump `mcp-server/package.json` and move the `[Unreleased]` section of
   [CHANGELOG.md](CHANGELOG.md) into a dated version heading
3. Tag `vX.Y.Z`, push, let CI go green
4. `npm publish --access public` from `mcp-server/` (`prepublishOnly` builds)
