# Memoria open-source launch plan

Campaign brief for promoting Memoria 0.3.x to developers and Claude Code users.
Solo maintainer, no budget, organic channels only. Every asset this plan names
is drafted in this directory; [README.md](README.md) is the index.

Dates are relative to **L**, the launch day. Pick a Tuesday, Wednesday or
Thursday and plan to be at the keyboard for the six hours after posting.

## 1. Overview

**Campaign name:** "A memory you can `git diff`"

**Summary:** Introduce Memoria to people who already use Claude Code daily, as
the memory layer that is a folder of Markdown they own rather than a service.

**Primary objective:** 150 plugin or npm installs that reach a first
`memory_write`, within 30 days of L. Installs are the goal and stars are the
visible proxy: the target is 300 GitHub stars in the same window.

**Secondary objectives:**

- 10 issues or discussions opened by people other than the maintainer.
- 3 outside pull requests (the Cursor guide in `docs/clients.md` shows the
  shape: one tested client config is a good first contribution).
- Listings in the two awesome-lists and three MCP directories named in
  [posts/directories.md](posts/directories.md).

These targets are starting guesses for a project with no baseline. Re-set them
after week 1 from what the first posts actually did.

## 2. Audience

**Primary: daily Claude Code users.** Developers who run Claude Code for hours
a day, across several repos and often two machines. They already keep a
`CLAUDE.md`, have installed at least one MCP server or plugin, and re-explain
the same decisions to a fresh session several times a week.

> A developer who lives in Claude Code and is tired of re-explaining context
> every session. They find tools through Hacker News, r/ClaudeAI, and what
> people they follow post, and they care most about owning their data, not
> adding a service, and being able to see what the tool is doing.

**Secondary: MCP builders and self-hosters.** People who write or run MCP
servers and care about how one is built: the OAuth 2.1 remote transport, the
retrieval eval, the security write-up. They are fewer, but they are the ones
who file good issues and send pull requests.

**Pain points, in the order people feel them:**

1. Every session starts cold. Decisions made on Monday are re-argued on Thursday.
2. Memory is siloed: what Claude Code learned on the laptop is not on the
   desktop, and not in claude.ai at all.
3. Hosted memory layers are opaque. You cannot read, grep or correct what was
   stored, and leaving means an export.
4. "Semantic search" claims are rarely backed by a number.

**Where they are:** Hacker News; r/ClaudeAI, r/ClaudeCode, r/mcp,
r/selfhosted; X; the Anthropic and MCP community Discords; dev.to; the
`awesome-mcp-servers` and `awesome-claude-code` lists; MCP directories.

**Stage:** mostly problem-aware and solution-unaware. They know the pain and
have not gone looking for a memory server. A minority has tried one and left.

## 3. Messages

**Core message:** Memoria gives Claude a long-term memory that is a folder of
Markdown files you own: searchable, synced with git, and shared by Claude Code
and claude.ai.

| # | Message | Answers | Proof |
|---|---------|---------|-------|
| 1 | **You own it.** Memories are Markdown with YAML frontmatter. Grep them, edit them, commit them. | "Where does my data go?" | The index is derived and rebuildable from the files; no hosted database; Apache-2.0. |
| 2 | **One memory, every Claude.** stdio for Claude Code, OAuth 2.1 HTTP for claude.ai, the same store behind both. | "It only works in one place." | Works as a claude.ai custom connector; Cursor config tested in `docs/clients.md`. |
| 3 | **Sync without a service.** The store is a git repo. Two machines writing the same day merge cleanly. | "How do I get it on my other machine?" | One `.gitattributes` line (`merge=union`) for append-only daily logs; the plugin wires the SessionStart and Stop hooks. |
| 4 | **Search that is measured.** Hybrid vector + BM25, local embeddings by default, an eval in the repo. | "Does retrieval actually work?" | 83.7 nDCG@10 on the 175-document eval; every result reports how much of the store was scanned; the limits of the eval are written down next to the number. |
| 5 | **Two commands to try.** | "Is this an afternoon of setup?" | `/plugin marketplace add Agripp87/memoria_mcp` then `/plugin install memoria@memoria`; a hosted demo with fake data needs no install at all. |

Full wording, taglines, the claims table and objection handling are in
[messaging.md](messaging.md).

**Tone:** the README's own. Plain, specific, first person, and open about what
is unfinished. The "Known Limitations" section is a selling point with this
audience and the launch posts link to it deliberately. No superlatives, no
"revolutionary", no invented numbers or testimonials.

**By channel:**

- *Hacker News:* lead with the design choice (files over a database, git over
  a sync service) and the eval. No adjectives. Limitations up front.
- *Reddit:* lead with the problem and the two install commands. Answer every
  comment.
- *X:* one idea per post, one image or video per post. The 30-second cut
  leads the thread.
- *LinkedIn:* the same story framed as a lesson from building it.

## 4. Channels

| Channel | Why | Format | Effort |
|---------|-----|--------|--------|
| **GitHub repo** (owned) | Every other channel sends people here; it has to convert. | README top section, social preview, topics, a pinned "start here" discussion. | Low |
| **Hacker News** (earned) | Highest concentration of the secondary audience; one good thread outweighs the rest of the month. | Show HN with a first comment from the maintainer. | Medium, plus a day of replies |
| **Reddit** (earned) | Where the primary audience asks "how do you handle memory?" every week. | One native post per subreddit, each written for that subreddit. | Medium |
| **X** (owned) | Claude Code users and Anthropic staff are active there; clips travel. | Launch thread, then one feature post every few days. | Medium |
| **dev.to / personal blog** (owned) | Long-form that HN, Reddit and newsletters can link to; search traffic later. | Launch post and one technical post about the eval. | Medium |
| **Awesome-lists and MCP directories** (earned) | Slow, compounding discovery; people browse these when they go looking. | One-line entries by pull request or form. | Low |
| **Discords** (earned) | Direct line to heavy users. | A short post in the showcase channel, only where self-promotion is allowed. | Low |
| **LinkedIn** (owned) | Reaches engineering managers who decide what a team installs. | One post. | Low |
| **Newsletters** (earned) | A single mention can match a Reddit post. | A three-sentence pitch email. | Low |

Not planned: paid ads (no budget, and this audience blocks them), Product Hunt
(its audience skews away from CLI tools; revisit at 1.0), cold DMs.

## 5. Calendar

| When | Piece | Channel | Notes |
|------|-------|---------|-------|
| L−7 | Merge the marketing branch so the README shows the demo, cards and screenshots | GitHub | Then check the page on github.com. |
| L−7 | Repo pass: topics, social preview, pinned discussion, `good first issue` labels | GitHub | Checklist in [README.md](README.md#before-launch). |
| L−7 | Review the animated demo; optionally record a live one | — | [video/demo.mp4](video/demo.mp4) is ready. A live take follows [demo-video-script.md](demo-video-script.md). |
| L−5 | Awesome-list pull requests and directory submissions | GitHub, directories | They take days to merge; start early. |
| L−2 | Publish the launch blog post | dev.to / blog | Live before HN so comments can link to it. |
| L−1 | Check the hosted demo is up and the install commands work on a clean machine | — | A broken install on launch day costs more than any post earns. |
| **L**, morning US Eastern | Show HN | Hacker News | Post, then add the first comment. Stay for six hours. |
| L, +2h | Launch thread | X | Pin it. |
| L, +3h | r/ClaudeAI post | Reddit | |
| L+1 | r/ClaudeCode and r/mcp posts | Reddit | A day apart from the first so they are not seen as one blast. |
| L+1 | LinkedIn post | LinkedIn | |
| L+2 | Discord showcase posts; newsletter pitches | Discord, email | |
| L+3 | r/selfhosted post | Reddit | Different angle: Docker, OAuth, your own box. |
| L+5 | Feature post: git union merge | X | Image: `card-sync`. |
| L+7 | Technical post: "We measured our ranking weights. They were wrong." | dev.to / blog, then HN as a normal link | The second shot at HN, on substance. |
| L+9 | Feature post: the eval | X | Image: `card-search`. |
| L+12 | Feature post: the wiki dashboard | X | Image: `card-dashboard`. |
| L+14 | Week-two review: reset targets, write up what people asked for | GitHub discussion | |
| L+16 | Feature post: claude.ai connector | X | Image: `card-everywhere`. |
| L+21 | "What I learned from the first three weeks" | X, blog | Only if there is something true to say. |
| L+30 | Review against section 7 | — | |

About a fifth of the slots after L+3 are deliberately empty. Use them for
replies, for a fix someone asked for, and for sharing what users build.

## 6. Assets

All drafted here. "Must" means the launch does not go without it.

| Asset | File | Priority |
|-------|------|----------|
| Positioning, taglines, claims table, objections | [messaging.md](messaging.md) | Must |
| Show HN title, body and first comment | [posts/show-hn.md](posts/show-hn.md) | Must |
| Reddit posts for four subreddits | [posts/reddit.md](posts/reddit.md) | Must |
| X launch thread and six follow-up posts | [posts/x.md](posts/x.md) | Must |
| Launch blog post | [posts/blog-launch.md](posts/blog-launch.md) | Must |
| Animated demo with narration: 84-second and 30-second cuts, GIF, poster | [video/](video/) | Must |
| README visuals: demo GIF, feature cards, dashboard screenshots | [../README.md](../README.md) | Must |
| Shot list for an optional live recording | [demo-video-script.md](demo-video-script.md) | Nice to have |
| Social cards (launch, four feature cards, square) | [images/](images/) | Must |
| Technical blog post on the retrieval eval | [posts/blog-eval.md](posts/blog-eval.md) | Should |
| LinkedIn post | [posts/linkedin.md](posts/linkedin.md) | Should |
| Awesome-list entries, directory blurbs, Discord post, newsletter pitch | [posts/directories.md](posts/directories.md) | Should |
| Reply bank for common questions | [messaging.md](messaging.md#objections-and-honest-answers) | Should |

## 7. Measurement

**Primary:** installs that reach a first write. Nothing reports this, by
design: Memoria has no telemetry and the campaign does not add any. Use the
closest public signals together:

| Metric | 30-day target | Where to read it |
|--------|---------------|------------------|
| npm downloads of `@agrippa87/memoria-mcp` | 1,000 | npmjs.com package page (includes CI and bots; watch the trend, not the total) |
| GitHub stars | 300 | Repo |
| Unique repo visitors and clones | 3,000 / 300 | Repo → Insights → Traffic (kept 14 days: record it weekly) |
| Referrers | — | Same page; this is how you learn which channel worked |
| Issues and discussions by others | 10 | Repo |
| Outside pull requests | 3 | Repo |
| Hosted demo visits | — | Cloud Run request count |

Record the numbers every Monday in a pinned discussion or a private note. The
traffic page forgets after two weeks, so a missed week is lost.

**What to learn, beyond the counts:** which message people repeat back (that
is the real tagline), what they ask before installing (that is a README gap),
and where installs fail (that is the next release).

## 8. Budget

None. The cost is time: about 8 hours before L (mostly the repo pass and the
install checks), a full day on L, and three to four hours a week afterwards.
The hosted demo's Cloud Run bill may rise with traffic; it scales to zero and
runs on throwaway data, so cap its max instances rather than take it down.

## 9. Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| **"Claude already has memory."** The first comment on every post. | Certain | Answer it in the post, before it is asked: Memoria is one store shared across Claude Code, claude.ai and other MCP clients, across machines, in files you can read. The import script (`sync-from-claude-memory.sh`) makes it an addition, not a replacement. Wording in [messaging.md](messaging.md). |
| **Install fails on launch day.** `better-sqlite3` is native; the first plugin start builds from source. | Medium | Test all three install paths on a clean macOS, Linux and Windows machine at L−1. Say "the first start takes a minute" in every post. Keep the hosted demo as the no-install path. |
| **Security scrutiny.** A memory server that can read email invites it. | Medium | Lead with it: the collector is experimental, off by default, consent is dashboard-only, and `SECURITY.md` states the trust model. Do not feature the collector in launch posts. |
| **The Show HN sinks.** Most do. | High | The plan does not depend on it: Reddit and the lists carry the baseline, and the eval post at L+7 is a second, different submission. Do not repost the Show HN. |
| **Solo maintainer overload.** A good launch produces a week of issues. | Medium | Pin a discussion that says review is asynchronous. Label and batch. A slow honest answer beats a fast wrong one. |

## 10. Next steps

1. Read [messaging.md](messaging.md) and correct anything that does not sound
   like you. Every post is written in your first person and will be read as
   your word.
2. Pick L.
3. Watch the animated demo ([video/demo.mp4](video/demo.mp4)) and change any
   wording you would not say.
4. Work through the [pre-launch checklist](README.md#before-launch).

Decisions that are yours and that the drafts assume:

- **The posts name the collector only in passing.** If you would rather lead
  with it, the HN and Reddit posts need a different second paragraph.
- **No telemetry is added.** Measurement stays with public signals.
- **Product Hunt is skipped** until 1.0.
