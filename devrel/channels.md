# Channels

Where Memoria is promoted, and the rules for each. The agents draft for these
channels only; a human posts. Every channel discloses that the poster is the
maintainer.

## Twitter / X

- **Account:** the maintainer's personal account.
- **Formats:** single post (≤ 280 characters, link last) or a thread of 4–8
  posts. First post must stand alone: the hook plus the one-liner or a concrete
  result, not "🧵 1/".
- **Media:** a demo-store screenshot (`docs/images/dashboard-wiki.png` or a new
  one from `npm run demo`) or a short terminal GIF. Alt text always.
- **Links:** repo or a specific README anchor. One link per post.
- **Hashtags:** at most two (`#MCP`, `#ClaudeCode`). Tag accounts only when
  they are genuinely involved.
- **Cadence:** release posts, tutorial/article announcements, and an occasional
  "how I use it" post. No more than ~3 Memoria posts a week.

## Reddit

- **Subreddits (check each sub's current rules before every post):**
  - r/ClaudeAI — primary audience; usually requires a flair and a disclosure of
    self-promotion.
  - r/ClaudeCode — if active; Claude Code–specific setups.
  - r/mcp — MCP server announcements and technical discussion.
  - r/LocalLLaMA — only for genuinely local-first angles (offline MiniLM
    embeddings, no cloud); not for Claude-only news.
  - r/selfhosted — Docker / self-hosting angle, only with a real self-hosting
    story.
- **Disclosure:** first line or title says "I built…" / "I'm the maintainer
  of…". No posting from secondary accounts, no asking others to upvote.
- **Format:** text post, problem first ("Claude forgets my projects between
  sessions, so…"), then what Memoria does, install in one code block, honest
  limitations, link. Reddit punishes marketing tone; write like a forum post.
- **Spacing:** one subreddit per day for the same announcement; never
  cross-post the identical text. Tailor the angle to the sub.
- **Comments:** the maintainer answers; the DevRel agent can draft replies.

## Medium

- **Formats:** long-form articles (1,200–2,500 words): tutorials, design
  write-ups ("Why I store AI memory as Markdown"), release deep-dives.
- **Publications:** consider submitting to tech publications that accept
  outside writers (check each one's current submission guidelines); otherwise
  publish on the personal profile.
- **Canonical URL:** if the same piece also lives in the repo or a blog, set
  Medium's canonical link to that original.
- **Structure:** title states the outcome, a TL;DR, a runnable example from the
  demo store, a "limitations" section, and a closing link to the repo.
- **Tags:** up to 5 — e.g. `Claude`, `MCP`, `AI Agents`, `Open Source`,
  `Developer Tools`.
- **Code:** in fenced blocks (or gists), always copied from a command the
  DevRel agent actually ran.

## Not used (for now)

Hacker News, LinkedIn, Bluesky, newsletters, Discord. Add a section here before
any agent drafts for them.

## Always-on listing targets (not posts)

These are submissions rather than campaigns; DevRel prepares the technical
part, marketing writes the copy:

- Official MCP Registry (`server.json`) — on the roadmap
- Docker MCP Catalog — on the roadmap
- Curated "awesome" lists for MCP servers / Claude Code (via PR, following each
  list's contribution rules)
