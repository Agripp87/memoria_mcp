# Reddit

Four posts for four subreddits, each written for that subreddit. Do not
cross-post one text: moderators and readers both notice.

Before each post, read the subreddit's rules on self-promotion (some require a
flair, some allow project posts only on certain days). Reply to every comment
in the first day.

What to attach, where the subreddit allows media:

| Subreddit | Attach |
|-----------|--------|
| r/ClaudeAI | `video/demo-30s.mp4` |
| r/ClaudeCode | `video/demo.mp4` (the full cut shows the hooks and the sync) |
| r/mcp | `images/card-everywhere.png` |
| r/selfhosted | `images/card-dashboard.png`, or the four screenshots in `docs/images/dashboard-*.png` as a gallery |

A video post on Reddit cannot also carry a long text body in every subreddit.
Where it cannot, post the video with the title and put the body in the first
comment.

---

## r/ClaudeAI

Post on launch day, about three hours after the Show HN.

**Title:** I got tired of re-explaining things to Claude Code, so I built a
memory it shares with claude.ai (open source, plain Markdown)

**Body:**

I use Claude Code most of the day on two machines. The thing that wore me down
was not any single session, it was Thursday's session not knowing what
Monday's had decided. And nothing I worked out in the terminal was there when
I opened claude.ai on my phone.

So I built Memoria. It is an MCP server that gives Claude a long-term memory,
and the memory is a folder of Markdown files on your disk.

What that looks like in use:

- At the start of a session Claude searches the store for what is relevant to
  the task. During it, decisions and solved bugs go into a daily log, and
  durable facts into their own notes.
- The same store is available to claude.ai as a custom connector, so a
  decision made in the terminal can be found from a chat.
- Every memory is a `.md` file. You can open it, fix it, delete it, or grep
  the whole folder.
- To have it on a second machine you put the folder in a private git repo.
  Same-day entries from two machines merge without conflicts.
- Search is semantic plus keyword, and the embeddings run locally. Nothing is
  sent anywhere unless you opt in.

Install, in Claude Code:

```
/plugin marketplace add Agripp87/memoria_mcp
/plugin install memoria@memoria
```

The first start takes about a minute because it builds. After that, add a line
to your CLAUDE.md telling Claude when to search and when to write. The README
has the one I use.

If you would rather look before installing, there is a demo dashboard on fake
data: https://memoria-demo-hpb4luig7q-uc.a.run.app/dashboard (key:
`memoria-demo`)

How it differs from the built-in memory: Claude Code's auto memory is kept per
repository on one machine, and claude.ai has a separate memory of its own.
Memoria is one store across all your repos, machines and clients, with search
over the whole thing. If you work in one repo on one machine, the built-in
memory is probably all you need.

What it is not: it does not replace CLAUDE.md, which I still use for standing
instructions. And the claude.ai side needs the server running somewhere
reachable, which is a Docker container and not a single click.

Repo: https://github.com/Agripp87/memoria_mcp (Apache-2.0)

It is a solo project and I have used it daily since spring. I would like to
know what you would want it to remember that it does not.

---

## r/ClaudeCode

Post the day after launch. This audience wants the mechanics.

**Title:** Memoria: a Claude Code plugin that keeps memory as Markdown and
syncs it with git via SessionStart/Stop hooks

**Body:**

Sharing a plugin I have been running daily since spring. It adds an MCP memory
server and two hooks.

**What the plugin sets up**

- An MCP server with 17 tools. The ones Claude uses most: `memory_search`,
  `memory_write`, `memory_daily` (append to today's log) and `memory_read`.
- A `SessionStart` hook that pulls the store if it is a git repo, and a `Stop`
  hook that commits and pushes. Both fail soft: offline or no remote, they log
  a line and the session carries on. The push is rate-limited so `Stop` does
  not hit the network every turn.

**Where the memory lives**

`~/.memoria/memories/`, as Markdown with frontmatter:

```markdown
---
name: Postgres over Mongo
type: decision
importance: 6
related: [project/atlas-api.md]
---
Needed relational integrity for shared notebooks and sync cursors.
```

A SQLite index next to it does hybrid search (local MiniLM vectors plus FTS5
BM25). The index is derived and rebuilds from the files.

**Things I think are worth stealing even if you do not use it**

- `merge=union` in `.gitattributes` for append-only logs. Two machines writing
  the same daily file merge cleanly, with no conflict markers.
- Several Claude Code windows can share one store. The first server takes a
  lock and runs background work; the others read and write as secondaries and
  take over when it exits.
- Write-time dedup: `memory_write` returns the three most similar existing
  memories before it writes, so the agent updates a note and does not create a
  near-copy.

**Install**

```
/plugin marketplace add Agripp87/memoria_mcp
/plugin install memoria@memoria
```

Or without the hooks:

```bash
claude mcp add memoria -s user -- npx -y @agrippa87/memoria-mcp
```

Then tell Claude how to use it in CLAUDE.md, for example: *"At session start,
`memory_search` for context relevant to the task. Record decisions, solved
bugs and preferences with `memory_daily` during the session, `memory_write`
for durable facts. Do not capture transactional work."*

If you already have Claude Code auto-memory you want to keep,
`scripts/sync-from-claude-memory.sh` copies it into the store (`--dry-run`
shows what it would do).

Known rough edges: the first start builds from source and takes a minute, and
on Windows a stale store lock can need deleting by hand. The README lists the
rest under "Known Limitations".

Repo: https://github.com/Agripp87/memoria_mcp

What does your CLAUDE.md memory instruction look like? Mine took a few rounds
to stop Claude logging every trivial step.

---

## r/mcp

Post the day after launch. This audience builds servers.

**Title:** Notes from building an MCP memory server: OAuth 2.1 for claude.ai,
a store lock for multi-session stdio, and a retrieval eval

**Body:**

I have been building Memoria, an open-source MCP memory server (Markdown files
as the store, SQLite as a derived index). A few things I ran into that may be
useful to others writing servers:

**1. One stdio server per client window means several writers.** Every Claude
Code window and every Claude Desktop session starts its own process against
the same store. I ended up with a lock file: the first process is the primary
and runs the background work, later ones are secondaries that still read and
write, and one takes over when the primary exits. A stdio server also has to
exit when its client goes away, or it holds the lock for a session that is
gone.

**2. Remote transport that claude.ai accepts.** Streamable HTTP plus OAuth 2.1:
authorization code with PKCE, dynamic client registration and metadata
discovery. The detail that bit me was deriving the issuer URL from request
headers, which reflects whatever host an attacker sends into the discovery
document. It is pinned by a `MEMORIA_PUBLIC_URL` setting now, and the server
refuses to start on a public bind without it.

**3. Tools that an injected agent must not be able to call.** The server can
optionally ingest email and calendar events. Consent for a source can only be
given in the web dashboard, and through MCP only a source's schedule can be
changed, so a prompt-injected agent cannot enable a source or point a stored
credential at another host.

**4. Measure the ranking.** I shipped weights I had picked by hand. When I
built an eval they scored far below plain relevance. The eval, the sweeps and
the caveats are in `mcp-server/eval/`.

The tool surface is 17 tools; the core ones are `memory_search`,
`memory_read`, `memory_write`, `memory_daily`, `memory_list`, plus maintenance
tools (`memory_lint`, `memory_optimize`, `memory_compact`, `memory_entities`).

It is in the official MCP Registry as `io.github.Agripp87/memoria-mcp`, and on
npm:

```bash
npx -y @agrippa87/memoria-mcp
```

Repo: https://github.com/Agripp87/memoria_mcp (Apache-2.0)

I would like feedback on the tool design in particular. Seventeen is a lot,
and I am not sure the maintenance tools should all be separate.

---

## r/selfhosted

Post three days after launch. Lead with what runs on their box.

**Title:** Memoria: self-hosted long-term memory for Claude. Markdown files on
a volume, Docker Compose, OAuth 2.1, no external services

**Body:**

Memoria is an MCP server that gives Claude (Claude Code, claude.ai, other MCP
clients) a persistent memory. I built it to self-host, and these are the parts
this subreddit usually asks about:

- **Storage is a directory of Markdown files** on a volume you mount. The
  SQLite search index is derived and can be rebuilt from them. Backups are
  `tar`, or make the directory a git repo.
- **No external dependencies at runtime.** Embeddings are computed locally
  (all-MiniLM-L6-v2, baked into the image). There is an OpenAI embeddings
  option and it is off unless you explicitly select it.
- **Docker Compose included.** Multi-stage image, runs as a non-root user,
  publishes on loopback only. You put your own TLS in front (Caddy, a
  Cloudflare Tunnel, whatever you use).
- **Auth:** OAuth 2.1 (authorization code with PKCE) for claude.ai's custom
  connector, and a static bearer key for the API and dashboard. Tokens are
  stored hashed. Rate limits and body-size limits on every route.
- **A web dashboard** to browse memories as a wiki, with backlinks.
- **Apache-2.0**, no telemetry.

```bash
git clone https://github.com/Agripp87/memoria_mcp.git
cd memoria_mcp
cp .env.example .env    # fill in the three secrets and MEMORIA_PUBLIC_URL
docker compose up -d
curl http://localhost:3100/health
```

Then in claude.ai: Settings → Connectors → Add custom connector, with your
URL and the OAuth client secret.

The limits, stated up front:

- It is single-tenant. One static key is the perimeter; there are no per-user
  scopes yet (on the roadmap).
- One instance per store. The index is SQLite and does not tolerate two
  writers on a network mount.
- An optional collector can ingest IMAP, Gmail, calendar and iMessage into
  memory. It is experimental and off by default, and its data is encrypted at
  rest with AES-256-GCM. Read SECURITY.md before turning it on.

There is a live demo on fake data if you want to see the dashboard first:
https://memoria-demo-hpb4luig7q-uc.a.run.app/dashboard (key: `memoria-demo`)

Repo: https://github.com/Agripp87/memoria_mcp

Happy to answer questions about the deployment. There is also a Cloud Run
template in `deploy/gcp/` if that is your setup.
