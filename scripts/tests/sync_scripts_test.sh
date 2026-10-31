#!/usr/bin/env bash
# Behavioural tests for the sync scripts (review M2/M3).
# Run: bash scripts/tests/sync_scripts_test.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0
check() { # check <label> <condition...>
  local label="$1"; shift
  if "$@"; then echo "ok - $label"; else echo "FAIL - $label"; fail=1; fi
}

# ── M3: sync-from-claude-memory never overwrites a newer destination ──
SRC="$TMP/claude"; DEST="$TMP/memoria"
mkdir -p "$SRC" "$DEST/memories/project"
printf -- '---\ntype: project\n---\n\nnewer memoria body\n' > "$DEST/memories/project/note.md"
printf -- '---\ntype: project\n---\n\nstale claude body\n' > "$SRC/note.md"
touch -d '2020-01-01' "$SRC/note.md"
touch -d '2026-01-01' "$DEST/memories/project/note.md"
MEMORIA_DIR="$DEST" bash "$REPO_ROOT/scripts/sync-from-claude-memory.sh" "$SRC" >"$TMP/out1" 2>&1
grep -q 'newer memoria body' "$DEST/memories/project/note.md"
check "M3: newer destination preserved" test $? -eq 0

# Newer source DOES overwrite, and leaves a backup of the old destination.
printf -- '---\ntype: project\n---\n\nfresh claude body\n' > "$SRC/note.md"
touch -d '2027-01-01' "$SRC/note.md"
MEMORIA_DIR="$DEST" bash "$REPO_ROOT/scripts/sync-from-claude-memory.sh" "$SRC" >"$TMP/out2" 2>&1
grep -q 'fresh claude body' "$DEST/memories/project/note.md"
check "M3: newer source wins" test $? -eq 0
ls "$DEST/memories/project/"note.md.bak-* >/dev/null 2>&1
check "M3: backup of overwritten file exists" test $? -eq 0

# Dry-run writes nothing.
printf -- '---\ntype: project\n---\n\ndry run body\n' > "$SRC/dry.md"
touch -d '2027-01-01' "$SRC/dry.md"
MEMORIA_DIR="$DEST" bash "$REPO_ROOT/scripts/sync-from-claude-memory.sh" --dry-run "$SRC" >"$TMP/out3" 2>&1
check "M3: dry-run does not write" test ! -f "$DEST/memories/project/dry.md"

# ── M2: the pull hook must not execute a mirror from the synced store ──
STORE="$TMP/store"
mkdir -p "$STORE"
git -C "$STORE" init -q
git -C "$STORE" config user.email t@t; git -C "$STORE" config user.name t
mkdir -p "$STORE/memories"
echo x > "$STORE/memories/a.md"
git -C "$STORE" add -A; git -C "$STORE" commit -qm init
printf '#!/bin/sh\necho ran >> "%s/mirror-ran"\n' "$STORE" > "$STORE/.memoria-mirror.sh"
chmod +x "$STORE/.memoria-mirror.sh"
MEMORIA_DIR="$STORE" bash "$REPO_ROOT/scripts/sync/memoria-sync-pull.sh" >"$TMP/out4" 2>&1
check "M2: store mirror not executed by default" test ! -f "$STORE/mirror-ran"
MEMORIA_DIR="$STORE" MEMORIA_SYNC_ALLOW_STORE_MIRROR=true bash "$REPO_ROOT/scripts/sync/memoria-sync-pull.sh" >"$TMP/out5" 2>&1
check "M2: store mirror runs only with explicit opt-in" test -f "$STORE/mirror-ran"

# ── H-01: the push hook must apply the same mirror gate as pull ──
# Push reaches the mirror step when it has committed something (no remote
# is configured here, so the git push itself fails soft and step 4 runs).
rm -f "$STORE/mirror-ran"
echo y >> "$STORE/memories/a.md"
MEMORIA_DIR="$STORE" MEMORIA_SYNC_INTERVAL_S=0 bash "$REPO_ROOT/scripts/sync/memoria-sync-push.sh" >"$TMP/out6" 2>&1
check "H-01: store mirror not executed by push by default" test ! -f "$STORE/mirror-ran"
echo z >> "$STORE/memories/a.md"
MEMORIA_DIR="$STORE" MEMORIA_SYNC_INTERVAL_S=0 MEMORIA_SYNC_ALLOW_STORE_MIRROR=true bash "$REPO_ROOT/scripts/sync/memoria-sync-push.sh" >"$TMP/out7" 2>&1
check "mirror: push does not run the mirror without MEMORIA_SYNC_MIRROR_PUSH" test ! -f "$STORE/mirror-ran"
echo w >> "$STORE/memories/a.md"
MEMORIA_DIR="$STORE" MEMORIA_SYNC_INTERVAL_S=0 MEMORIA_SYNC_ALLOW_STORE_MIRROR=true MEMORIA_SYNC_MIRROR_PUSH=true \
  bash "$REPO_ROOT/scripts/sync/memoria-sync-push.sh" >"$TMP/out7" 2>&1
check "H-01: store mirror runs on push only with explicit opt-in" test -f "$STORE/mirror-ran"

# ── A deferred push is not stranded until a later turn ──
# A push inside the interval used to wait for the next Stop hook, which may
# never come (the session ended), leaving the last commits on this device.
REMOTE="$TMP/remote.git"
git init -q --bare "$REMOTE"
git -C "$STORE" remote add origin "$REMOTE"
BR="$(git -C "$STORE" rev-parse --abbrev-ref HEAD)"
git -C "$STORE" push -q origin "$BR"
# A push 27s ago with a 30s interval: deferred, with ~3s to spare for the
# "not pushed yet" check (whole-second clocks made a 2s interval flaky).
touch -d "@$(( $(date +%s) - 27 ))" "$STORE/.last-sync"
echo deferred >> "$STORE/memories/a.md"
MEMORIA_DIR="$STORE" MEMORIA_SYNC_INTERVAL_S=30 bash "$REPO_ROOT/scripts/sync/memoria-sync-push.sh" >"$TMP/out8" 2>&1
LOCAL_HEAD="$(git -C "$STORE" rev-parse HEAD)"
check "deferral: not pushed inside the interval" test "$(git -C "$REMOTE" rev-parse "$BR")" != "$LOCAL_HEAD"
check "deferral: one background push scheduled" test -f "$STORE/.sync-push-pending"
for _ in $(seq 1 15); do
  [ "$(git -C "$REMOTE" rev-parse "$BR")" = "$LOCAL_HEAD" ] && break
  sleep 1
done
check "deferral: the scheduled push reached the remote" test "$(git -C "$REMOTE" rev-parse "$BR")" = "$LOCAL_HEAD"
for _ in 1 2 3; do [ -f "$STORE/.sync-push-pending" ] || break; sleep 1; done
check "deferral: the pending marker is cleared" test ! -f "$STORE/.sync-push-pending"

# ── Conflicts only in generated files resolve themselves ──
# Two devices both regenerate MEMORY_INDEX.md (a store set up without the
# union line for it): the pull used to abort the merge on every run.
ORIGIN="$TMP/gen-origin.git"; DEV_A="$TMP/dev-a"; DEV_B="$TMP/dev-b"
git init -q --bare "$ORIGIN"
git clone -q "$ORIGIN" "$DEV_A" 2>/dev/null
git -C "$DEV_A" config user.email t@t; git -C "$DEV_A" config user.name t
mkdir -p "$DEV_A/memories/project"
printf 'index v0\n' > "$DEV_A/memories/MEMORY_INDEX.md"
printf 'core v0\n' > "$DEV_A/memories/project/core.md"
git -C "$DEV_A" add -A; git -C "$DEV_A" commit -qm base; git -C "$DEV_A" push -q origin HEAD 2>/dev/null
GBR="$(git -C "$DEV_A" rev-parse --abbrev-ref HEAD)"
git clone -q "$ORIGIN" "$DEV_B" 2>/dev/null
git -C "$DEV_B" config user.email t@t; git -C "$DEV_B" config user.name t
printf 'index from A\n' > "$DEV_A/memories/MEMORY_INDEX.md"
git -C "$DEV_A" commit -qam "A"; git -C "$DEV_A" push -q origin HEAD 2>/dev/null
printf 'index from B\n' > "$DEV_B/memories/MEMORY_INDEX.md"
git -C "$DEV_B" commit -qam "B"
MEMORIA_DIR="$DEV_B" bash "$REPO_ROOT/scripts/sync/memoria-sync-pull.sh" >/dev/null 2>&1
check "generated: merge completed" test "$(git -C "$DEV_B" rev-list --count "HEAD..origin/$GBR")" = "0"
check "generated: no merge left in progress" test ! -f "$DEV_B/.git/MERGE_HEAD"

# A page a human took over on one device (marker removed), or a note that
# only mentions the marker in its body, is a real conflict: never resolved
# by keeping one side.
mkdir -p "$DEV_A/memories/entities" "$DEV_A/memories/notes"
printf -- '---\nname: x\ngenerated: auto-compiled\n---\nv0\n' > "$DEV_A/memories/entities/x.md"
printf -- '---\nname: n\n---\n```\ngenerated: auto-compiled\n```\nv0\n' > "$DEV_A/memories/notes/n.md"
git -C "$DEV_A" add -A; git -C "$DEV_A" commit -qm pages; git -C "$DEV_A" push -q origin HEAD 2>/dev/null
MEMORIA_DIR="$DEV_B" bash "$REPO_ROOT/scripts/sync/memoria-sync-pull.sh" >/dev/null 2>&1
# A takes the page over and curates it; B (the pulling device) regenerates
# it. Keeping B's side would silently drop A's curation.
printf -- '---\nname: x\n---\ncurated by a human on A\n' > "$DEV_A/memories/entities/x.md"
printf -- '---\nname: n\n---\n```\ngenerated: auto-compiled\n```\nA edit\n' > "$DEV_A/memories/notes/n.md"
git -C "$DEV_A" commit -qam "A pages"; git -C "$DEV_A" push -q origin HEAD 2>/dev/null
printf -- '---\nname: x\ngenerated: auto-compiled\n---\nregenerated on B\n' > "$DEV_B/memories/entities/x.md"
printf -- '---\nname: n\n---\n```\ngenerated: auto-compiled\n```\nB edit\n' > "$DEV_B/memories/notes/n.md"
git -C "$DEV_B" commit -qam "B pages"
MEMORIA_DIR="$DEV_B" bash "$REPO_ROOT/scripts/sync/memoria-sync-pull.sh" >/dev/null 2>&1
check "human edits elsewhere: not auto-resolved away (merge aborted)" \
  test "$(git -C "$DEV_B" merge-base --is-ancestor "origin/$GBR" HEAD && echo merged)" != "merged"
check "human edits elsewhere: no merge left in progress" test ! -f "$DEV_B/.git/MERGE_HEAD"
git -C "$DEV_B" reset -q --hard "origin/$GBR" # start the next case from the remote

# A conflict in a real memory still stops for a human.
printf 'core from A\n' > "$DEV_A/memories/project/core.md"
git -C "$DEV_A" commit -qam "A core"; git -C "$DEV_A" push -q origin HEAD 2>/dev/null
printf 'core from B\n' > "$DEV_B/memories/project/core.md"
git -C "$DEV_B" commit -qam "B core"
MEMORIA_DIR="$DEV_B" bash "$REPO_ROOT/scripts/sync/memoria-sync-pull.sh" >/dev/null 2>&1
check "core conflict: merge aborted, local version kept" grep -q 'core from B' "$DEV_B/memories/project/core.md"
check "core conflict: logged" grep -q 'SYNC CONFLICT' "$DEV_B/.sync.log"

# ── A merge the user has open is never committed by a hook ──
# The conflict note says "resolve by hand", so the user runs the merge. The
# push (Stop hook, or a deferred push) and the pull (a new session) used to
# `git add` the conflicted file, markers and all, conclude the merge and
# publish the markers to every device.
git -C "$DEV_B" merge "origin/$GBR" >/dev/null 2>&1
B_HEAD="$(git -C "$DEV_B" rev-parse HEAD)"
MEMORIA_DIR="$DEV_B" MEMORIA_SYNC_INTERVAL_S=0 bash "$REPO_ROOT/scripts/sync/memoria-sync-push.sh" >/dev/null 2>&1
MEMORIA_DIR="$DEV_B" bash "$REPO_ROOT/scripts/sync/memoria-sync-pull.sh" >/dev/null 2>&1
check "open merge: MERGE_HEAD kept" test -f "$DEV_B/.git/MERGE_HEAD"
check "open merge: conflicted entries still unmerged" test -n "$(git -C "$DEV_B" ls-files -u)"
check "open merge: HEAD not moved" test "$(git -C "$DEV_B" rev-parse HEAD)" = "$B_HEAD"
check "open merge: no conflict markers on the remote" \
  test -z "$(git --git-dir="$ORIGIN" show "$GBR:memories/project/core.md" | grep '<<<<<<<')"
check "open merge: logged" grep -q 'merge/rebase in progress' "$DEV_B/.sync.log"
git -C "$DEV_B" merge --abort

# ── The conflict note goes into the UTC day's log, creating it ──
# Daily logs are UTC days. The note used the local date, and was skipped
# when that log did not exist yet. Kiritimati (UTC+14) and Pago Pago
# (UTC-11) are 25 hours apart, so at any moment at least one of them is on
# a different date from UTC.
UTC_DAY="$(date -u +%Y-%m-%d)"
UTC_LOG="$DEV_B/memories/daily/$UTC_DAY.md"
rm -rf "$DEV_B/memories/daily"
TZ=Pacific/Kiritimati MEMORIA_DIR="$DEV_B" bash "$REPO_ROOT/scripts/sync/memoria-sync-pull.sh" >/dev/null 2>&1
check "conflict note: missing UTC log created with frontmatter" grep -q "^name: Daily log $UTC_DAY\$" "$UTC_LOG"
check "conflict note: UTC heading (Kiritimati)" grep -q '^## [0-9][0-9]:[0-9][0-9] UTC — SYNC CONFLICT' "$UTC_LOG"
TZ=Pacific/Pago_Pago MEMORIA_DIR="$DEV_B" bash "$REPO_ROOT/scripts/sync/memoria-sync-pull.sh" >/dev/null 2>&1
check "conflict note: UTC log again (Pago Pago)" test "$(grep -c 'UTC — SYNC CONFLICT' "$UTC_LOG")" = "2"
check "conflict note: no log under a local date" test "$(ls "$DEV_B/memories/daily")" = "$UTC_DAY.md"
# A symlinked log (a pulled one can point anywhere) is never written through.
echo outside > "$TMP/outside.txt"
rm -f "$UTC_LOG"; ln -s "$TMP/outside.txt" "$UTC_LOG"
MEMORIA_DIR="$DEV_B" bash "$REPO_ROOT/scripts/sync/memoria-sync-pull.sh" >/dev/null 2>&1
check "conflict note: symlinked log left untouched" test "$(cat "$TMP/outside.txt")" = "outside"
check "conflict note: symlink refusal logged" grep -q 'conflict note not written' "$DEV_B/.sync.log"

# ── One sync at a time per store ──
# A push started while a pull held the store (mid-merge) used to commit in
# between. The lock is a directory with the holder's pid; a lock whose
# holder is gone is taken over.
LOCKSTORE="$TMP/lockstore"
git init -q "$LOCKSTORE"
git -C "$LOCKSTORE" config user.email t@t; git -C "$LOCKSTORE" config user.name t
mkdir -p "$LOCKSTORE/memories"; echo a > "$LOCKSTORE/memories/a.md"
git -C "$LOCKSTORE" add -A; git -C "$LOCKSTORE" commit -qm init
L_HEAD="$(git -C "$LOCKSTORE" rev-parse HEAD)"
sleep 60 & HOLDER=$!
mkdir "$LOCKSTORE/.git/memoria-sync.lock"; echo "$HOLDER" > "$LOCKSTORE/.git/memoria-sync.lock/pid"
echo b >> "$LOCKSTORE/memories/a.md"
MEMORIA_DIR="$LOCKSTORE" MEMORIA_SYNC_INTERVAL_S=0 MEMORIA_SYNC_LOCK_WAIT_S=1 \
  bash "$REPO_ROOT/scripts/sync/memoria-sync-push.sh" >/dev/null 2>&1
check "lock: push does not commit while another sync holds the lock" \
  test "$(git -C "$LOCKSTORE" rev-parse HEAD)" = "$L_HEAD"
check "lock: push retry scheduled" test -f "$LOCKSTORE/.sync-push-pending"
# Cancel that retry; the next case runs the push by hand.
PENDING_PID=""
{ read -r PENDING_PID _ < "$LOCKSTORE/.sync-push-pending"; } 2>/dev/null
[ -n "$PENDING_PID" ] && kill "$PENDING_PID" 2>/dev/null
rm -f "$LOCKSTORE/.sync-push-pending"
MEMORIA_DIR="$LOCKSTORE" MEMORIA_SYNC_LOCK_WAIT_S=1 bash "$REPO_ROOT/scripts/sync/memoria-sync-pull.sh" >/dev/null 2>&1
check "lock: pull skips while another sync holds the lock" \
  test "$(git -C "$LOCKSTORE" rev-parse HEAD)" = "$L_HEAD"
kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
MEMORIA_DIR="$LOCKSTORE" MEMORIA_SYNC_INTERVAL_S=0 MEMORIA_SYNC_LOCK_WAIT_S=1 \
  bash "$REPO_ROOT/scripts/sync/memoria-sync-push.sh" >/dev/null 2>&1
check "lock: a stale lock (holder gone) is taken over" \
  test "$(git -C "$LOCKSTORE" rev-parse HEAD)" != "$L_HEAD"
check "lock: released on exit" test ! -e "$LOCKSTORE/.git/memoria-sync.lock"

# ── Object-storage mirror: neither side's entries are overwritten ──
# A directory stands in for the bucket, and the mirror copies every file that
# is missing or differs, as `gsutil rsync` without -d does. The push copied
# the device's files over the bucket (dropping hosted entries) and the pull
# committed the bucket's copy over local work (reverting unpushed entries).
MSTORE="$TMP/mstore"; BUCKET="$TMP/bucket"; MLOG="$TMP/mirror.log"
git init -q "$MSTORE"
git -C "$MSTORE" config user.email t@t; git -C "$MSTORE" config user.name t
cp "$REPO_ROOT/store-template/.gitattributes" "$REPO_ROOT/store-template/.gitignore" "$MSTORE/"
mkdir -p "$MSTORE/memories/daily"
DLOG="memories/daily/2026-10-29.md"
printf -- '---\nname: d\n---\n\n## 09:00 UTC — base\n' > "$MSTORE/$DLOG"
git -C "$MSTORE" add -A; git -C "$MSTORE" commit -qm init
mkdir -p "$BUCKET"; cp -R "$MSTORE/memories/." "$BUCKET/"
cat > "$MSTORE/.memoria-mirror.sh" <<MIRROR
#!/usr/bin/env bash
set -euo pipefail
copy() { # src dst: every file missing or different at dst
  (cd "\$1" && find . -type f) | while read -r f; do
    if [ ! -f "\$2/\$f" ] || ! cmp -s "\$1/\$f" "\$2/\$f"; then mkdir -p "\$(dirname "\$2/\$f")"; cp "\$1/\$f" "\$2/\$f"; fi
  done
}
case "\$1" in
  pull) copy "$BUCKET" "\$2/memories" ;;
  push) copy "\$2/memories" "$BUCKET" ;;
esac
MIRROR
chmod +x "$MSTORE/.memoria-mirror.sh"
mirror_sync() { # <pull|push>
  MEMORIA_DIR="$MSTORE" MEMORIA_SYNC_LOG="$MLOG" MEMORIA_SYNC_ALLOW_STORE_MIRROR=true MEMORIA_SYNC_INTERVAL_S=0 \
    bash "$REPO_ROOT/scripts/sync/memoria-sync-$1.sh" >/dev/null 2>&1
}
# The hosted server appends H1 in the bucket; this device appends L1. Push.
echo "## 10:00 UTC — H1 hosted" >> "$BUCKET/daily/2026-10-29.md"
echo "## 10:01 UTC — L1 local" >> "$MSTORE/$DLOG"
mirror_sync push
check "mirror: push keeps the bucket's own entry" grep -q 'H1 hosted' "$BUCKET/daily/2026-10-29.md"
# Pull: the bucket and the device both changed the log since they last
# agreed. Neither copy may replace the other.
mirror_sync pull
check "mirror: pull keeps the local entry when both sides changed" \
  grep -q 'L1 local' <(git -C "$MSTORE" show "HEAD:$DLOG")
check "mirror: both-sides change logged" grep -q 'kept the local copy' "$MLOG"
check "mirror: the bucket keeps its entry" grep -q 'H1 hosted' "$BUCKET/daily/2026-10-29.md"
# A bucket copy that only appends to the local one is taken, and a file new
# to the store comes down as it is.
cp "$MSTORE/$DLOG" "$BUCKET/daily/2026-10-29.md"
echo "## 11:00 UTC — H2 hosted" >> "$BUCKET/daily/2026-10-29.md"
printf 'hosted only\n' > "$BUCKET/daily/2026-10-30.md"
mirror_sync pull
check "mirror: an appended bucket copy is taken" grep -q 'H2 hosted' <(git -C "$MSTORE" show "HEAD:$DLOG")
check "mirror: ... without losing local entries" grep -q 'L1 local' <(git -C "$MSTORE" show "HEAD:$DLOG")
check "mirror: a new bucket file is taken" git -C "$MSTORE" cat-file -e HEAD:memories/daily/2026-10-30.md
# Committed locally with the network push deferred, then a new session pulls
# from a bucket that has not seen it: the entry must stay at HEAD.
echo "## 12:00 UTC — L3 local" >> "$MSTORE/$DLOG"
git -C "$MSTORE" commit -qam "L3"
mirror_sync pull
check "mirror: a stale bucket does not revert a local entry" grep -q 'L3 local' <(git -C "$MSTORE" show "HEAD:$DLOG")

if [ "$fail" -eq 0 ]; then echo "all sync script tests passed"; else echo "FAILURES"; exit 1; fi
