#!/usr/bin/env bash
# Memoria sync: pull. Bring this device's memory store up to date with the
# shared remote. Intended for a Claude Code SessionStart hook, but it is a
# plain script — cron, a shell alias or a systemd timer work just as well.
#
# Requirements: the store ($MEMORIA_DIR, default ~/.memoria) is a git repo with
# a remote. Object storage is optional (see MEMORIA_SYNC_MIRROR below).
#
# Design notes, learned the hard way in the maintainer's own store:
#
#   * Unflushed local changes are COMMITTED before pulling, never used as a
#     reason to skip the pull. An earlier version skipped whenever the store
#     was dirty; that fired on one pull in three, so sessions routinely started
#     stale and then pushed the stale state back over newer files. Committing
#     first makes local work unlosable, so the pull is always safe to run.
#   * Daily logs are append-only, so a both-sides edit has a mechanical
#     resolution: keep both sides' lines. That is exactly git's built-in
#     `union` merge driver, enabled by the .gitattributes in store-template/.
#     Set it up once and same-day edits from two machines merge silently.
#   * Every step fails soft. A hook that blocks a session because the network
#     is down is worse than a stale memory.
#   * A merge or rebase the user has open is left alone. Step 1 below used to
#     run `git add memories/ && git commit` in the middle of one, which marked
#     the conflicted files resolved WITH their conflict markers and concluded
#     the merge; the next push then published the markers to every device.
#     Pull and push also share one store-level lock, so neither commits while
#     the other is half way through a merge.
#
# Environment:
#   MEMORIA_DIR           store root (default: ~/.memoria)
#   MEMORIA_SYNC_REMOTE   git remote name (default: origin)
#   MEMORIA_SYNC_BRANCH   branch (default: the store's current branch)
#   MEMORIA_SYNC_MIRROR   optional path to an executable that mirrors an object
#                         store; called as `<script> pull "$MEMORIA_DIR"` before
#                         the git merge. Only honoured when
#                         MEMORIA_SYNC_ALLOW_STORE_MIRROR=true: the mirror lives
#                         inside the synced store, so executing it by default
#                         would let anyone who can land a file in the store run
#                         code in your shell (review M2). A file the mirror
#                         brings down replaces the local copy only when it
#                         extends it (the bucket appended to it); otherwise the
#                         local copy is kept and the file is logged.
#   MEMORIA_SYNC_LOG      log file (default: $MEMORIA_DIR/.sync.log)
#   MEMORIA_SYNC_LOCK_WAIT_S  seconds to wait for the store's sync lock while
#                         another pull or push holds it (default 20)

set -uo pipefail

STORE="${MEMORIA_DIR:-$HOME/.memoria}"
REMOTE="${MEMORIA_SYNC_REMOTE:-origin}"
LOG_FILE="${MEMORIA_SYNC_LOG:-$STORE/.sync.log}"
MIRROR="${MEMORIA_SYNC_MIRROR:-$STORE/.memoria-mirror.sh}"

# Claude Code reads stdout as the hook response, so emit a valid one no matter
# how this exits. Everything else goes to the log.
trap 'release_sync_lock; echo "{\"continue\": true}"' EXIT

log() {
  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null
  echo "[$(date -Iseconds)] pull: $*" >> "$LOG_FILE" 2>/dev/null
}

# One lock per store, shared with memoria-sync-push.sh, so a push can never
# commit in the middle of this script's merge (and the reverse). A directory,
# because mkdir is atomic everywhere and macOS has no flock binary. It holds
# the holder's pid: a lock whose process is gone, or that is over ten
# minutes old (a reused pid), is stale and is taken over.
SYNC_LOCK=""
acquire_sync_lock() { # <seconds to wait>
  local lock holder waited=0
  lock="$(git rev-parse --git-path memoria-sync.lock 2>/dev/null)" || return 1
  [ -n "$lock" ] || return 1
  while ! mkdir "$lock" 2>/dev/null; do
    holder=""
    read -r holder < "$lock/pid" 2>/dev/null || true
    if { [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; } \
      || [ -n "$(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ] \
      || { [ -z "$holder" ] && [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ]; }; then
      log "removing a stale sync lock (holder ${holder:-unknown} is gone)"
      rm -rf "$lock" 2>/dev/null
      continue
    fi
    [ "$waited" -ge "$1" ] && return 1
    sleep 1
    waited=$((waited + 1))
  done
  echo "$$" > "$lock/pid"
  SYNC_LOCK="$lock"
}
release_sync_lock() {
  [ -n "$SYNC_LOCK" ] || return 0
  [ "$(cat "$SYNC_LOCK/pid" 2>/dev/null)" = "$$" ] && rm -rf "$SYNC_LOCK" 2>/dev/null
  SYNC_LOCK=""
}

# A merge, cherry-pick, revert or rebase is in progress, or the index still
# has unmerged paths. Nothing may be committed then: `git add` would mark the
# conflicted files resolved with their markers in place.
git_busy() {
  local r
  for r in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD REBASE_HEAD; do
    git rev-parse -q --verify "$r" >/dev/null 2>&1 && return 0
  done
  [ -d "$(git rev-parse --git-path rebase-merge 2>/dev/null)" ] && return 0
  [ -d "$(git rev-parse --git-path rebase-apply 2>/dev/null)" ] && return 0
  [ -n "$(git ls-files -u 2>/dev/null)" ]
}

if [ ! -d "$STORE/.git" ]; then
  log "no git repo at $STORE — nothing to sync (see scripts/sync/README.md)"
  exit 0
fi

cd "$STORE" || { log "cannot cd to $STORE"; exit 0; }

if ! acquire_sync_lock "${MEMORIA_SYNC_LOCK_WAIT_S:-20}"; then
  log "another sync holds the lock in $STORE — skipping this pull"
  exit 0
fi
if git_busy; then
  log "merge/rebase in progress in $STORE — not committing or pulling; finish it (git commit, or git merge --abort), then re-run"
  exit 0
fi

BRANCH="${MEMORIA_SYNC_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null)}"
if [ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ]; then
  BRANCH="main"
fi

# 1. Commit anything unflushed, so the merge below can never lose local work.
if [ -n "$(git status --porcelain -- memories/ 2>/dev/null)" ]; then
  git add memories/ 2>>"$LOG_FILE"
  if git commit -q -m "Memoria: pre-pull snapshot of unflushed local changes" 2>>"$LOG_FILE"; then
    log "committed unflushed local changes before pulling"
  else
    log "pre-pull commit failed — continuing (nothing staged?)"
  fi
fi

# 2. Optional object-storage mirror (GCS/S3/rclone/Syncthing/whatever). The
#    script owns its own tooling; we only care about its exit code. Opt-in
#    only: the default path is inside the synced store (see header, M2).
if [ "${MEMORIA_SYNC_ALLOW_STORE_MIRROR:-}" != "true" ] && [ -x "$MIRROR" ]; then
  log "mirror at $MIRROR not run: set MEMORIA_SYNC_ALLOW_STORE_MIRROR=true to allow executing a script from the synced store"
fi
if [ "${MEMORIA_SYNC_ALLOW_STORE_MIRROR:-}" = "true" ] && [ -x "$MIRROR" ]; then
  if "$MIRROR" pull "$STORE" >>"$LOG_FILE" 2>&1; then
    log "mirror pull OK"
    # The mirror copies the bucket's files over the worktree, which is not a
    # merge: committing that on top of step 1 reverted every local change the
    # bucket did not have yet, and the next push spread the revert. So a file
    # the mirror changed is taken only when the bucket copy EXTENDS the local
    # one (the hosted server appended to it). A file changed on both sides
    # keeps its local copy and is logged; the bucket keeps its own. Files new
    # to the store are taken as they are.
    kept=""
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      size="$(git cat-file -s "HEAD:$f" 2>/dev/null)" || continue
      if ! head -c "$size" -- "$f" 2>/dev/null | cmp -s - <(git show "HEAD:$f" 2>/dev/null); then
        git checkout -q HEAD -- "$f" 2>>"$LOG_FILE" && kept="$kept $f"
      fi
    done <<MIRRORED
$(git diff --name-only -- memories/ 2>/dev/null)
MIRRORED
    if [ -n "$kept" ]; then
      log "mirror: kept the local copy of files changed on both sides (merge by hand from the bucket):$kept"
    fi
    # Commit whatever it brought down before merging the git remote on top.
    if [ -n "$(git status --porcelain -- memories/ 2>/dev/null)" ]; then
      git add memories/ 2>>"$LOG_FILE"
      git commit -q -m "Memoria: changes pulled from the object-storage mirror" 2>>"$LOG_FILE" \
        && log "committed mirror changes"
    fi
  else
    log "mirror pull failed — continuing with git only"
  fi
fi

# 3. Fetch and merge. A merge (not a rebase) is what puts the union driver in
#    play for daily logs: it is a single three-way merge against the merge
#    base, where a rebase would replay each local commit in turn.
if ! git fetch --quiet "$REMOTE" 2>>"$LOG_FILE"; then
  log "fetch failed (offline?) — continuing"
  exit 0
fi

if ! git rev-parse -q --verify "$REMOTE/$BRANCH" >/dev/null 2>&1; then
  log "$REMOTE/$BRANCH does not exist — nothing to merge"
  exit 0
fi

BEHIND="$(git rev-list --count "HEAD..$REMOTE/$BRANCH" 2>/dev/null || echo 0)"
if [ "$BEHIND" = "0" ]; then
  log "already up to date with $REMOTE/$BRANCH"
  exit 0
fi

if git merge --no-edit "$REMOTE/$BRANCH" >>"$LOG_FILE" 2>&1; then
  log "merged $BEHIND commit(s) from $REMOTE/$BRANCH"
  exit 0
fi

# 4. Merge failed. With the union driver configured this should only happen for
#    non-daily files. Abort so the session starts from a consistent tree, and
#    write a loud note into today's log so it is impossible to miss. "Today"
#    is the UTC day, as for every log the server writes (daily-format.ts):
#    the local date put the note in the wrong day's log, or in none.
CONFLICTS="$(git diff --name-only --diff-filter=U 2>/dev/null)"
if [ -z "$CONFLICTS" ]; then
  # No conflicted paths: the merge failed for some other reason (a dirty
  # worktree, a bad ref, a hook). Do not cry conflict — the log has the error.
  git merge --abort 2>/dev/null
  log "merge from $REMOTE/$BRANCH failed with no conflicted paths — see the git error above"
  exit 0
fi

# 4a. Conflicts only in GENERATED files resolve themselves: Memoria rewrites
#     MEMORY_INDEX.md and auto-compiled entity pages from the memory files,
#     so either side will do and the next regeneration is exact. Leaving
#     these to a human stalled sync between two devices for good: every pull
#     re-conflicted, every push was rejected.
#     A page counts as generated only if BOTH sides carry the marker in their
#     frontmatter: a page a human took over (marker removed) on either
#     device, or a note that merely mentions the marker in its body, is a
#     real conflict and is left for a person.
has_generated_marker() { # <stage> <path>: frontmatter has `generated: auto-compiled`
  git show ":$1:$2" 2>/dev/null | awk '
    NR == 1 { if ($0 != "---") exit 1; next }
    $0 == "---" { exit found ? 0 : 1 }
    $0 == "generated: auto-compiled" { found = 1 }
    END { if (NR <= 1) exit 1 }
  '
}
generated_only=1
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ "$f" = "memories/MEMORY_INDEX.md" ] \
    || { has_generated_marker 2 "$f" && has_generated_marker 3 "$f"; }; then
    if ! { git checkout --ours -- "$f" && git add -- "$f"; } 2>>"$LOG_FILE"; then
      generated_only=0
    fi
  else
    generated_only=0
  fi
done <<CONFLICT_LIST
$CONFLICTS
CONFLICT_LIST
if [ "$generated_only" = "1" ] && [ -z "$(git diff --name-only --diff-filter=U 2>/dev/null)" ]; then
  if git commit -q --no-edit 2>>"$LOG_FILE"; then
    log "merged $BEHIND commit(s) from $REMOTE/$BRANCH; kept this device's copy of generated file(s): $(echo "$CONFLICTS" | tr '\n' ' ')"
    exit 0
  fi
fi

git merge --abort 2>>"$LOG_FILE"
log "SYNC CONFLICT — merge aborted. Conflicting: $(echo "$CONFLICTS" | tr '\n' ' ')"

TODAY="$(date -u +%Y-%m-%d)"
DAILY_DIR="$STORE/memories/daily"
TODAY_LOG="$DAILY_DIR/$TODAY.md"
# A pulled symlink would turn this append into a write outside the store, so
# a symlinked daily/ or log is refused, as the server refuses one
# (daily-paths.ts). The note is then only in the sync log.
if [ -L "$DAILY_DIR" ] || [ -L "$TODAY_LOG" ] || { [ -e "$TODAY_LOG" ] && [ ! -f "$TODAY_LOG" ]; }; then
  log "conflict note not written: memories/daily/$TODAY.md or daily/ is not a regular file"
  exit 0
fi
# The first session of a UTC day starts before anything has written its log,
# so create it, with the frontmatter the server gives a new daily log.
if [ ! -e "$TODAY_LOG" ] && mkdir -p "$DAILY_DIR" 2>>"$LOG_FILE"; then
  {
    echo "---"
    echo "name: Daily log $TODAY"
    echo "description: Daily log for $TODAY"
    echo "type: session"
    echo "importance: 5"
    echo "created: $TODAY"
    echo "updated: $TODAY"
    echo "last_accessed: $TODAY"
    echo "access_count: 0"
    echo "tags: [daily]"
    echo "---"
    echo ""
    echo "# Daily Log — $TODAY"
  } > "$TODAY_LOG" 2>>"$LOG_FILE"
fi
if [ -f "$TODAY_LOG" ]; then
  {
    echo ""
    echo "## $(date -u +%H:%M) UTC — SYNC CONFLICT (memoria-sync-pull)"
    echo ""
    echo "\`git merge $REMOTE/$BRANCH\` conflicted and was aborted, so this device is"
    echo "still on its local version. Merge it by hand and commit, then re-run the pull:"
    echo ""
    echo "$CONFLICTS" | sed 's/^/- `/;s/$/`/'
    echo ""
    echo "If these are daily logs, the union merge driver is not configured —"
    echo "see scripts/sync/README.md."
  } >> "$TODAY_LOG"
fi

exit 0
