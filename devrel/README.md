# DevRel and marketing agents

Two Claude Code subagents help with Memoria's developer relations and
open-source marketing. They draft; the maintainer reviews and publishes.
Nothing here posts anywhere on its own.

| Agent | File | Does |
|-------|------|------|
| `devrel-advocate` | [`.claude/agents/devrel-advocate.md`](../.claude/agents/devrel-advocate.md) | Release notes, migration guides, tutorials verified against the code, community triage and drafted replies, good first issues, technical fact-checks |
| `oss-marketer` | [`.claude/agents/oss-marketer.md`](../.claude/agents/oss-marketer.md) | Positioning, launch plans, Twitter/X, Reddit and Medium drafts, listing copy, outcome tracking |

## Sources of truth (human-owned)

The agents may only say what these files allow. Edit them by hand; the agents
propose changes but never apply them.

- [`fact-sheet.md`](fact-sheet.md) — every approved claim, with its source.
- [`messaging.md`](messaging.md) — positioning, pillars, audiences, voice,
  forbidden claims, competitive framing.
- [`channels.md`](channels.md) — rules for Twitter/X, Reddit and Medium.

Update `fact-sheet.md` in the same PR as any change to the README, CHANGELOG
or SECURITY facts it cites.

## Skills (slash commands)

| Command | Runs as | Output (in `devrel/drafts/`) |
|---------|---------|------------------------------|
| `/release-kit [version\|unreleased]` | devrel-advocate | `release-<v>/` release notes, migration guide, marketer brief, fact-sheet updates |
| `/launch-plan [version\|topic]` | oss-marketer | `launch-<slug>/` plan, Twitter thread, one post per subreddit, Medium article |
| `/claims-check [path]` | devrel-advocate | `claims-check.md` next to the drafts: PASS / PASS WITH FIXES / FAIL |
| `/community-digest [days]` | devrel-advocate | `digest-<date>.md` triage + drafted replies + docs gaps + good first issues |
| `/log-outcome [channel] [piece] [numbers]` | oss-marketer | Entry in the Memoria store (or `outcomes.md` fallback) |

You can also ask either agent directly, e.g. *"Use the devrel-advocate to
write a Medium tutorial on multi-device git sync."*

## Typical flows

**A release**

1. `/release-kit unreleased` → review `devrel/drafts/release-unreleased/`.
2. Publish the release notes; apply `fact-sheet-updates.md` by hand.
3. `/launch-plan <version>` → drafts for each channel.
4. `/claims-check devrel/drafts/launch-<version>` → fix until PASS.
5. Post on the schedule in `plan.md`.
6. A few days later: `/log-outcome reddit "r/ClaudeAI 0.3.0 post" "… upvotes, top question was …"`.

**Every week:** `/community-digest` → paste the replies you agree with.

**A tutorial or article:** ask the devrel-advocate to write it (it runs every
command against a demo store), then `/launch-plan "<topic>"` to promote it.

## Drafts

`devrel/drafts/` is git-ignored: campaign plans and unpublished posts never
land in this public repo. Back them up elsewhere if you want to keep them.

## Memory

Both agents use the Memoria store as their long-term memory (dogfooding):
past campaigns, how they performed, and the maintainer's feedback on drafts.
Conventions:

- Daily-log entries start with `[devrel]` or `[marketing]`.
- Durable lessons go under `decisions/` or `feedback/` with `tags: [devrel]` or
  `tags: [marketing, <channel>]`.
- Only aggregate outcomes and lessons; never usernames or community members'
  personal details.

The agents look for the Memoria MCP tools under the server name `memoria`
(manual `claude mcp add memoria …` registration) or the plugin's server. If
yours is registered under another name, add its `mcp__<name>__*` prefix to the
`tools:` line of both agent files. Without the server the agents still work;
`/log-outcome` falls back to `devrel/drafts/outcomes.md`.

## Guardrails

- Drafts only: no GitHub write tools, no posting, no commits or pushes.
- Every post discloses that the author is the maintainer; no astroturfing.
- No personal data: examples and screenshots come from `npm run demo` /
  `npm run demo:gen`.
- Security-sensitive reports are never answered in public; they are flagged to
  the maintainer and pointed at private reporting (`SECURITY.md`).
- Claims come from the fact sheet; every draft ends with a claims table and
  goes through `/claims-check` before publishing.
