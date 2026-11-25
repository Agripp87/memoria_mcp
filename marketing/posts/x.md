# X

A launch thread and six follow-up posts. Every post is under 280 characters
with its link counted (X counts any URL as 23). Attach the named image from
[../images/](../images/), or the video where it says so. Posts with a video or
image travel much further than text alone. Upload the video file itself: a
link to it on GitHub will not play in the feed.

Put the repository link in the first post's reply chain and not only at the
end: most people never reach the last post of a thread.

## Launch thread

Post on launch day, about two hours after the Show HN. Pin it.

**1/** *(attach `video/demo-30s.mp4`, the 30-second cut with narration)*

```
I use Claude Code all day on two machines and got tired of re-explaining Monday's decisions on Thursday.

So I built Memoria: long-term memory for Claude, stored as a Markdown repo you own.

Open source, two commands to install.
```

**2/** *(attach `card-own.png`)*

```
Every memory is a .md file with YAML frontmatter in ~/.memoria.

Grep it. Edit it. Delete it. Commit it.

The search index is SQLite, and it is derived: remove it and it rebuilds from the files.
```

**3/** *(attach `card-sync.png`)*

```
Sync is git. No service.

Daily logs are append-only, so one .gitattributes line sets merge=union on them. Two machines writing the same day merge with no conflict.

The plugin wires the pull and push into SessionStart and Stop hooks.
```

**4/** *(attach `card-everywhere.png`)*

```
One store, every Claude.

stdio for Claude Code. OAuth 2.1 over HTTP for claude.ai, as a custom connector.

A decision I record in the terminal is there when I open a chat on my phone.
```

**5/** *(attach `card-search.png`)*

```
Search is hybrid: local embeddings + BM25 keywords. Nothing leaves your machine by default.

The eval is in the repo. 83.7 nDCG@10 on a synthetic set vs 67.3 for keywords alone, with the caveats written next to the number.
```

**6/** *(attach `card-install.png`)*

```
In Claude Code:

/plugin marketplace add Agripp87/memoria_mcp
/plugin install memoria@memoria

Apache-2.0. Solo project, used daily since spring. The README has a Known Limitations section and I meant it.

https://github.com/Agripp87/memoria_mcp
```

**7/** *(attach `card-dashboard.png`)*

```
No install needed to look around. The dashboard runs on fake data here (key: memoria-demo):

https://memoria-demo-hpb4luig7q-uc.a.run.app/dashboard

Tell me what breaks.
```

**8/** *(optional; attach `video/demo.mp4`, the full 84 seconds)*

```
The longer version of the demo follows one decision from a laptop to a desktop: the Stop hook pushes, the SessionStart hook pulls, and a new session on the other machine already knows.

Then four views of the dashboard.
```

## Follow-up posts

One every few days after launch, per the calendar in [../PLAN.md](../PLAN.md).
Each stands alone, so someone who missed the thread still gets the idea.

**A. Union merge** *(L+5, `card-sync.png`; its entries are from a real two-machine run)*

```
A git trick I wish I had known sooner:

memories/daily/*.md merge=union

For an append-only file, a same-day conflict has a mechanical answer: keep both sides. Git ships that merge driver. One line and two machines never clobber each other's log.
```

**B. The eval** *(L+9, `card-search.png`)*

```
I picked my memory server's ranking weights by hand. Then I built an eval.

They lost to plain relevance by a wide margin, and "recency" was a constant because of a bug.

Wrote up what the numbers do and do not show:
[link to the eval post]
```

**C. Dashboard** *(L+12, `card-dashboard.png`)*

```
Memoria's store is plain Markdown, so the dashboard can render it as a wiki: related links, backlinks, a calendar of daily logs.

Useful for the question every memory tool should answer: what does it think it knows about me?
```

**D. claude.ai connector** *(L+16, `card-everywhere.png`)*

```
Memoria over HTTP speaks OAuth 2.1 with PKCE and dynamic client registration, so claude.ai takes it as a custom connector.

Same Markdown store as Claude Code. Self-hosted with docker compose; put your own TLS in front.
```

**E. Local embeddings** *(any gap)*

```
Small design decision I would defend: setting OPENAI_API_KEY does not make Memoria send your notes to OpenAI.

Embeddings are local (MiniLM, ~23 MB). Remote ones need an explicit MEMORIA_EMBEDDINGS=openai. An API key in your env is not consent.
```

**F. Limitations** *(any gap)*

```
The most useful section of the Memoria README might be "Known Limitations".

Single static key. One writer per store. ~60% line coverage. Adapters tested against fakes, not live accounts.

If a tool will hold your memory, you should know where it is thin.
```

## Replies and quote posts

- When someone posts "how do you handle memory in Claude Code?", answer the
  question first and mention Memoria in one sentence at the end. A reply that
  is only a link reads as spam.
- Quote-post people who build something on it or file a good bug, and thank
  them by name.
- Tags: none in the body. If you tag anyone, tag once, in a reply.
