---
name: log-outcome
description: Record how a published Memoria post, article or release announcement performed, and the lesson from it, in the Memoria store so future campaigns build on it.
argument-hint: "[channel] [what was published] [numbers and notes]"
disable-model-invocation: true
context: fork
agent: oss-marketer
---

Record this outcome: `$ARGUMENTS`

The maintainer supplies the numbers (upvotes, comments, reads, stars or npm
downloads before/after, notable questions). Do not look up or invent figures.
If the channel, the piece, or the date is missing, ask for it before writing.

1. `memory_search` for the campaign (`marketing <campaign or version>`) and
   any earlier outcome on the same channel.
2. Append a `memory_daily` entry:
   `[marketing] <channel> — <piece> — <date>: <numbers>. Top questions: … Lesson: …`
3. If there is a durable lesson (an angle that worked or failed, a subreddit
   rule we hit, a tone the maintainer corrected), `memory_write` it as its own
   memory under `decisions/` (a choice we will repeat or avoid) or
   `feedback/` (how drafts should change), with frontmatter `type: decision`
   or `type: feedback`, `importance` 5–7, and `tags: [marketing, <channel>]`.
   Review any duplicate the dedup check returns and update instead of adding.
4. If a recurring question came up, add a bullet for the developer advocate
   ("docs gap: …") to your reply.

Store aggregate outcomes only — never usernames or personal details of
commenters. If the `memoria` MCP tools are not available, write the same
entry to `devrel/drafts/outcomes.md` instead and say so.
