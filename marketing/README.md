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
| [video/](video/) | The animated demo with narration: `demo.mp4` (84 seconds), `demo-30s.mp4` and `demo-30s.gif` (30 seconds), `demo-poster.png`. See below. |
| [demo-video-script.md](demo-video-script.md) | Shot list for an optional live screen recording of the same story. |
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
| `launch.png` | 1600×900 | Blog cover, directory listings, anywhere a video cannot go. |
| `launch-linkedin.png` | 1200×627 | LinkedIn, and any Open Graph slot. |
| `launch-square.png` | 1080×1080 | Square slots. |
| `card-own.png` | 1600×900 | "Your memory is a folder." |
| `card-sync.png` | 1600×900 | "Sync is git. Same-day writes merge." The two entries are from the real two-machine run in the demo video. |
| `card-search.png` | 1600×900 | "Hybrid search, measured in the open." Eval numbers as of 0.3.2. |
| `card-everywhere.png` | 1600×900 | "One memory. Every Claude." |
| `card-dashboard.png` | 1600×900 | "Browse it like a wiki." A screenshot of the synced demo store, with the backlink to the new decision. |
| `card-install.png` | 1600×900 | The two install commands. End card for the demo video. |

To change a card, edit the HTML and re-render:

```bash
node marketing/images/src/render.mjs
```

That needs Playwright with Chromium, and the Inter and JetBrains Mono fonts
installed. `card-search.png` quotes eval scores: re-render it when
`mcp-server/eval/README.md` changes.

## Demo video

`video/demo.mp4` (1920×1080, 30 fps, 84 seconds, about 8 MB) is a scripted
animation with a voice-over, so it needs no Claude login and no recording
session. It carries a small on-screen note saying it is an illustration.
`video/demo-30s.mp4` is a 30-second cut of the same material, and
`video/demo-30s.gif` is that cut without sound, which the repository README
shows at the top.

It tells the story in four parts, each labelled with the machine it happens
on:

| Time | Part | What it shows |
|------|------|---------------|
| 0:00 | A session on the laptop | Claude recalls an old decision with `memory_search`, then records a new one with `memory_write`. The new memory is shown as a Markdown file. |
| 0:27 | Sync across devices | The Stop hook commits and pushes the store. On the desktop, the SessionStart hook pulls, and a new session finds the decision made on the laptop. Both machines had written to the same day's log, and the merged file holds both entries. |
| 1:00 | Dashboard | Four views of the same store: overview counts, search, the wiki page with its backlink to the new decision, and the journal. |
| 1:18 | End card | The two install commands. |

What in it is real: the tool results and scores, the Markdown file, the
`.sync.log` lines, the merged daily log and the dashboard screenshots. They
come from one continuous run of the 0.3.2 server (local MiniLM embeddings) and
the real `scripts/sync/` hook scripts, on two clones of the generated demo
store with a bare git remote between them. What is scripted: the three prompts
and Claude's three replies, which are written from those results.

The 30-second cut keeps four beats: Claude records a decision, the memory is
shown as a file, a session on the desktop finds it after the pull, and the
wiki shows the backlink.

**Narration.** The voice is ElevenLabs' "Aabo" (model `eleven_v4`), one clip
per sentence in [video/src/audio/](video/src/audio/). The text of each clip
and the second it starts at are in the `AUDIO` lists in `demo.html`; the
render script mixes them in. To change a line, generate a new clip, save it
under the same name, and re-render. Check the licence terms of your ElevenLabs
plan before using the voice-over commercially.

| File | Use |
|------|-----|
| `video/demo.mp4` | The full story, with sound: the blog posts, LinkedIn, YouTube. |
| `video/demo-30s.mp4` | The short cut, with sound: X, Reddit, Discord. |
| `video/demo-30s.gif` | The README and anywhere that will not play video (960 wide, 10 fps, silent, about 4.5 MB). |
| `video/demo-poster.png` | Thumbnail. |

To change the wording or timing, edit the `TERMS`, `SHOTS` and `CAPTIONS`
tables at the top of the script in
[video/src/demo.html](video/src/demo.html), then:

```bash
node marketing/video/src/render.mjs          # both cuts; or pass full / short
```

That needs Playwright with Chromium, `ffmpeg`, and the Inter and JetBrains
Mono fonts. Opening `demo.html` in a browser plays it in real time, and
`demo.html?t=12.5` freezes it at one moment; `?cut=short` selects the 30-second
cut. The page itself is silent. If you change what a tool result
says, capture the new text from the real server first.

## Where the visuals are used

| Place | What it shows |
|-------|---------------|
| Repository README, top | `video/demo-30s.gif`, then a 2×2 grid of `card-own`, `card-sync`, `card-everywhere`, `card-search`, each linking to its section. |
| README, Quick Start | `card-install`. |
| README, Multi-device sync | `card-sync`, linking to the full video. |
| README, Dashboard | Four screenshots in `docs/images/dashboard-*.png`. |
| X thread | The 30-second video on the first post, one card on each of the rest. |
| Reddit, LinkedIn, Discord | See the attachment notes at the top of each file in `posts/`. |
| Blog posts | The GIF and four cards in the launch post, `card-search` in the eval post. |

The README and the blog posts link these files by path on `main`, so they
show up once this branch is merged.

## Before launch

- [ ] Read [messaging.md](messaging.md). Fix anything that is not how you
      would say it.
- [ ] Rewrite the sentences marked `[yours]` in the two blog posts. They
      describe your experience in words guessed from the README.
- [ ] Check what Claude Code's and claude.ai's built-in memory currently do,
      and adjust the "Claude already has memory" answer to match.
- [ ] Merge this branch, then open the repository page on github.com and
      check that the demo GIF plays and every image loads.
- [ ] Listen to both videos. The narration was generated and placed by cue
      time but has not been judged by ear.
- [ ] Watch `video/demo.mp4` and decide whether it is enough on its own, or
      whether to also record a live session
      ([demo-video-script.md](demo-video-script.md)).
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
