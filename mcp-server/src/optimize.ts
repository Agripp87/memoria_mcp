/**
 * Memory optimization: decay, promotion, staleness detection, duplicate finding.
 */

import { MemoryStore } from "./store.js";

export interface OptimizeResult {
  action: string;
  affected: number;
  details: string[];
}

export function runDecay(store: MemoryStore): OptimizeResult {
  const affected = store.decayImportance(60);
  return {
    action: "decay",
    affected,
    details: [`Reduced importance by 1 for ${affected} chunk(s) not accessed in 60+ days`],
  };
}

export function runPromote(store: MemoryStore): OptimizeResult {
  const affected = store.boostImportance(10);
  return {
    action: "promote",
    affected,
    details: [`Increased importance by 1 for ${affected} chunk(s) with 10+ accesses`],
  };
}

export function detectStale(store: MemoryStore): OptimizeResult {
  const stale = store.findStale(90, 5);
  const details = stale.map(
    (s) =>
      `${s.file} — importance: ${s.importance}, last accessed: ${s.lastAccessed}, accesses: ${s.accessCount}`,
  );

  return {
    action: "detect_stale",
    affected: stale.length,
    details:
      stale.length > 0
        ? [`Found ${stale.length} stale memory file(s):`, ...details]
        : ["No stale memories found."],
  };
}

/**
 * Find potential duplicates. Returns file list for the agent to analyze —
 * actual dedup requires LLM judgment, not algorithmic comparison.
 */
export function findDuplicates(store: MemoryStore): OptimizeResult {
  const files = store.getIndexedFiles();

  if (files.length < 2) {
    return {
      action: "find_duplicates",
      affected: 0,
      details: ["Not enough files to check for duplicates."],
    };
  }

  return {
    action: "find_duplicates",
    affected: 0,
    details: [
      `${files.length} files indexed. Use memory_search with similar queries to identify overlapping content.`,
      "The agent should read candidate files and decide whether to merge.",
    ],
  };
}

export function runOptimize(store: MemoryStore, action: string): OptimizeResult {
  switch (action) {
    case "decay":
      return runDecay(store);
    case "promote":
      return runPromote(store);
    case "detect_stale":
      return detectStale(store);
    case "find_duplicates":
      return findDuplicates(store);
    default:
      return {
        action,
        affected: 0,
        details: [`Unknown action: ${action}. Use: decay, promote, detect_stale, find_duplicates`],
      };
  }
}
