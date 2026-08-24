<!--
No personal data in this PR: no real memory files, keys, tokens, hostnames, or
personal identifiers — in the diff, the description, or the commit messages.
Need realistic data? `cd mcp-server && npm run demo:gen -- --out /tmp/store`.
-->

## What this changes

<!-- One or two sentences. Link the issue this implements, if there is one. -->

## Why

<!-- The problem being solved. For a bug fix, the root cause — not just the symptom. -->

## Checklist

- [ ] `npm test` passes and behavior changes are covered by tests
- [ ] `npm run build` succeeds (TypeScript strict)
- [ ] `npm run lint` and `npm run format:check` are clean
- [ ] Commits are signed off (`git commit -s`) per the [DCO](https://developercertificate.org/)
- [ ] Docs updated if behavior changed (env-var table / tool table / `SECURITY.md`)
- [ ] No personal data anywhere in this PR

## Anything touching auth, crypto, consent or privacy tiers?

<!--
If yes, describe the threat you considered and why the change is safe. If no,
delete this section. These areas get a slower review — see CONTRIBUTING.md.
-->
