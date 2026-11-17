#!/usr/bin/env node
/**
 * Static checks on the evaluation data. It runs no search and loads no
 * model, so it can be run (and is, by src/__tests__/eval_data.test.ts) before
 * anything is measured, and cannot be influenced by a score.
 *
 *   node eval/check.mjs            # exit 1 on any error
 *   node eval/check.mjs --report   # also print the overlap report
 *
 * Errors: a duplicate document id, a gold query citing a missing document, an
 * exact-term query whose term is not verbatim in each relevant document, a
 * document listed as both relevant and stale, a query that appears twice.
 *
 * The overlap report lists, for every PARAPHRASE query, the content words it
 * shares with its answer. The paraphrase rule says there should be none that
 * are distinctive; a human decides, which is why it is a report and not an
 * error.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadDataset, documentText, KINDS } from "./dataset.mjs";

const STOP = new Set(
  (
    "a an and are as at be been before by can did do does for from had has have how i if in is it " +
    "its may me my no not of on one or our out so than that the their them then there they this " +
    "to up was we were what when where which who why will with would you your after about into " +
    "much many long far often still get gets got being over under any all each per"
  ).split(" "),
);
const words = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

export function checkDataset(set = "full") {
  const { corpus, gold, answerable } = loadDataset(set);
  const errors = [];
  const byId = new Map();
  for (const m of corpus) {
    if (byId.has(m.id)) errors.push(`duplicate document id: ${m.id}`);
    byId.set(m.id, m);
  }

  const seenQ = new Set();
  const overlap = [];
  const termSpread = [];
  for (const g of gold) {
    if (seenQ.has(g.q)) errors.push(`duplicate query: ${g.q}`);
    seenQ.add(g.q);
    if (g.kind !== "unanswerable" && !KINDS.includes(g.kind)) {
      errors.push(`unknown kind "${g.kind}": ${g.q}`);
    }
    if (g.kind !== "unanswerable" && g.relevant.length === 0) {
      errors.push(`answerable query with no relevant document: ${g.q}`);
    }
    for (const id of [...g.relevant, ...(g.stale ?? [])]) {
      if (!byId.has(id)) errors.push(`"${g.q}" cites missing document ${id}`);
    }
    for (const id of g.stale ?? []) {
      if (g.relevant.includes(id)) errors.push(`"${g.q}" lists ${id} as relevant and stale`);
    }
    if (g.kind === "exact-term") {
      if (!g.term) errors.push(`exact-term query without a term: ${g.q}`);
      else {
        const t = g.term.toLowerCase();
        if (!g.q.toLowerCase().includes(t)) errors.push(`"${g.q}" does not contain its term`);
        for (const id of g.relevant) {
          const m = byId.get(id);
          if (m && !documentText(m).toLowerCase().includes(t)) {
            errors.push(`term "${g.term}" is not in relevant document ${id}`);
          }
        }
        const holders = corpus
          .filter((m) => documentText(m).toLowerCase().includes(t))
          .map((m) => m.id);
        termSpread.push({ term: g.term, documents: holders.length });
      }
    }
    if (g.kind === "paraphrase") {
      const qw = new Set(words(g.q));
      for (const id of g.relevant) {
        const m = byId.get(id);
        if (!m) continue;
        const shared = [...new Set(words(documentText(m)))].filter((w) => qw.has(w));
        if (shared.length) overlap.push({ q: g.q, id, shared });
      }
    }
  }

  const counts = {};
  for (const g of answerable) {
    const c = (counts[g.kind] ??= { dev: 0, test: 0 });
    c[g.split]++;
  }
  return { errors, overlap, termSpread, counts, documents: corpus.length, queries: gold.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const r = checkDataset("full");
  process.stdout.write(`${r.documents} documents, ${r.queries} queries\n`);
  for (const [kind, c] of Object.entries(r.counts)) {
    process.stdout.write(`  ${kind.padEnd(14)} dev ${c.dev}  test ${c.test}\n`);
  }
  if (process.argv.includes("--report")) {
    process.stdout.write("\nParaphrase queries sharing content words with their answer:\n");
    for (const o of r.overlap) process.stdout.write(`  [${o.shared.join(", ")}]  ${o.q}\n`);
    process.stdout.write("\nExact terms found in more than one document:\n");
    for (const t of r.termSpread.filter((x) => x.documents > 1)) {
      process.stdout.write(`  ${t.term}: ${t.documents}\n`);
    }
  }
  if (r.errors.length) {
    for (const e of r.errors) process.stderr.write(`ERROR: ${e}\n`);
    process.exit(1);
  }
  process.stdout.write("OK\n");
}
