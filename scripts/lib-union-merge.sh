# shellcheck shell=bash
# Sourced library (no shebang on purpose — callers `source` it).
# Shared by Memoria's git/object-store sync hooks (the reference hooks live in the
# maintainer's private store repo; see README "Multi-device sync").
#
# Append-union merge for append-only daily logs (2026-08-14, after five
# same-day SYNC CONFLICTs on daily/2026-08-13.md cost two session-written
# entries): when local and cloud both appended to the same daily log, the
# correct merge is mechanical — keep both sides' entries — so the hook does
# it instead of picking the cloud version and asking a human to dig the
# local one out of a commit. Non-daily files are NOT append-only and still
# take the loud-conflict path; callers must only pass memories/daily/*.md.
#
# Requires: $LOG_FILE set by the caller; run from the repo root.

# union_merge_daily <file>
#   base   = the file at refs/tags/gcs-synced (last state cloud saw from us)
#   ours   = the file at HEAD (local edits, committed by the caller)
#   theirs = the worktree copy (just pulled from GCS)
# On success the worktree holds the union and the function returns 0.
# Returns 1 (worktree untouched) if the tag/HEAD copy is missing or the
# merge errors — the caller falls back to the loud-conflict path.
union_merge_daily() {
  local f="$1" base ours rc
  base="$(mktemp)" || return 1
  ours="$(mktemp)" || { rm -f "$base"; return 1; }
  if ! git show "refs/tags/gcs-synced:$f" > "$base" 2>/dev/null \
     || ! git show "HEAD:$f" > "$ours" 2>/dev/null; then
    rm -f "$base" "$ours"
    return 1
  fi

  # merge-file writes the result into its first argument. Exit code is the
  # number of (union-resolved) conflict hunks, or >127 on real error.
  git merge-file --union "$ours" "$base" "$f" 2>>"$LOG_FILE"
  rc=$?
  if [ "$rc" -gt 127 ]; then
    rm -f "$base" "$ours"
    return 1
  fi

  # Union can duplicate frontmatter lines both sides edited (typically
  # `updated:` across midnight). Within the frontmatter block only, collapse
  # duplicate keys keeping the greatest value (ISO dates → newest wins).
  awk '
    NR==1 && $0=="---" { infm=1; print; next }
    infm {
      if ($0=="---") {
        for (i=1;i<=n;i++) print buf[i]
        print; infm=0; next
      }
      key=$0; sub(/:.*/,"",key)
      if (key in idx) { if ($0 > buf[idx[key]]) buf[idx[key]]=$0 }
      else { buf[++n]=$0; idx[key]=n }
      next
    }
    { print }
  ' "$ours" > "$f" || { rm -f "$base" "$ours"; return 1; }

  rm -f "$base" "$ours"
  return 0
}
