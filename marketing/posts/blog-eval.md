<!--
Technical post. Publish a week after launch, then submit it to Hacker News as
an ordinary link (not a Show HN).

dev.to front matter:
  title: I picked my search ranking weights by hand. Then I measured them.
  tags: search, rag, opensource, ai
  cover_image: marketing/images/card-search.png (upload it)

About 1,400 words. Every number is from mcp-server/eval/README.md as of 0.3.2.
If you re-run the eval before publishing, update the numbers from your run.
The order of events is reconstructed from that file: correct the narrative
where you remember it differently.
-->

# I picked my search ranking weights by hand. Then I measured them.

[Memoria](https://github.com/Agripp87/memoria_mcp) is a memory server for
Claude: Markdown files on disk, with a SQLite index for search. When Claude
asks it a question, it ranks stored memories with a formula. For most of the
project's life that formula was this:

```
score = 0.5 · relevance + 0.2 · recency + 0.3 · importance
```

Relevance is a mix of embedding similarity and keyword match. Recency decays
with age. Importance is a 1 to 10 score in each memory's frontmatter.

I chose those numbers the way I suspect most people choose them. A memory
system should prefer recent things and important things, so half the score
went to that. I used the tool every day and it seemed fine.

Then I built an eval. This post is what it found, including the parts that are
embarrassing, and the parts it still cannot tell me.

## The harness

A gold set: a corpus of synthetic memories and a list of queries, each with
the documents that correctly answer it. The first version had 51 documents and
26 answerable queries. The harness runs every query through the real search
code and reports nDCG@10 (ranking quality, where right at rank 1 beats right
at rank 9), recall@20, and MRR.

Queries are grouped by what they test. **Temporal** queries have an old answer
that reads as correct and a newer one that actually holds. **Hard-negative**
queries have two near-identical memories that differ in one detail that
matters. **Paraphrase** queries are reworded so that keyword overlap cannot
carry the answer.

It also runs baselines: keywords only, vectors only, the hybrid with no
priors. A score means little without them.

## Finding 1: recency was a constant

The first surprise was not about weights. The temporal queries, the only ones
built to exercise recency, were not affected by the recency weight at all.

The index was dating every memory by the time it was *indexed*, not by the
date in its frontmatter. After a rebuild, every document was the same age.
Twenty percent of the ranking score was a constant.

I had used the tool daily for months and never noticed. Nothing fails when a
term in a sum is constant. It just does nothing.

## Finding 2: the priors were drowning relevance

With real dates wired in, I compared the old weights with relevance-heavy
ones on the first corpus. The environment I made the change in could not
download the embedding model, so this first comparison used the fallback
n-gram embeddings, which are lexical:

| Weights (recency / importance / relevance) | nDCG@10 | Hard-negative | Paraphrase |
|---|---|---|---|
| 0.2 / 0.3 / 0.5 (old) | 33.1 | 27.2 | 27.4 |
| 0.1 / 0.1 / 0.8 (new) | 60.4 | 51.9 | 63.2 |
| no priors at all | 68.3 | 52.6 | 74.9 |

Re-run later with the real model (local MiniLM), the shipped default went from
71.7 under the old weights to 91.0.

The reason is visible once you look at the distributions. Relevance scores for
plausible candidates fall in a narrow band. Recency and importance span the
whole range from 0 to 1. Give the priors half the weight and they decide most
rankings, with relevance acting as the tie-breaker. That is backwards.

A sweep confirmed the shape: every configuration with priors totalling 0.2 or
less ranked above every configuration with priors at 0.5.

There was a second, smaller bug in the same area. Keyword search used FTS5's
default, which requires *every* query word to appear in a chunk. Most
natural-language questions therefore matched nothing on the keyword side.
Switching to OR, with BM25 still ranking chunks that match more and rarer
words first, raised nDCG and MRR in every configuration, at a small cost in
recall@20 for the keyword-heavy ones.

## Finding 3: my first corpus said keywords were useless. It was wrong.

On those 51 documents, vector-only search scored 96.2, above the hybrid's
91.0. Taken at face value, the keyword half was costing five points and should
go.

I did not believe it, and the reason was in the data. Every query in that set
had been written to *avoid* the wording of its answer. That is a fine test of
paraphrase, and it is a corpus on which keyword matching cannot possibly help.

So I wrote a bigger one: 175 documents and 144 answerable queries, with what
the first lacked. Identifiers of every kind, many with a near miss elsewhere
in the corpus (`INC-2291` and `INC-2219`). Queries that quote an identifier
exactly. Longer files. The new data was committed before any sweep was run on
it, so I could not tune toward it.

Sweeping the vector share of relevance on the larger set:

| Vector share | nDCG@10 | Paraphrase | Exact-term |
|---|---|---|---|
| 0.0 (keywords only) | 65.5 | 27.0 | 98.6 |
| 0.5 | 78.2 | 53.6 | 98.6 |
| **0.7 (shipped)** | **82.6** | 67.9 | 92.8 |
| 0.8 | 83.2 | 72.2 | 90.4 |
| 1.0 (vectors only) | 78.6 | 72.6 | 76.8 |

The hybrid beats both of its halves. Keywords alone lose 17 points. Vectors
alone lose 4.0, with a 95% interval of −7.8 to −0.3 from a paired bootstrap
over the queries. The table shows why: vectors alone drop to 76.8 on
exact-term queries, where keywords alone score 98.6.

0.8 looks slightly better than 0.7. The difference is +0.6 with an interval of
−1.1 to +2.2, which is not distinguishable from nothing, so the default
stayed. The real trade between them is visible in the columns: paraphrase
gains, exact-term loses. Which matters more depends on what people actually
ask, and a synthetic corpus does not know that.

## Finding 4: my corpus was flattering the priors

On the larger set the shipped default, with its small priors, scored 4.1
points above the hybrid with no priors. Recency and importance earn their
keep, then?

Before trusting that, I looked at who wrote the corpus. I did. And the
documents that queries cite turned out to be, on average, 67 days newer than
the rest, and slightly more important. Preferring new and important documents
would score well whatever was asked.

The control is to shuffle. Deal the dates out again at random (keeping the
temporal pairs intact), and separately the importance values, and re-run:

| | Shipped default | Hybrid, no priors |
|---|---|---|
| As written | 82.6 | 78.5 |
| Dates shuffled | 77.0 | 78.5 |
| Importance shuffled | 81.2 | 78.5 |
| Both shuffled | 76.6 | 78.5 |

With dates shuffled the advantage is gone, and then some. What survives is
narrow and real: on the temporal queries the default scores about 90 with or
without the shuffle, against 76.5 with no priors. Recency does the one job it
is there for, ranking the newer of two conflicting answers first, and costs
about 1.5 points across all queries for doing it.

Importance I still cannot measure. The values in the corpus are invented, so
the eval can show that importance must not outweigh relevance, and nothing
about what a real importance signal is worth.

The weights stayed at 0.1 and 0.1. The corpus gives no reason to raise them
and none to drop them.

## Finding 5: long files were averaging themselves away

Queries whose answer sat inside a long daily log scored far below the rest.
The chunker cut every 1,600 characters wherever that fell, so one chunk of a
log held six or seven unrelated entries and its embedding was their average.
It matched none of them well.

Cutting daily logs at their entry headings, one entry per chunk, moved those
queries from 52.2 to 88.7 nDCG@10 with the priors off. Short notes were
unaffected with neutral dates. This shipped in 0.3.2.

It has a cost, which the write-up also records: several times as many chunks
for the same log, and with the priors on, short notes lose 3.3 points to newer
log entries on the same subject.

## What the eval cannot tell me

- **Whether any of this holds on real stores.** The corpus is synthetic and I
  wrote it. It can show that a configuration is broken. It cannot show that
  one is right for your notes.
- **What importance is worth.**
- **When to say "I don't know."** The mean top score is 0.449 for answerable
  queries and 0.322 for unanswerable ones, and the ranges overlap. There is no
  threshold that separates them, so the server cannot abstain reliably.

## What I would tell someone building retrieval

1. **Build the eval before you tune.** Mine overturned weights I had lived
   with for months.
2. **Run baselines.** "83.7" means nothing. "83.7 against 67.3 for keywords
   alone" means something.
3. **Check that every term in your formula varies.** A constant looks exactly
   like a working feature.
4. **Suspect your own corpus.** If you wrote the data and the queries, your
   habits are in both. Shuffle controls are cheap.
5. **Freeze the data before you sweep,** and report intervals. A +0.6 that
   might be −1.1 is not a finding.
6. **Publish what it does not show.**

The harness, both corpora and the full tables are in
[`mcp-server/eval/`](https://github.com/Agripp87/memoria_mcp/tree/main/mcp-server/eval).
`npm run eval` reproduces the numbers. If you see a flaw in the method, I
would like to hear about it in an
[issue](https://github.com/Agripp87/memoria_mcp/issues).
