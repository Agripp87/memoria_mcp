---
name: release-kit
description: Turn a Memoria CHANGELOG section into a release kit — GitHub release notes, a migration guide for breaking changes, and a brief for the marketer — verified against the code.
argument-hint: "[version | unreleased]"
disable-model-invocation: true
context: fork
agent: devrel-advocate
---

Build the release kit for Memoria version `$ARGUMENTS` (default: the
`[Unreleased]` section of `CHANGELOG.md`).

## Gather

1. Read that version's section of `CHANGELOG.md` in full, plus
   `devrel/fact-sheet.md` and `devrel/messaging.md`.
2. List the commits since the previous release tag (`git tag --sort=-v:refname`,
   then `git log --oneline <prev-tag>..HEAD`) and note anything user-visible that
   the CHANGELOG is missing. Report gaps; do not invent entries.
3. For each **breaking change**, find the code that implements it
   (`mcp-server/src/`, `docker-compose.yml`, `.env.example`, scripts) and confirm
   the exact env-var names, defaults, and error messages a user will see.
4. `memory_search` for past release-note feedback (`devrel release notes`).

## Write to `devrel/drafts/release-<version>/`

- **`release-notes.md`** — the GitHub release body. Order: one-paragraph
  summary; "Breaking changes" with the one action each user must take;
  highlights (3–5, user benefit first); fixes; install/upgrade commands (npm
  and plugin, exactly as in the README); link to the full CHANGELOG section.
- **`migration.md`** — only if there are breaking changes. For each: who is
  affected ("you use Docker Compose", "you set OPENAI_API_KEY"), the symptom
  they will see if they do nothing, the exact before → after config, and how to
  verify. Commands must be ones you ran against a demo store where possible.
- **`brief.md`** — the handoff to the `oss-marketer`: the 3 key messages in
  priority order, the audience for each, the links, suggested media (demo-store
  screenshots), and an explicit "do not say" list (e.g. anything still on the
  roadmap, security claims beyond the trust model).
- **`fact-sheet-updates.md`** — proposed edits to `devrel/fact-sheet.md`
  (version, new features) with sources, for the maintainer to apply.

Each file ends with a **Claims** table.

## Finish

Reply with: the folder path, any CHANGELOG gaps or code/CHANGELOG mismatches
you found, and the suggested next step — `/launch-plan <version>` for the
marketer, then `/claims-check devrel/drafts/launch-<version>`.
