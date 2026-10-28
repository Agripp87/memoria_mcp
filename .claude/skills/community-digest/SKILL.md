---
name: community-digest
description: Weekly Memoria community digest — triage new and updated GitHub issues, PRs and Discussions, draft replies, and propose docs fixes and good first issues.
argument-hint: "[days, default 7]"
disable-model-invocation: true
context: fork
agent: devrel-advocate
---

Produce the community digest for the last `$ARGUMENTS` days (default 7) for
`Agripp87/memoria_mcp`.

## Gather

1. Issues and PRs updated in the window: `list_issues` / `search_issues`
   (`repo:Agripp87/memoria_mcp updated:>=<date>`) and `list_pull_requests`;
   read each one in full with `issue_read` / `pull_request_read`, comments
   included.
2. Discussions: fetch https://github.com/Agripp87/memoria_mcp/discussions with
   WebFetch (public page) and open the threads active in the window.
3. `memory_search` for earlier digests and decisions on recurring topics
   (`devrel digest`, the topic's keywords).

## Triage

Classify each item: `bug`, `question`, `feature-request`, `docs-gap`,
`contributor-PR`, `good-first-issue candidate`, `security-sensitive`, `no
action`. For each actionable item:

- **Questions / bugs:** draft a reply. Reproduce bugs against a demo store
  (`npm run demo:gen -- --out <tmp>`) where feasible and say what you ran. Link
  the exact README / SECURITY section. Name a known limitation plainly when
  that is the answer.
- **Feature requests:** check them against the Roadmap and Design Decisions;
  draft a reply that says where it stands. Large changes → point to
  "open an issue first" in `CONTRIBUTING.md`.
- **Contributor PRs:** draft a warm first response noting the PR checklist
  items still missing (tests, DCO sign-off, docs). Do not review the code in
  depth unless asked.
- **Security-sensitive:** never draft a public reply about the substance.
  Draft only a pointer to private vulnerability reporting and flag it at the
  top of the digest.

## Write `devrel/drafts/digest-<YYYY-MM-DD>.md`

1. **Needs the maintainer now** (security-sensitive, regressions, blocked
   contributors).
2. **Drafted replies** — one section per item: link, classification, one-line
   summary, the reply ready to paste.
3. **Docs gaps** — questions that more than one person asked, or that the
   README answers badly, with a proposed README/FAQ change.
4. **Good first issue proposals** — title, body, acceptance criteria, files to
   touch (from the Roadmap and Known Limitations, plus anything found this
   week).
5. **Trends** — one paragraph: what people are trying to do with Memoria.
   Hand anything with marketing value (recurring use cases, confusion about
   positioning) to the marketer as bullet points.

Never include usernames or personal details beyond the issue link. After the
maintainer reviews the digest, add a one-line `memory_daily` entry starting
with `[devrel] digest` summarising counts and themes.
