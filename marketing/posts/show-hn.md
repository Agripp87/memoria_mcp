# Show HN

Post on launch day, morning US Eastern. Submit the repository URL, then add
the first comment yourself straight away. Stay in the thread for six hours.

Show HN rules worth remembering: the thing must be something people can try,
the title describes it without adjectives, and asking anyone to upvote gets
the post buried.

## Title

Pick one. All are under 80 characters.

1. `Show HN: Memoria – Claude's long-term memory as a Markdown repo you own`
2. `Show HN: Memoria – an MCP memory server where the database is a git repo`
3. `Show HN: Memoria – plain-text memory for Claude Code, synced with git`

The first is the default. Use the second if the week's front page is tired of
Claude posts: it leads with the design choice.

## URL

```
https://github.com/Agripp87/memoria_mcp
```

## First comment

> I use Claude Code most of the day, on two machines, and I got tired of
> re-explaining the same decisions to a fresh session. Memoria is what I built
> for that, and I have run it daily since spring.
>
> It is an MCP server. Memories are Markdown files with YAML frontmatter in a
> folder (`~/.memoria` by default). A SQLite index with FTS5 and vectors sits
> next to them for search, and it is derived: delete it and it rebuilds from
> the files.
>
> The choices that might be interesting here:
>
> **Files are the source of truth.** I wanted to be able to grep my own
> memory, fix it by hand when the model writes something wrong, and still have
> it if I stop using the tool.
>
> **Sync is git, with one trick.** Daily logs are append-only, so the store's
> `.gitattributes` sets `merge=union` on them. Two machines writing on the
> same day merge without a conflict. Curated notes keep the normal three-way
> merge, because a both-sides edit there is a real disagreement. There is no
> sync service.
>
> **The ranking weights are measured, and the write-up includes what went
> wrong.** The original weights gave recency and importance half the score. On
> the eval they lost badly to relevance alone, and recency turned out to be a
> constant because of a bug. The current default (0.8 relevance, 0.1 recency,
> 0.1 importance; relevance is 0.7 vector + 0.3 BM25) scores 83.7 nDCG@10 on a
> 175-document synthetic set, against 67.3 for keywords only. The eval README
> also says which weights that corpus cannot validate.
>
> **Embeddings are local by default** (MiniLM, about 23 MB once). Nothing goes
> to a remote API unless you set `MEMORIA_EMBEDDINGS=openai`.
>
> **One store for Claude Code and claude.ai.** stdio locally; over HTTP it
> implements OAuth 2.1 with PKCE and dynamic client registration, so it works
> as a claude.ai custom connector.
>
> How this differs from what Claude ships: Claude Code's auto memory is also
> Markdown files, kept per repository on one machine, and claude.ai has a
> separate memory of its own. Memoria is one store across all your repos,
> machines and clients, with search over the whole thing. If you work in one
> repo on one machine, the built-in memory is probably enough.
>
> What it is not: multi-user, or a memory backend for an app you are building.
> It is single-tenant, for your own assistant. There is also a collector that
> can ingest email and calendar events; it is experimental, off by default,
> and I would read SECURITY.md before enabling it. The README has a "Known
> Limitations" section and I tried to make it complete.
>
> To try it in Claude Code:
>
>     /plugin marketplace add Agripp87/memoria_mcp
>     /plugin install memoria@memoria
>
> Or look at the dashboard on fake data without installing anything:
> https://memoria-demo-hpb4luig7q-uc.a.run.app/dashboard (key: memoria-demo)
>
> I would most like to hear where the retrieval eval is wrong, and what breaks
> on your machine.

## Before posting

The submission is the repository, so the README is the landing page. It now
opens with the 30-second demo, the feature cards and the install commands.
Check on github.com that the GIF plays and the images load before you submit.

## Replying

- Answer the technical questions first and at length. Those threads are what
  keep a Show HN on the page.
- Concede real criticism plainly, then open an issue for it and link the
  issue in your reply.
- The reply bank in [../messaging.md](../messaging.md#objections-and-honest-answers)
  covers the questions that will certainly come. Rewrite each one before
  posting so it answers the actual comment.
- Do not reply to every "nice" with thanks. Do reply to every bug report.

## If it does not take off

Do not repost it. The eval write-up ([blog-eval.md](blog-eval.md)) goes to HN
a week later as an ordinary link submission, and it stands on its own.
