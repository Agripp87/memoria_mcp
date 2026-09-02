#!/usr/bin/env node
/**
 * Assert that the local MiniLM provider still produces the SAME vectors it
 * always has.
 *
 * Why this exists. Upgrading @xenova/transformers 2.x to
 * @huggingface/transformers 3.x kept the model id identical but changed the
 * default weights from int8-quantized to fp32. Measured on identical input, the
 * v3 defaults sat at cosine 0.9929 to the v2 vectors — close enough to look
 * fine, far enough to be wrong.
 *
 * That near-miss is the dangerous case. Memoria's provider-change check keys on
 * the provider name and the dimension; both are unchanged by a weights swap, so
 * no reindex would fire. Every memory written before the upgrade would keep its
 * old vectors, every memory written after would get subtly different ones, and
 * the store would return slightly worse neighbours forever without a single
 * error. Pinning dtype "q8" in embeddings.ts restores byte-identical output.
 *
 * This script is the regression guard for that. It is NOT in CI: it downloads
 * the ~23MB model on a cold cache, which is a poor fit for every pull request.
 * Run it by hand whenever the embedding dependency, the model id, or the dtype
 * changes — the three things that can move the vector space.
 *
 *   npm run build && node scripts/verify-vector-space.mjs
 *
 * Exits 0 when the vectors match the committed reference, 1 when they moved.
 * A genuine, intended move needs the reference regenerated AND a forced reindex
 * path for existing stores — not a quiet update of this fixture.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE = path.join(here, "..", "src", "__fixtures__", "minilm-reference-vectors.json");

// Force the local provider regardless of ambient config: this script is
// meaningless against OpenAI or the hash fallback.
process.env.MEMORIA_EMBEDDINGS = "minilm";

const ref = JSON.parse(readFileSync(REFERENCE, "utf-8"));
const { embedBatch, getProvider, getDimension } = await import("../dist/embeddings.js");

if (getProvider() !== "minilm") {
  process.stderr.write(
    `FAIL: provider is "${getProvider()}", expected "minilm". ` +
      "Is @huggingface/transformers installed?\n",
  );
  process.exit(1);
}

const actual = await embedBatch(ref.texts);

let worstCosine = 1;
let worstDelta = 0;
for (let i = 0; i < ref.texts.length; i++) {
  const expected = ref.vectors[i];
  const got = Array.from(actual[i]);
  if (got.length !== expected.length) {
    process.stderr.write(`FAIL: dimension moved, ${expected.length} -> ${got.length}\n`);
    process.exit(1);
  }
  const dot = expected.reduce((s, x, j) => s + x * got[j], 0);
  const na = Math.sqrt(expected.reduce((s, x) => s + x * x, 0));
  const nb = Math.sqrt(got.reduce((s, x) => s + x * x, 0));
  worstCosine = Math.min(worstCosine, dot / (na * nb));
  worstDelta = Math.max(worstDelta, ...expected.map((x, j) => Math.abs(x - got[j])));
}

process.stdout.write(
  `provider=${getProvider()} dim=${getDimension()} model=${ref.model} dtype=${ref.dtype}\n` +
    `worst cosine vs reference: ${worstCosine.toFixed(8)}\n` +
    `worst element delta:       ${worstDelta.toFixed(8)}\n`,
);

// Tolerances are deliberately near-exact. This is not a quality metric where
// "close" is acceptable; it is an identity check on a stored vector space.
if (worstCosine > 0.99999999 && worstDelta < 1e-7) {
  process.stdout.write("PASS: vector space unchanged, existing indexes stay valid.\n");
  process.exit(0);
}

process.stderr.write(
  "FAIL: the vector space MOVED. Existing stores hold the old vectors and nothing\n" +
    "will reindex them automatically, because the provider name and dimension are\n" +
    "unchanged. Either restore the previous weights (check the dtype passed to\n" +
    "pipeline() in src/embeddings.ts) or ship a forced reindex before releasing.\n",
);
process.exit(1);
