---
name: claims-check
description: Fact-check a Memoria DevRel or marketing draft (a file or a folder under devrel/drafts/) against the fact sheet, the README/CHANGELOG/SECURITY docs and the code. Flags unsourced claims, overclaims, forbidden phrases, missing disclosures and personal data.
when_to_use: Before any draft goes to the maintainer for publishing, and whenever someone asks whether a post, article or release note is accurate.
argument-hint: "[path under devrel/drafts/]"
context: fork
agent: devrel-advocate
---

Fact-check the draft(s) at `$ARGUMENTS` (a file or a folder; if empty, the most
recently modified folder under `devrel/drafts/`).

Read `devrel/fact-sheet.md`, `devrel/messaging.md` and `devrel/channels.md`
first. Then, for every draft file:

1. **Extract every factual claim** — numbers, versions, features, commands,
   compatibility, security/privacy statements, comparisons, roadmap mentions.
2. **Verify each one** against the fact sheet, then against the file it cites
   (and the code when the claim is about behaviour). Commands must match the
   README exactly or be ones you have just run. A claim about another project
   needs a link to that project's current docs.
3. **Check the rules:**
   - forbidden claims and hype words from `devrel/messaging.md`;
   - roadmap items stated as available;
   - security wording without the single-tenant / single-key scope; collector
     mentioned without "experimental";
   - channel rules from `devrel/channels.md` (length, disclosure that the
     author is the maintainer, links, hashtags, subreddit fit);
   - personal data of any kind (real names other than the "Alex Rivera" demo
     persona, hostnames, keys, tokens, real memory content);
   - a **Claims** table present at the end of the draft.

Write the result to `claims-check.md` in the same folder (or next to the file):

```markdown
# Claims check — <path> — <date>

Verdict: PASS | PASS WITH FIXES | FAIL

| # | File | Claim / passage | Status | Source / problem | Suggested fix |
|---|------|-----------------|--------|------------------|---------------|
```

Status is one of `ok`, `unsourced`, `wrong`, `overclaim`, `rule`, `personal-data`.
Any `wrong` or `personal-data` row makes the verdict FAIL.

Do not rewrite the drafts yourself; report. Reply with the verdict, the count
of issues by status, and the path to `claims-check.md`.
