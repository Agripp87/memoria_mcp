<!--
Launch post. Publish two days before launch on dev.to or your own blog, so the
Show HN and Reddit threads can link to it.

dev.to front matter:
  title: I keep Claude's memory in a git repo
  tags: claude, mcp, opensource, ai
  cover_image: marketing/images/launch.png (upload it)
  canonical_url: set this if you also publish on your own site

About 1,100 words. Sentences marked [yours] describe your own experience in
words I guessed at from the README. Rewrite them so they are true.
-->

# I keep Claude's memory in a git repo

I use Claude Code for most of my working day, on a laptop and a desktop. For a
long time the sessions had one thing in common: each began knowing nothing
about the one before. [yours] On Monday we would settle on Postgres over Mongo
and write down why. On Thursday, in a new session, the same question came back
as if it had never been asked.

A `CLAUDE.md` file helps, and I still use one. But it is loaded whole into
every session, so it has to stay short. It holds standing instructions. It
cannot hold the long tail: the hundreds of small decisions, fixed bugs and
preferences that matter once every few weeks.

So I built a memory for it. It is called
[Memoria](https://github.com/Agripp87/memoria_mcp), it is open source, and I
have used it daily since spring. This post is about the one decision that
shaped everything else: the memory is a folder of Markdown files.

## What it is

Memoria is an [MCP](https://modelcontextprotocol.io) server. Claude calls its
tools to search, read and write memories. A memory looks like this:

```markdown
---
name: Postgres over Mongo
description: Chose Postgres for Atlas API
type: decision
importance: 6
tags: [architecture, database]
related: [project/atlas-api.md]
---

Needed relational integrity for shared notebooks and sync cursors.
Mongo's flexible schema wasn't worth losing transactions and joins.
```

That file lives at `~/.memoria/memories/decisions/postgres-over-mongo.md`.
Next to the files sits a SQLite database with a full-text index and
embeddings, used for search. The database is derived. If I delete it, the
server rebuilds it from the files.

## Why files

Most memory layers I looked at put a database in the middle and give you an
API to it. That is the right design if you are building memory into a product
with many users. For one person's assistant I wanted different properties.

**I can read it.** A memory tool is making claims about me and my projects. I
want to open the folder and see what they are. When the model has written
something wrong, I fix it in an editor.

**It outlives the tool.** If I stop using Memoria, I still have a folder of
notes that any editor and any future tool can read.

**Git already solves sync.** This is the part I enjoyed most.

## Sync without a service

To use the same memory on two machines, I made the folder a private git
repository. The plugin adds two Claude Code hooks: pull when a session starts,
commit and push when it stops.

The obvious problem is conflicts. Two machines appending to the same day's log
is the normal case, and a normal git merge would stop and ask me to resolve
it.

For an append-only file, though, the resolution is mechanical: keep both
sides. Git ships a merge driver that does exactly that. One line in the
store's `.gitattributes` turns it on:

```gitattributes
memories/daily/*.md merge=union
```

Same-day entries from two machines now merge silently and none are lost.
Curated notes, the ones that get edited and not appended to, keep the normal
three-way merge on purpose. If both machines changed the same decision, that
is a real disagreement and I should look at it.

There is no sync server and nothing to pay for.

## One memory for every Claude

The server speaks MCP two ways. Claude Code talks to it over stdio. For
claude.ai it runs over HTTP and implements OAuth 2.1 (authorization code with
PKCE, dynamic client registration), which is what claude.ai needs to add it as
a custom connector.

Both read and write the same folder. [yours] A decision I record in a terminal
session is something I can ask about from a chat on my phone.

The remote side takes real setup: a Docker container somewhere reachable, with
TLS in front. The local side takes two commands.

## Search, and being honest about it

Retrieval combines embeddings with keyword search (SQLite's FTS5, BM25
ranking). Embeddings catch a reworded question. Keywords catch the exact
things embeddings blur: a ticket number, an error string, a name.

The embeddings are computed locally with a small model, a one-time download of
about 23 MB. Nothing is sent to a remote API unless you explicitly choose the
OpenAI provider. Having an OpenAI key in your environment does not switch it
on.

I picked the first ranking weights by hand and later built an eval to check
them. They were wrong, in a way I would not have found by using the tool. That
story has [its own post](LINK-TO-EVAL-POST). The short version: the current
default scores 83.7 nDCG@10 on a 175-document synthetic set, keyword search
alone scores 67.3, and the
[eval write-up](https://github.com/Agripp87/memoria_mcp/blob/main/mcp-server/eval/README.md)
spends as many words on what that does not prove as on what it does.

## Keeping it tidy

A memory that only grows becomes noise. Memoria has tools the agent calls to
keep the store in shape: a check before each write that returns the three most
similar existing memories, so Claude updates a note where it would otherwise
create a near-copy; a lint that looks for contradictions, orphans and stale
cross-references; and importance scores that decay for memories nobody reads.

Most of this runs when Claude calls it, following an instruction in
`CLAUDE.md`. It is not a background intelligence, and the README says so.

## What it is not

- **Not multi-user.** It is single-tenant, for your own assistant. If you are
  building memory into an app, this is the wrong tool.
- **Not finished.** The README has a
  [Known Limitations](https://github.com/Agripp87/memoria_mcp#known-limitations)
  section: one static key as the perimeter, one writer per store, test
  coverage around 60% of lines.
- **Not a replacement for `CLAUDE.md`.** They do different jobs.

There is also a collector that can pull email, calendar events and messages
into memory. It ships, it is off by default, and I consider it experimental.
Read
[SECURITY.md](https://github.com/Agripp87/memoria_mcp/blob/main/SECURITY.md)
before enabling it.

## Try it

In Claude Code:

```
/plugin marketplace add Agripp87/memoria_mcp
/plugin install memoria@memoria
```

The first start builds from source and takes about a minute. Then add a line
to your `CLAUDE.md` so Claude knows when to use it:

> At session start, `memory_search` for context relevant to the task. Record
> decisions, solved bugs and preferences with `memory_daily` during the
> session, `memory_write` for durable facts. Do not capture transactional
> work.

To look around without installing anything, the dashboard runs on generated
fake data at
[memoria-demo-hpb4luig7q-uc.a.run.app/dashboard](https://memoria-demo-hpb4luig7q-uc.a.run.app/dashboard)
(key: `memoria-demo`).

The code is at
[github.com/Agripp87/memoria_mcp](https://github.com/Agripp87/memoria_mcp)
under Apache-2.0. It is a solo project, so reviews are asynchronous, and
issues are welcome, especially the ones that start with "this broke on my
machine".
