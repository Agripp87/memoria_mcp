# Store template

Two files to copy into a memory store you want to sync. Nothing else here is
needed — Memoria creates the `memories/` layout itself on the first write.

| File | Why |
|------|-----|
| `.gitattributes` | Enables git's built-in `union` merge driver for `memories/daily/*.md`. Daily logs are append-only, so a both-sides edit merges by keeping both sides' entries instead of producing conflict markers. This is the single most important line in a synced store. |
| `.gitignore` | Keeps derived and secret runtime state (`data/`, sync logs, the object-storage mirror hook) out of the repo. The Markdown under `memories/` is the source of truth; everything in `data/` is rebuildable, and some of it — the AES master key, the encrypted credential store — must never be committed. |

Usage:

```bash
cd ~/.memoria                 # or wherever $MEMORIA_DIR points
git init -b main
cp /path/to/memoria/store-template/.gitattributes .
cp /path/to/memoria/store-template/.gitignore .
git add -A && git commit -m "Initial memory store"
```

Then publish to a **private** remote and see [`../scripts/sync/README.md`](../scripts/sync/README.md)
for the hooks that keep devices in step.

> Your store holds your memory. Make the remote private, and keep it private.
