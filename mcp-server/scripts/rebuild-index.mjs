#!/usr/bin/env node
/**
 * Rebuild MEMORY_INDEX.md from the filesystem — nothing else.
 *
 * Why this exists (finding 2, 2026-07-25 review): the index is the documented
 * entry point for every session, but its only refresh paths lived inside a
 * RUNNING MCP server (the periodic sweep / memory_daily / memory_index). Any
 * stretch where no up-to-date server happens to be running — stale sessions
 * that were never restarted, pure Chat/CoWork days, a crashed daemon — and
 * the map silently drifts from the territory again (it went stale within four
 * days of the first fix exactly this way). The session-end hook calls this
 * script directly, so index freshness is structural: it rides on the same
 * mechanism that commits and syncs the store.
 *
 * Deliberately does NOT touch the SQLite index, embeddings, or entity pages —
 * those need the server/model stack. rebuildMarkdownIndex() is pure fs and
 * idempotent (no write when content is unchanged).
 */

process.env.MEMORIA_DIR = process.env.MEMORIA_DIR || "C:\\Users\\egber\\memoria";

const { rebuildMarkdownIndex } = await import("../dist/tools.js");
console.log(rebuildMarkdownIndex());
