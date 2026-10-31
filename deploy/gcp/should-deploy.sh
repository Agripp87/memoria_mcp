#!/usr/bin/env bash
# Decide whether a CI-passed commit may be deployed. Used by the example
# GitHub workflow (github-deploy.yml.example); run it inside the checkout.
#
#   should-deploy.sh <candidate-sha> <reference-sha>
#
# <reference-sha> is the current tip of main (or the commit production runs).
# The candidate is deployed only if it IS that commit or descends from it.
# CI runs for back-to-back pushes finish in any order, and a re-run of an old
# run fires the deploy again, so without this check an older commit could be
# deployed over a newer one, silently undoing a fix. The newest commit's own
# CI run deploys it when it finishes.
#
# Exit status: 0 deploy, 1 skip (the candidate is older than the reference,
# or on another line of history), 2 usage error or unknown commit. Needs the
# history of both commits (actions/checkout with fetch-depth: 0).

set -uo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <candidate-sha> <reference-sha>" >&2
  exit 2
fi

candidate="$(git rev-parse -q --verify "$1^{commit}" 2>/dev/null)" \
  || { echo "should-deploy: unknown commit $1" >&2; exit 2; }
reference="$(git rev-parse -q --verify "$2^{commit}" 2>/dev/null)" \
  || { echo "should-deploy: unknown commit $2" >&2; exit 2; }

if git merge-base --is-ancestor "$reference" "$candidate"; then
  echo "should-deploy: ${candidate:0:7} is ${reference:0:7} or newer — deploying"
  exit 0
fi
echo "should-deploy: ${candidate:0:7} is not ${reference:0:7} or a descendant of it — skipping (a newer commit's CI run deploys)"
exit 1
