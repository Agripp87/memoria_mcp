# Memoria messaging guide

How we talk about Memoria. Facts come from [`fact-sheet.md`](fact-sheet.md);
this file decides which facts lead, for whom, and in what voice.

## Positioning

**For** developers who use Claude (Claude Code first, claude.ai second) every
day and are tired of re-explaining their projects, **Memoria is** a long-term
memory that lives in a folder of Markdown files they own. **Unlike** hosted
memory layers, there is no service to trust, no database to export from, and
no proprietary format: the memory is grep-able, diff-able and committable, and
the search index is a cache you can delete.

One-liner (use verbatim): *Persistent, plain-text memory for Claude — as a
Markdown repo you own.*

## Pillars, in priority order

Lead with pillar 1. Use at most three in any single piece.

1. **You own the data.** Plain Markdown in a folder. Grep it, edit it, commit
   it. The SQLite index is derived and rebuildable. No lock-in.
2. **Multi-device without a service.** The store is a private git repo; daily
   logs merge with git's union driver, so two machines never clobber a day.
3. **It maintains itself.** Write-time dedup, reflection, contradiction lint,
   and "compile, don't retrieve" entity pages keep the store from becoming a
   write-only log.
4. **Works where you use Claude.** stdio for Claude Code (one-command plugin
   install), OAuth 2.1 HTTP for claude.ai custom connectors.
5. **Honest about search.** Local semantic embeddings by default, keyword
   fallback, and every result reports how much of the store it scanned.

## Audiences

| Audience | What they care about | Lead with |
|----------|----------------------|-----------|
| Claude Code power users | Setup in minutes, no context loss between sessions | Pillar 1 + plugin install + `CLAUDE.md` snippet |
| Local-first / self-hosting crowd | Privacy, no cloud, owning files | Pillars 1, 2, 5 (local embeddings, OpenAI opt-in only) |
| MCP builders | Spec completeness, code quality, how it is built | Pillar 4 (OAuth 2.1 details), test suite, design decisions |
| Potential contributors | Is this alive, is it welcoming, where do I start | Roadmap, good first issues, CONTRIBUTING expectations |

## Voice

- **Plain and candid.** Write like the README: concrete, specific, a little dry.
  Say what it does, then what it does not do yet.
- **Show, then tell.** A command, a screenshot of the demo store, or a file
  snippet beats an adjective.
- **First person singular for the maintainer** ("I built this because…") on
  personal channels; "Memoria" or "we" in docs.
- **No hype words:** revolutionary, game-changing, blazing-fast, seamless,
  supercharge, unleash, 10x, next-gen.
- **Limitations are part of the message.** "Early public release", "the
  collector is experimental" and "single-user" appear wherever they matter.
  This is a credibility asset, not a disclaimer to bury.

## Claims we never make

- "Production-ready", "enterprise-grade", "battle-tested", or "secure" without
  scope (see `SECURITY.md` trust model).
- Performance or accuracy numbers not published in the repo.
- Comparative claims about another project ("faster than X", "X can't do Y")
  without a citation to that project's own docs, checked the same week.
- Anything on the roadmap described as available.
- Endorsement by Anthropic or any other company. Memoria is an independent
  project that works with Claude.

## Competitive framing

Other memory options developers will compare against include hosted memory
layers (e.g. mem0, Zep, Letta), Markdown/knowledge-base MCP servers (e.g.
Basic Memory), the reference MCP memory server, and Claude Code's own built-in
memory. Rules:

- Compare on **our** dimension (data ownership, plain files, git sync), never by
  disparaging theirs.
- Be generous: name what a competitor does well when it is relevant.
- Re-verify any statement about another project against its current docs
  before each use; cite the link in the draft's claims table.
- Claude Code's built-in memory is a starting point, not a rival:
  `scripts/sync-from-claude-memory.sh` imports it.
