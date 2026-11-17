/**
 * The evaluation data as run.mjs and check.mjs use it: both corpora and both
 * gold sets joined, plus the dev/test split.
 *
 *   set "original"  corpus.mjs + gold.mjs alone: the 51 documents every
 *                   number published before 2026-11 was measured on.
 *   set "full"      the above plus corpus-2.mjs + gold-2.mjs (the default).
 *
 * SPLIT. Each answerable query is "dev" or "test": within its kind, in file
 * order, they alternate. A weight is chosen on dev and reported on test, so
 * the reported number comes from queries the choice never saw. The split is
 * positional on purpose: it needs no seed, and adding a query at the end of a
 * kind never moves an existing query to the other side.
 */

import { CORPUS } from "./corpus.mjs";
import { GOLD } from "./gold.mjs";
import { CORPUS_2 } from "./corpus-2.mjs";
import { GOLD_2 } from "./gold-2.mjs";

export const KINDS = ["temporal", "hard-negative", "paraphrase", "exact-term", "mixed"];

function withSplit(gold) {
  const seen = {};
  return gold.map((g) => {
    if (g.kind === "unanswerable") return g;
    const n = (seen[g.kind] = (seen[g.kind] ?? 0) + 1);
    return { ...g, split: n % 2 === 1 ? "dev" : "test" };
  });
}

export function loadDataset(set = "full") {
  if (set !== "full" && set !== "original") throw new Error(`unknown set "${set}"`);
  const corpus = set === "original" ? CORPUS : [...CORPUS, ...CORPUS_2];
  // The split is computed over the full gold set and then filtered, so a
  // query is on the same side whichever set is loaded.
  const all = withSplit([...GOLD, ...GOLD_2]);
  const gold = set === "original" ? all.slice(0, GOLD.length) : all;
  return {
    set,
    corpus,
    gold,
    answerable: gold.filter((g) => g.kind !== "unanswerable"),
    unanswerable: gold.filter((g) => g.kind === "unanswerable"),
  };
}

/** The text a document is indexed as, minus frontmatter. */
export const documentText = (m) => `# ${m.title}\n\n${m.body}\n`;
