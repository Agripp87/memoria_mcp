# Demo video script

**An animated version already exists:** [video/demo.mp4](video/demo.mp4) tells
this story, plus sync and the dashboard, in 84 seconds with a voice-over
(and [video/demo-30s.mp4](video/demo-30s.mp4) in 30) and needs no recording. It is labelled as an
illustration; the Memoria output in it is real and Claude's replies are
scripted (see [README.md](README.md#demo-video)). This file is for an optional
live recording, which is worth making if a thread asks "is that real?".

A 60-second screen recording with no voice-over. The demo is the most-used
asset in the campaign: the first post of the X thread, every Reddit post, the
README and the Discord posts all want it.

The point it has to make, in order: a new session knows nothing; with Memoria
it finds Monday's decision; that decision is a file you can read.

## Setup

- **Record your real setup** with a throwaway store, so every frame is
  something the tool actually did. Do not simulate output.
- Use the default embeddings (local MiniLM). `npm run demo` forces the
  lexical fallback provider, which ranks worse than what users will get, so do
  not record search results from it.
- A clean store with the demo data gives recognisable content without showing
  your own memories:

  ```bash
  cd mcp-server
  npm run demo:gen -- --out /tmp/memoria-demo-store
  claude mcp add memoria-demo -s local -e MEMORIA_DIR=/tmp/memoria-demo-store -- npx -y @agrippa87/memoria-mcp
  ```

  Remove it afterwards with `claude mcp remove memoria-demo -s local`.
- Terminal: 100×28, a 16 to 18 pt font, dark theme. Hide your shell prompt's
  username and path (`PS1='$ '`).
- Check every frame for anything private before publishing: paths, account
  names, other MCP servers in the tool list.
- Record at 1920×1080. Export an MP4 for X and Reddit and a GIF under 10 MB
  for the README (`ffmpeg -i demo.mp4 -vf "fps=12,scale=1200:-1" demo.gif`).

## Shots

| # | Time | On screen | Caption (burned in, bottom) |
|---|------|-----------|-----------------------------|
| 1 | 0:00–0:06 | A fresh Claude Code session. Type: `Which database are we using for Atlas API, and why?` Do not run it yet. | Every session starts from zero. |
| 2 | 0:06–0:18 | Run it. Claude calls `memory_search`, the tool call is visible, and it answers from `decisions/postgres-over-mongo.md`: Postgres, for relational integrity in the sync model. | Unless it can remember. |
| 3 | 0:18–0:28 | Type: `We just decided to move the job queue to Postgres too, using SKIP LOCKED. Remember that.` Claude calls `memory_write`. Let the dedup note show if it appears. | Decisions are written down as you work. |
| 4 | 0:28–0:40 | Split or switch to a shell. `ls /tmp/memoria-demo-store/memories/decisions/` then `cat` the new file. Frontmatter and body are readable. | The memory is a Markdown file. Yours. |
| 5 | 0:40–0:48 | `git -C /tmp/memoria-demo-store diff --stat` (initialise the store as a git repo before recording), then `git commit`. | Sync is git. |
| 6 | 0:48–0:55 | The dashboard's Wiki view on the same store, clicking from the decision to its backlink. | Browse it like a wiki. |
| 7 | 0:55–1:00 | End card: `marketing/images/card-install.png`. | *(none; the card has the commands)* |

If a take runs long, cut shot 6 first, then shot 5. Shots 1 to 4 are the
video.

## Shorter cuts

- **15 seconds, for an X reply or a README header:** shots 1, 2 and 4, with
  the captions.
- **No recording:** use the animated `video/demo.mp4` everywhere the clip is
  called for.

## Checks before publishing

- The answer in shot 2 really came from `memory_search`, and the tool call is
  on screen.
- Captions stay on screen at least two seconds each.
- It makes sense with the sound off and at phone width.
- Nothing in any frame is from your real store.
