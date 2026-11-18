# Marketing

Everything for promoting Memoria to developers and Claude Code users. Start
with [PLAN.md](PLAN.md).

All of it is draft. The posts are written in the maintainer's first person and
will be read as the maintainer's word, so read each one before it goes out and
change what does not sound like you. Nothing here has been posted anywhere.

## Contents

| File | What it is |
|------|------------|
| [PLAN.md](PLAN.md) | The campaign brief: goal, audience, messages, channels, a day-by-day calendar, metrics, risks. |
| [messaging.md](messaging.md) | Positioning, taglines, the five messages with their evidence, what not to claim, and paste-ready answers to the questions every thread will ask. |
| [demo-video-script.md](demo-video-script.md) | Shot list for the 60-second demo. Still to record. |
| [posts/show-hn.md](posts/show-hn.md) | Show HN title options and the maintainer's first comment. |
| [posts/reddit.md](posts/reddit.md) | Separate posts for r/ClaudeAI, r/ClaudeCode, r/mcp and r/selfhosted. |
| [posts/x.md](posts/x.md) | A seven-post launch thread and six follow-ups, each matched to an image. |
| [posts/linkedin.md](posts/linkedin.md) | One post and its first comment. |
| [posts/blog-launch.md](posts/blog-launch.md) | "I keep Claude's memory in a git repo", about 1,100 words. |
| [posts/blog-eval.md](posts/blog-eval.md) | "I picked my search ranking weights by hand. Then I measured them.", about 1,400 words. |
| [posts/directories.md](posts/directories.md) | Awesome-list entries, directory fields, GitHub topics and pinned discussion, Discord post, newsletter pitch. |
| [images/](images/) | Social cards, listed below. |

## Images

Rendered from [images/src/cards.html](images/src/cards.html). Terminal and
file contents on the cards come from the generated demo store, and the
dashboard is a real screenshot of it.

| File | Size | Use |
|------|------|-----|
| `launch.png` | 1600×900 | Blog cover, first X post if there is no clip, directory listings. |
| `launch-linkedin.png` | 1200×627 | LinkedIn, and any Open Graph slot. |
| `launch-square.png` | 1080×1080 | Square slots. |
| `card-own.png` | 1600×900 | "Your memory is a folder." |
| `card-sync.png` | 1600×900 | "Sync is git. Same-day writes merge." |
| `card-search.png` | 1600×900 | "Hybrid search, measured in the open." Eval numbers as of 0.3.2. |
| `card-everywhere.png` | 1600×900 | "One memory. Every Claude." |
| `card-dashboard.png` | 1600×900 | "Browse it like a wiki." |
| `card-install.png` | 1600×900 | The two install commands. End card for the demo video. |

To change a card, edit the HTML and re-render:

```bash
node marketing/images/src/render.mjs
```

That needs Playwright with Chromium, and the Inter and JetBrains Mono fonts
installed. `card-search.png` quotes eval scores: re-render it when
`mcp-server/eval/README.md` changes.

## Before launch

- [ ] Read [messaging.md](messaging.md). Fix anything that is not how you
      would say it.
- [ ] Rewrite the sentences marked `[yours]` in the two blog posts. They
      describe your experience in words guessed from the README.
- [ ] Check what Claude Code's and claude.ai's built-in memory currently do,
      and adjust the "Claude already has memory" answer to match.
- [ ] Record the demo ([demo-video-script.md](demo-video-script.md)).
- [ ] Install from scratch on a clean macOS, Linux and Windows machine, by
      all three routes: the plugin, `npx`, and `docker compose`.
- [ ] Confirm the hosted demo is up and its key works, and cap its maximum
      instances.
- [ ] Set the repository topics and pin the "Start here" discussion
      ([posts/directories.md](posts/directories.md#github-repository-settings)).
- [ ] Label three to five issues `good first issue`.
- [ ] Open the awesome-list pull requests and directory submissions.
- [ ] Publish the launch blog post and put its URL where the other posts say
      `[link …]` or `LINK-TO-EVAL-POST`.
- [ ] Re-check every number against the README if a release has gone out
      since 0.3.2.

## Keeping this current

The copy quotes facts from the README and the eval write-up: 17 tools, 83.7
nDCG@10, Node 20, the install commands, the demo URL. When one changes, search
this directory for the old value. [messaging.md](messaging.md) lists each
quoted fact with its source.
