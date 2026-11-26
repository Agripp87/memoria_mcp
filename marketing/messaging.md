# Messaging

The source for every post in this directory. If a post and this file disagree,
this file is right and the post needs fixing.

## Positioning

**For** developers who use Claude Code every day
**who** are tired of re-explaining decisions to a fresh session,
**Memoria is** an open-source MCP memory server
**that** stores what Claude learns as Markdown files in a folder you own.
**Unlike** hosted memory layers, there is no service to sign up for and no
format to export from: the files are the database, git is the sync, and the
search index can be deleted and rebuilt.

## One-liners

The canonical description, already used on npm, the plugin, the marketplace
entry and the MCP Registry (a test keeps them identical, so do not reword it
there):

> Persistent, plain-text memory for Claude — as a Markdown repo you own.

Taglines for posts and images, in order of preference:

1. **A memory you can `git diff`.**
2. Long-term memory for Claude, as a Markdown repo you own.
3. Your memory is a folder.
4. One memory. Every Claude.
5. Sync is git.

Short description (about 25 words), for directories and bios:

> Memoria is an open-source MCP server that gives Claude Code and claude.ai a
> shared long-term memory, stored as Markdown files you own and sync with git.

Medium description (about 60 words):

> Memoria is an open-source MCP server that gives Claude Code, claude.ai and
> other MCP clients one shared long-term memory. Memories are Markdown files
> with YAML frontmatter in a directory you control. A derived SQLite index
> provides hybrid semantic and keyword search with local embeddings, and the
> store syncs across machines with plain git. Apache-2.0, installs as a Claude
> Code plugin in two commands.

## The five messages

Each has a plain claim, the evidence, and where the evidence lives. Do not
make the claim without being able to point at the evidence.

### 1. You own it

Memories are Markdown files with YAML frontmatter under `~/.memoria/memories/`.
You can grep them, edit them in any editor, and commit them. The SQLite index
is derived: delete it and it rebuilds from the files. There is no account and
no hosted database.

*Evidence:* README "Memory File Format" and "Design Decisions"; `memory_index`
rebuilds the index; Apache-2.0 license.

### 2. One memory, every Claude

The same store serves Claude Code over stdio and claude.ai over HTTP with
OAuth 2.1 (authorization code with PKCE, dynamic client registration, metadata
discovery). A decision recorded in a terminal session can be found from a
claude.ai chat. Other MCP clients work too; Cursor has a tested config.

*Evidence:* README "Remote access" section; `docs/clients.md`.

*Limit to state when asked:* the remote path means running the HTTP server
somewhere reachable (Docker, or the Cloud Run template). It is not one click.

### 3. Sync without a service

The store is a git repository. Daily logs are append-only, so one line in
`.gitattributes` (`memories/daily/*.md merge=union`) tells git to keep both
sides when two machines write on the same day. The plugin wires a SessionStart
pull and a Stop push. Curated memories keep the normal three-way merge, because
a both-sides edit there is a real disagreement.

*Evidence:* `scripts/sync/README.md`, `store-template/.gitattributes`,
`hooks/hooks.json`.

*Limit:* union merge keeps every entry but does not sort them by time.

### 4. Search that is measured

Retrieval is hybrid: 0.7 vector cosine plus 0.3 BM25 keyword score, with small
recency and importance priors (`0.8·relevance + 0.1·recency + 0.1·importance`).
Embeddings are local by default (all-MiniLM-L6-v2, a one-time download of
about 23 MB); nothing is sent to a remote embedding API unless
`MEMORIA_EMBEDDINGS=openai` is set. The retrieval eval is in the repo and
every search result reports how many chunks were scanned.

*Evidence:* `mcp-server/eval/README.md`. The shipped default scores 83.7
nDCG@10 on 175 documents and 144 queries; keyword-only scores 67.3 and
vector-only 83.0.

*Limits to state every time the number is used:* the corpus is synthetic, and
the recency and importance weights could not be validated on it.

### 5. Two commands to try

```
/plugin marketplace add Agripp87/memoria_mcp
/plugin install memoria@memoria
```

The first start installs dependencies and builds, which takes about a minute.
Or without installing anything: the hosted demo at
<https://memoria-demo-hpb4luig7q-uc.a.run.app/dashboard> (key `memoria-demo`)
runs on generated fake data.

*Evidence:* README "Quick Start".

## Supporting facts

Safe to quote. Each is in the README or CHANGELOG as of 0.3.2.

| Fact | Source |
|------|--------|
| 17 MCP tools: 13 core memory tools, 4 collector tools | README "MCP Tools" |
| Runs as the maintainer's daily driver since spring 2026 | README status note |
| Two adversarial security reviews and a full code review | README status note |
| CI runs the test suite on Ubuntu and Windows | README status note |
| Node 20 or newer | README "Prerequisites" |
| Write-time dedup checks the three most similar memories before a write | README "Features" |
| `memory_lint` checks contradictions, orphans, stale cross-references and index drift | README "MCP Tools" |
| Collector data is encrypted with AES-256-GCM | README "Encryption" |
| Collector consent can only be granted in the dashboard, never through MCP | README "Recent updates" |
| Daily-log queries went from 52.2 to 88.7 nDCG@10 (priors off) when logs were indexed one entry per chunk | `mcp-server/eval/README.md` |
| A search over 5,000 chunks took 65 ms on the development machine | `mcp-server/eval/README.md` |
| npm releases are published from GitHub Actions with signed provenance | README "Roadmap" |
| Listed in the official MCP Registry as `io.github.Agripp87/memoria-mcp` | README "Roadmap" |

## Do not say

- **"The best" / "the fastest" / "state of the art."** Nothing here was
  benchmarked against another memory server.
- **A user count, a star count, or any testimonial** until one exists and the
  person has agreed to be quoted.
- **"Works with every MCP client."** Claude Code, claude.ai and Cursor are
  tested. Say "any MCP client should work; these three are tested."
- **"Secure" as a bare adjective.** Say what was done (two reviews, the
  specific hardening) and link `SECURITY.md`. The trust model is single-tenant
  with one static key, and the README says so.
- **"Autonomous memory."** Most maintenance runs when the agent calls a tool.
  The background passes are opt-in. The README is careful about this and the
  posts should be too.
- **"Reads your email and messages"** as a headline. The collector is
  experimental and off by default. Mention it as an option, with that label.
- **Anything about how Anthropic's own memory features work** beyond what you
  have checked on the day you post. Those change, and a wrong claim about them
  becomes the whole comment thread.

## Voice

Write the way the README does.

- First person singular. It is one person's project and that is an asset.
- Specific over impressive: "65 ms over 5,000 chunks" and not "blazing fast".
- State the limit next to the claim. The "Known Limitations" section earns
  more trust with this audience than any feature list.
- No exclamation marks, no emoji in prose, no "excited to announce".
- Code blocks for anything a reader might type.

## Objections and honest answers

Paste-ready replies. Adjust the wording so it does not read as canned.

**"Claude already has memory."**
> It does, and it is good. Claude Code's auto memory is Markdown files too,
> kept per repository on the machine you are working on. claude.ai has its
> own memory, organised by topic, that you can view and edit in settings. As
> far as I can tell from the docs, those two do not share anything, and
> neither follows you to another machine as files.
>
> Memoria is for that gap: one store across all your repos, your machines and
> your clients (Claude Code, claude.ai, Cursor), with search over the whole
> thing and git for sync. If you work in one repo on one machine, the
> built-in memory is probably all you need. There is a script that imports
> Claude Code's auto memory (`scripts/sync-from-claude-memory.sh`) if you
> want to try both.

*Checked on 25 November 2026 against the Claude Code memory docs and the
claude.ai memory help article. What they say: auto memory is on by default in
local sessions, lives under `~/.claude/projects/<project>/memory/` as a
`MEMORY.md` index plus topic files, is scoped per repository, and loads the
first 200 lines or 25 KB of the index at session start. claude.ai memory is on
by default on Free, Pro and Max, is stored as topics with a separate memory
per project, and is included in data exports. Neither page says the two are
shared, or that either is available to other MCP clients. Do not claim "files
you can read" as a difference: both built-ins are readable and editable.
Re-check before any later post; these features change.*

**"Why not just use CLAUDE.md?"**
> I still do, for standing instructions. CLAUDE.md is loaded whole into every
> session, so it has to stay short. Memoria is for the long tail: hundreds of
> decisions and notes that are searched when relevant and never loaded
> otherwise.

**"Why not Mem0 / Zep / Letta?"**
> Those are good and Memoria borrows ideas from that line of work. They are
> built as services with a database behind them. I wanted the opposite
> trade: files as the source of truth, nothing to host for local use, and a
> store I can read without the tool. If you need multi-user memory for an app
> you are building, use one of those. Memoria is single-tenant, for your own
> Claude.

**"Why Markdown and not a real database?"**
> There is a real database: SQLite with FTS5 and vectors. It is derived. The
> files are the source of truth so that the store survives the tool, diffs in
> git, and can be fixed by hand when the model writes something wrong.

**"Does my data leave my machine?"**
> Not by default. Embeddings are computed locally. OpenAI embeddings exist as
> an option and need an explicit `MEMORIA_EMBEDDINGS=openai`; setting an
> OpenAI key alone does not turn them on.

**"Is the search any good?"**
> 83.7 nDCG@10 on a 175-document synthetic eval that is in the repo, against
> 67.3 for keywords alone. Synthetic is the important word: it tells me the
> weights are not broken, not how it does on your notes. The eval write-up
> lists what it does not show.

**"How does it scale?"**
> Past 5,000 chunks the vector scan samples the store and tells you it did,
> in the result. It is built for one person's memory, not a team's. The
> hosted template is limited to one instance, and the README explains why.

**"What about prompt injection, if it ingests email?"**
> The collector is experimental and off by default. Consent for a source can
> only be given in the dashboard, and an MCP caller can change a source's
> schedule and nothing else, so an injected agent cannot enable a source or
> redirect one. `SECURITY.md` has the trust model. I would not turn on email
> ingestion without reading it.

**"Solo project. Will it be maintained?"**
> I use it every day, so it gets fixed when it breaks for me. The file format
> is treated as stable. If I stopped tomorrow you would still have a folder of
> Markdown.

**"Why is the first start slow?"**
> The plugin installs dependencies and compiles on first launch, and
> `better-sqlite3` is a native module. It is about a minute once. The npm
> package ships prebuilt JavaScript if you would rather skip the build.
