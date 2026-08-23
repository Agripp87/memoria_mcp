#!/bin/bash
# Sync memories from Claude Code's built-in memory into Memoria's canonical store
# This is a one-way pull: ~/.claude/projects/*/memory/ → Memoria/memories/
# Usage: ./scripts/sync-from-claude-memory.sh

set -euo pipefail

MEMORIA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MEMORIES_DIR="$MEMORIA_DIR/memories"

# Derive Claude Code's per-project memory dir from THIS repo's location (Claude
# mangles a project path by replacing "/" with "-"), instead of hardcoding one
# machine's path. Fall back to a glob so a differently-mangled path (e.g. a
# Windows drive prefix) is still found.
_mangled="$(printf '%s' "$MEMORIA_DIR" | sed 's|/|-|g; s|^-||')"
CLAUDE_MEMORY_DIR="$HOME/.claude/projects/$_mangled/memory"
if [ ! -d "$CLAUDE_MEMORY_DIR" ]; then
  for _cand in "$HOME"/.claude/projects/*[Mm]emoria*/memory; do
    [ -d "$_cand" ] && CLAUDE_MEMORY_DIR="$_cand" && break
  done
fi

if [ ! -d "$CLAUDE_MEMORY_DIR" ]; then
  echo "No Claude Code memory found at: $CLAUDE_MEMORY_DIR"
  exit 0
fi

echo "Syncing from: $CLAUDE_MEMORY_DIR"
echo "         to: $MEMORIES_DIR"
echo ""

synced=0

for src_file in "$CLAUDE_MEMORY_DIR"/*.md; do
  [ -f "$src_file" ] || continue
  basename_file=$(basename "$src_file")

  # Skip MEMORY.md index file
  [ "$basename_file" = "MEMORY.md" ] && continue

  # Determine destination based on type in frontmatter
  type=$(sed -n 's/^type: *//p' "$src_file" | head -1)
  case "$type" in
    user)    dest_dir="$MEMORIES_DIR/user" ;;
    project) dest_dir="$MEMORIES_DIR/project" ;;
    feedback) dest_dir="$MEMORIES_DIR/feedback" ;;
    reference) dest_dir="$MEMORIES_DIR/references" ;;
    *)       dest_dir="$MEMORIES_DIR/project" ;; # default
  esac

  dest_file="$dest_dir/$basename_file"

  if [ -f "$dest_file" ]; then
    # Compare content (ignoring frontmatter differences)
    src_content=$(sed -n '/^---$/,/^---$/!p' "$src_file")
    dest_content=$(sed -n '/^---$/,/^---$/!p' "$dest_file")

    if [ "$src_content" = "$dest_content" ]; then
      echo "  SKIP (identical): $basename_file"
      continue
    else
      echo "  UPDATE (newer content): $basename_file → $dest_dir/"
    fi
  else
    echo "  ADD (new): $basename_file → $dest_dir/"
  fi

  mkdir -p "$dest_dir"
  cp "$src_file" "$dest_file"
  synced=$((synced + 1))
done

echo ""
echo "Synced $synced file(s)."
if [ "$synced" -gt 0 ]; then
  echo "Remember to update memories/MEMORY_INDEX.md if new files were added."
fi
