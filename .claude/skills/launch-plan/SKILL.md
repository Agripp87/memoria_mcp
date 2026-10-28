---
name: launch-plan
description: Plan and draft a Memoria announcement campaign for Twitter/X, Reddit and Medium — for a release, a tutorial/article, or a listing milestone.
argument-hint: "[version | topic, e.g. 0.3.0 or \"git sync tutorial\"]"
disable-model-invocation: true
context: fork
agent: oss-marketer
---

Plan and draft the campaign for: `$ARGUMENTS`.

## Gather

1. Read `devrel/fact-sheet.md`, `devrel/messaging.md`, `devrel/channels.md`.
2. If a DevRel brief exists (`devrel/drafts/release-<version>/brief.md` or a
   tutorial folder), it sets the key messages. If there is none for a release,
   stop and ask for `/release-kit <version>` first.
3. `memory_search` for previous campaigns and outcomes per channel
   (`marketing outcome twitter`, `marketing outcome reddit`, `marketing
   outcome medium`, `marketing feedback`). Note what worked, what flopped, and
   which angles were used recently.
4. Check each target subreddit's current rules (WebFetch its rules/sidebar
   page) and note any self-promotion limits, required flair or posting days.
   If a page cannot be fetched, say so in `plan.md` so the maintainer checks
   the rules by hand.

## Write to `devrel/drafts/launch-<slug>/`

- **`plan.md`** — goal of the campaign (e.g. "first-time installs from Claude
  Code users"), primary audience, angle per channel, and a day-by-day schedule
  over ~1–2 weeks (Medium article first if there is one, so posts can link to
  it; one subreddit per day; Twitter on launch day and a follow-up).
  Include how success will be judged (repo stars and npm downloads before vs.
  after, Reddit comments/upvotes, Medium reads) — the maintainer collects the
  numbers.
- **`twitter.md`** — a launch thread (4–8 posts; first post stands alone) plus
  1–2 single follow-up posts. Character counts noted. Alt text for media.
- **`reddit-<subreddit>.md`** — one per subreddit, each with its own angle,
  title, flair, and body written like a forum post: problem first, what it
  does, install in one code block, honest limitations, link, and the
  maintainer disclosure.
- **`medium.md`** — if the piece warrants an article: title, subtitle, TL;DR,
  full outline with the runnable examples DevRel provided (or a full draft if
  the brief has the material), limitations section, tags, canonical-URL note.
- **`listing.md`** — only if relevant: short/long descriptions for registries
  and awesome lists.

Each file starts with a header (channel, target, suggested date, media) and
ends with a **Claims** table.

## Finish

Run `/claims-check devrel/drafts/launch-<slug>` if you can and fix what it
flags; otherwise ask the maintainer to run it. Reply with the folder path, the
schedule summary, and any open questions for the developer advocate.
