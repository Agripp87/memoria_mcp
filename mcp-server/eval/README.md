# Retrieval evaluation

Memoria publishes a ranking formula:

```
score     = 0.1 · recency + 0.1 · importance + 0.8 · relevance
relevance = 0.7 · vector cosine + 0.3 · FTS5 BM25
```

Five hand-chosen constants. Until this harness existed there was no evidence
any of them were right. This is phase 0 and 1 of the plan: a gold set, a
harness, and the baselines that make a score mean something.

```bash
npm run build
npm run eval              # local MiniLM, ~23MB model download on first run
npm run eval:hash         # no download; measures far less, see below
npm run eval:sweep        # vector mix from 0.0 to 1.0
npm run eval:check        # static checks on the data; no model, no search
node eval/run.mjs --json  # machine-readable
```

Flags for `eval/run.mjs`: `--original` (the first 51 documents and their 30
queries only), `--split dev|test`, `--sweep`, `--shuffle-dates <seed>` and
`--shuffle-importance <seed>` (controls, explained below).

## What it measures

| Metric          | Why it is here                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **nDCG@10**     | Primary. Ranking quality with position discounting — right at rank 1 beats right at rank 9.                                                           |
| **Recall@20**   | Safety metric. Did the correct memory reach the candidate set at all, before ranking got a say? Separates a retrieval failure from a ranking failure. |
| **MRR**         | Rank of the first correct hit. Tracks the single-answer case an agent actually consumes.                                                              |
| **p95 latency** | Guards against buying accuracy with unusable speed.                                                                                                   |

Queries are grouped by what they test: **temporal** (an older answer reads as
correct, only the newer one still holds — the only queries that exercise
recency), **hard-negative** (two near-identical memories differing in one
load-bearing detail), **paraphrase** (reworded so keyword overlap does not
carry the answer), **exact-term** (the query is or contains an identifier that
is verbatim in the answer: a ticket number, an error code, a name) and
**mixed** (an ordinary question that names one thing and paraphrases the
rest). A separate **unanswerable** set has no correct answer.

Every answerable query is on one side of a **dev/test split** (alternating
within its kind). A weight is chosen on dev and reported on test.

## Current results

### 2026-11: daily logs chunked one entry at a time

The section below found that queries answered inside a long daily log
scored far worse than the rest, and guessed at the cause: the chunker cut
every 1,600 characters, so one chunk of a log held six or seven unrelated
entries. A file with daily entry headings (`## 14:05 UTC — email`) is now
cut at its `## ` headings, one entry per chunk. Nothing else is chunked
differently, and `--original` still reproduces every older number.

Shipped default, local MiniLM, 144 queries. "Daily log" is the 26 queries
whose answer is an entry of one of the six logs:

```
                                    all   daily log   short note
  as written
    before                         82.6        73.1         84.7
    after                          83.7        94.3         81.4
  without priors
    before                         78.5        52.2         84.3
    after                          84.8        88.7         83.9
  dates shuffled (3 seeds)
    before                         77.4        42.2         85.2
    after                          84.4        82.2         84.9
```

- **Entries are found.** With no help from recency, queries answered by a
  log entry go from 52.2 to 88.7 (difference 36.6, 95% interval 26.7 to
  46.7), and from 42.2 to 82.2 with dates shuffled.
- **Short notes pay nothing for it when dates are neutral**: −0.4 without
  priors (interval −2.0 to +1.1), and within ±0.7 on each shuffled seed.
- **As written, short notes lose 3.3** (interval −5.3 to −1.5). The six logs
  are the newest documents in the corpus, so each of their 70 entries now
  competes with an older note at full sharpness and with the recency prior
  behind it. Most of the loss is a note dropping from first place to second
  behind one entry on the same subject. This is the recency question from
  the section below again, and the same caveat applies: whether a real
  store's logs are that much newer than its notes is not something this
  corpus knows.
- **The vector mix is unaffected**: 0.7 and 0.8 both score 83.7 now.

The current table (`npm run eval`):

```
  configuration           nDCG@10   R@20    MRR  stale
  shipped default            83.7   97.2   80.2      3
  keyword only               67.3   81.6   65.1      9
  vector only                83.0   98.6   79.7      5
  hybrid, no priors          84.8   98.6   81.0      7
  recency, no importance     83.3   96.5   79.7      3
  importance, no recency     86.1   98.6   82.5      6

  nDCG@10 by query kind     temporal  hard-negative  paraphrase  exact-term  mixed
  shipped default               88.6           72.5        72.8        92.9   95.9
  hybrid, no priors             76.5           76.7        74.8        93.5   98.6
```

Two variants were measured and not taken: packing consecutive entries into
chunks of up to 400 or 800 characters. With dates shuffled they score 83.0
and 81.1 against 84.4 for one entry per chunk, and 72.7 and 61.1 on the
daily-log queries against 82.2. Each halving of sharpness costs about ten
points there.

What it costs: the six logs were 12 chunks and are 70. A log of short
entries makes several times as many chunks as before, and the vector scan
reads at most `MEMORIA_VECTOR_SCAN_CAP` of them per query (5,000 by
default; a search over 5,000 chunks took 65 ms on the machine that ran
this, 113 ms over 10,000 and 226 ms over 20,000).

What it does not reach: text that `memory_daily` appended before it wrote
entry headings (0.3.1 and earlier) has none, so such a log is chunked by
size as before.

### 2026-11: a larger corpus, and the keyword share measured

Measured before daily logs were chunked by entry (above); the tables in this
section are as they were then.

The first corpus could not say whether keyword matching earns its 30% of
relevance: every one of its queries avoids its answer's wording, so on it
vector-only search won (96.2 against 91.0). `corpus-2.mjs` and `gold-2.mjs`
add what was missing. The set is now **175 documents and 144 answerable
queries** (12 unanswerable), was 51 and 26:

- identifiers of every kind, many with a near-miss elsewhere in the corpus
  (`INC-2291` / `INC-2219`), and the two new query kinds that use them;
- five decision pairs that are the same sentences with one value changed, so
  only their dates can separate them (caveat 4 below);
- six daily logs long enough to be two chunks each, with the answer in one
  entry. Every older document is a single chunk;
- some personal notes next to the logistics company.

The new data was committed before any sweep was run on it. Local MiniLM,
all 144 queries:

```
  configuration           nDCG@10   R@20    MRR  stale
  shipped default            82.6   97.2   78.9      3
  keyword only               64.6   79.5   63.3      9
  vector only                75.2   95.5   71.7      5
  hybrid, no priors          78.5   97.9   75.0      7
  recency, no importance     82.1   97.9   78.6      3
  importance, no recency     80.4   96.5   77.4      6
  priors only                 6.8   24.7    4.8      1

  nDCG@10 by query kind     temporal  hard-negative  paraphrase  exact-term  mixed
  shipped default               89.3           78.9        67.9        92.8   95.2
  keyword only                  46.4           63.7        29.9        98.8   89.0
  vector only                   88.9           75.4        70.1        69.9   85.7
  hybrid, no priors             76.5           75.5        65.3        89.6   90.1
```

The sweep (`npm run eval:sweep`), with the shipped priors:

```
  vector mix  nDCG@10    MRR   R@20  temporal  hard-negative  paraphrase  exact-term  mixed
  0.0            65.5   64.3   81.6      66.2           64.3        27.0        98.6   91.5
  0.5            78.2   75.4   93.8      83.6           73.8        53.6        98.6   96.4
  0.6            80.5   76.7   96.5      87.9           73.1        61.7        96.2   95.2
  0.7            82.6   78.9   97.2      89.3           78.9        67.9        92.8   95.2   <- shipped
  0.8            83.2   79.5   98.6      90.6           78.8        72.2        90.4   93.3
  0.9            81.5   77.9   98.6      91.3           75.4        73.0        85.4   91.6
  1.0            78.6   75.0   97.2      87.6           75.6        72.6        76.8   89.6
```

#### What this establishes

**The hybrid beats both of its halves.** Against the shipped 0.7, keywords
alone lose 17.1 points and vectors alone (mix 1.0) lose 4.0 (95% interval
−7.8 to −0.3, paired bootstrap over the 144 queries). The first corpus's
"vector only is better" came from its queries and its size: its own 26
queries, searched in the larger corpus with the shipped priors, score 86.5
at mix 0.7 and 86.1 at 1.0.

**The vector mix stays at 0.7.** The dev half picks 0.8 (82.5 against 81.8)
and the test half agrees in direction (83.9 against 83.5), but over all
queries the difference is +0.6 with an interval of −1.1 to +2.2: not
distinguishable from none. Without priors it is +1.4 (−0.4 to +3.4). What
is distinguishable: 0.6 is worse than 0.7 (−2.1, interval −4.0 to −0.4), and
so is 0.5 (−4.4). The trade between 0.7 and 0.8 is plain in the table:
paraphrase gains 4.3, exact-term loses 2.4. It is a choice between kinds of
query, and nothing here says which kind real use has more of.

**Long files are harder, and lean on keywords.** Queries whose answer is in a
two-chunk daily log score 73.1 at the default; the rest score 84.7. For
those queries moving to 0.8 costs 2.3 points and vectors alone cost 9.6. The
chunker cuts every 1,600 characters wherever that falls, so one chunk of a
daily log holds six or seven unrelated entries and its vector is their
average. Cutting daily logs at entry headings is the obvious thing to try
next; it is not measured here.

#### What this does NOT establish: the priors

As written, the corpus makes the priors look good: the shipped default is
4.1 points above "hybrid, no priors" (interval 1.4 to 6.9). Most of that is
an accident of authorship. The documents a query cites are on average 67
days newer than the rest (mean age 101 days against 168) and slightly more
important (0.54 against 0.51), so preferring new and important documents
scores well whatever is asked. Two controls deal those values out again at
random (dates among every document that is not half of a temporal pair);
means of five seeds:

```
                            shipped default  hybrid, no priors  temporal (default)
  as written                           82.6               78.5                89.3
  dates shuffled                       77.0               78.5                90.4
  importance shuffled                  81.2               78.5                87.0
  both shuffled                        76.6               78.5                88.7
```

- **Recency does its job and has a price.** On the temporal queries the
  default scores about 90 with or without the shuffle, against 76.5 with no
  priors, and on the five date-only pairs it ranks the newer document first
  five times out of five (two out of five without priors). On every other
  kind, once dates carry no other information, it costs about 2.7 points,
  and 1.5 over all queries. Whether it is a net gain in a real store depends
  on whether people ask about recent things more often than old ones. That
  is likely, and a synthetic corpus cannot measure it.
- **Importance is still unmeasured.** Alone it adds 1.9 as written and 0.3
  with its values shuffled. The values are invented (caveat 3), so neither
  number says what a real importance signal is worth.

The weights stay at 0.1 / 0.1. This corpus gives no reason to raise them,
and none to drop them.

#### Also

- **Abstention is still impossible.** Mean top score is 0.449 for answerable
  queries and 0.322 for unanswerable ones, with overlapping ranges. Several
  of the new unanswerable queries are identifiers that exist nowhere
  (`INC-3051`).
- **Recall@20 is no longer free**: keyword-only reaches 79.5.
- **With the hash provider** (`npm run eval:hash`, no model) the shipped
  default scores 65.5 on this set. As before, that number is not comparable
  with the MiniLM ones.
- **Paraphrase is the weak kind** (67.9), far below the first corpus's 93.8.
  The corpus is larger and its paraphrases are harder; the five worst
  queries at the default are all printed by `npm run eval`.

### 2026-11: the 0.3.x default measured with MiniLM

The 2026-10 changes below were measured on the hash provider only. With
the real model (local MiniLM, same corpus), on @huggingface/transformers
3.8.1 and again on 4.3.2, which scored identically:

```
  configuration        nDCG@10   R@20    MRR  stale
  shipped default         91.0  100.0   87.8      1
  keyword only            68.0   96.2   60.9      3
  vector only             96.2  100.0   95.0      1
  hybrid, no priors       89.9  100.0   86.5      2
  priors only             15.8   50.0   11.3      2

  nDCG@10 by query kind      temporal  hard-negative  paraphrase
  shipped default                87.7           82.6        93.8
  vector only                   100.0           80.4       100.0
  hybrid, no priors              75.4           77.2        95.9
```

The re-weighting holds up: the shipped default went from 71.7 (the old
weights, last MiniLM run below) to 91.0. On this corpus vector-only search
still scores higher (96.2); keyword matching costs more than it adds here,
so the keyword share (vector mix 0.7) is the next weight worth measuring,
on a corpus with more exact-term queries before changing it.

The two versions give byte-for-byte the same vectors (cosine 1.0 on every
text and batch tried; `npm run verify:vectors` passes on both), so the
upgrade keeps existing indexes.

One thing this did turn up: the same text embedded alone and in a batch
gets slightly different vectors (cosine 0.97 to 0.99), on both versions.
Queries are embedded alone, and a file's chunks are embedded together, so
in a file long enough to make several chunks (about 1,600 characters
each), a chunk's vector depends a little on its neighbours. Every
document in this corpus is a single chunk, so the numbers above do not
include this effect.

Measured by embedding each document together with K texts drawn from
the rest of the corpus, keeping only its own vector (3 draws per K;
K = 0 reproduces the table above):

```
  other chunks in the batch     0     1     3     7    15    31
  shipped default nDCG@10    91.0  91.8  92.5  92.1  91.6  92.5
  vector only nDCG@10        96.2  94.6  96.0  94.3  94.8  95.6
  hybrid, no priors          89.9  89.9  90.8  90.0  90.0  89.8
```

(means of the 3 draws; each draw ranged within about 3 points). The
shipped default never fell below its unbatched 91.0; vector only moved
by about a point either way, which on 26 queries is a single query
moving one rank. A batched vector sits at cosine 0.98 to 0.99 to the
same text embedded alone whatever K is, while a document's nearest
other document is typically at 0.41, so the drift almost never reorders
results. Embedding every chunk on its own would remove the effect for
about 13% more indexing time (64 chunks: 241 ms batched, 273 ms one at
a time); with no ranking gain to show for it, chunks stay batched.

### 2026-10: recency made real, default re-weighted

Until 2026-10 the index dated every memory by the time it was indexed, not
by its frontmatter, so every document in this corpus had the same recency
and the "temporal" group never exercised it (caveat 4 below understated
this: the recency weight was a constant). Recency now comes from the
memory's own `updated` date, and the shipped weights moved from
0.2 / 0.3 / 0.5 to **0.1 / 0.1 / 0.8**.

Run on the same corpus with `--hash` (the model download was not reachable
from the environment that made the change; **re-run with MiniLM before
quoting a MiniLM number**):

```
  configuration                 nDCG@10   R@20    MRR  stale
  old default (0.2/0.3/0.5)        33.1   80.8   25.4      2
  new default (0.1/0.1/0.8)        60.4   96.2   52.4      2
  hybrid, no priors                68.3   96.2   63.9      3

  nDCG@10 by query kind      temporal  hard-negative  paraphrase
  old default                    76.7           27.2        27.4
  new default                    57.3           51.9        63.2
  hybrid, no priors              55.0           52.6        74.9
```

Keyword matching then moved from FTS5's implicit AND (every query word must
appear in the chunk, so most natural-language queries matched nothing) to
OR, with BM25 still ranking chunks that match more and rarer words first:

```
  configuration                 nDCG@10   R@20    MRR  stale
  new default, AND                 60.4   96.2   52.4      2
  new default, OR                  61.7   96.2   55.1      2
  keyword only, AND                53.8   92.3   47.5      3
  keyword only, OR                 66.5   88.5   59.7      3
  hybrid, no priors, OR            69.9   92.3   65.7      3
```

Recall@20 falls a little for the keyword-heavy configurations (more weak
matches compete for the candidate pool); nDCG and MRR rise everywhere.

With real dates, the old weights buy the temporal queries (76.7) at a price
of roughly 25 to 50 points everywhere else. Relevance scores fall in a
narrow band while recency and importance span 0 to 1, so priors carrying
half the weight decided most rankings. A sweep over recency 0 to 0.2,
importance 0 to 0.3 and vector mix 0.5 to 0.85 ranked every
configuration with priors totalling 0.2 or less above every configuration
with 0.5. The new default keeps priors as tie-breakers rather than
dropping them: this corpus's importance values are invented (caveat 3), so
it cannot show what a real importance signal is worth, only that it must
not outweigh relevance. The vector mix was left at 0.7 on purpose; hash
vectors are lexical, so a hash sweep says nothing about the semantic half.

### Before 2026-10 (recency constant, old weights)

Run on 51 documents, 26 answerable queries, local MiniLM.

```
  configuration        nDCG@10   R@20    MRR  p95ms  stale
  shipped default         71.7  100.0   64.3      4      1
  keyword only            53.8   92.3   47.5      4      3
  vector only             96.2  100.0   95.0      4      1
  hybrid, no priors       93.0  100.0   90.7      4      2
  priors only             16.1   53.8   11.8      4      2

  nDCG@10 by query kind      temporal  hard-negative  paraphrase
  shipped default                83.3           69.8        70.3
  keyword only                   56.7           53.9        53.3
  vector only                   100.0           80.4       100.0
  hybrid, no priors              75.4           78.6       100.0
  priors only                    44.4           34.9         6.1
```

### What this suggests

**The recency and importance priors help exactly where they should, and hurt
everywhere else.** The clean comparison is `shipped default` against
`hybrid, no priors` — identical relevance settings, priors on versus off.
Priors on wins the temporal queries (83.3 against 75.4) and loses the other two
kinds badly (70.3 against 100.0 on paraphrase). Aggregated, that trade is
losing: 71.7 against 93.0.

**Abstention is currently impossible.** Mean top score is 0.6097 for answerable
queries and 0.5388 for unanswerable ones, and the ranges overlap — no threshold
separates them. A caller cannot tell "here is your answer" from "I have
nothing" by looking at the score. That is phase 4's problem and this is the
measurement that motivates it.

### What this does NOT establish

The confounds are large enough that the table above is a starting point, not a
verdict. Read these before quoting any number:

1. **The same party wrote the system, the corpus and the queries.** That is the
   weakest possible position for a benchmark. Every number here should be
   treated as provisional until it is reproduced on a corpus this project did
   not author — LongMemEval or similar, which is phase 3.

2. **The paraphrase rule is structurally hostile to BM25.** (Since 2026-11
   the exact-term and mixed queries give keywords a fair test; this caveat
   stands for the paraphrase kind and for every table older than that.) Queries were
   deliberately written to avoid the answer's wording, because a query sharing
   surface tokens with its answer teaches nothing about the vector half. That
   choice is right for testing semantics and it means `keyword only` (53.8) is
   a floor, not a fair assessment of BM25. Do not conclude that keyword search
   is weak in general; conclude that it cannot carry paraphrased queries alone.

3. **The importance values are invented.** Every document's importance was
   assigned by hand with no underlying reality, so in this corpus importance is
   close to noise. "Priors hurt by 21 points" therefore partly measures "adding
   a noise term hurts", which is unsurprising. In a real store importance
   reflects something. This corpus cannot tell you whether the 0.3 weight is
   right; it can only tell you the weight is not free.

4. **The temporal queries do not isolate recency as cleanly as intended.**
   (Since 2026-11 five date-only pairs do; this describes the older ones.)
   `vector only` scores 100.0 on them with recency switched off entirely,
   because the superseding documents also happen to be the more semantically
   on-point ones — a memory that says "reversing the earlier decision" matches
   "what did we settle on" on content alone. A sharper temporal set would use
   pairs that are semantically indistinguishable and differ only in date.

5. **The corpus is small.** (175 documents since 2026-11, which is still
   small: one query moving one rank moves nDCG@10 by up to 0.7.) At 51
   documents, Recall@20 is nearly free — most
   configurations score 100 because 20 slots over 51 documents is not a
   selective filter. Growing the corpus is the single highest-value improvement
   to this harness, and it is why the recall column is currently uninformative.

6. **One provider, one run.** Scores from different embedding providers are not
   comparable and must never appear in the same table. The provider is printed
   with every result for this reason.

7. **Answers are newer than the rest of the corpus.** See "What this does NOT
   establish: the priors" above, and use `--shuffle-dates` before crediting
   recency with anything.

8. **The dev/test split is not an independent test.** Both halves were written
   by the same author in the same sitting. It guards against fitting a weight
   to particular queries, not against the corpus being unrepresentative.

## Method

- The store is built fresh in a temp directory each run and deleted afterwards,
  so runs cannot contaminate one another.
- The harness calls `MemoryStore.search()` directly rather than going through
  the MCP tool. The tool layer bumps `last_accessed` on every returned file,
  and that feeds the recency signal — benchmarking through it would let each
  query alter the ranking seen by the next one.
- Document dates are relative to the run rather than fixed calendar dates, so
  the recency signal behaves identically whenever this is run.
- Relevance is binary. A document is a correct answer or it is not.

## Gold set construction rules

These are the rules the queries were written to, and the reason to trust the
set as far as it goes:

1. **Paraphrase every query** of the paraphrase, temporal and hard-negative
   kinds. No such query reuses its answer's distinctive wording.
   `npm run eval:check` prints the content words each one shares with its
   answer. Exact-term queries do the opposite on purpose: their term must be
   verbatim in every relevant document, and the check enforces it.
2. **Plant hard negatives.** Where two memories cover one topic, the query
   targets the detail that separates them.
3. **Include temporal pairs.** Two plausible answers, only the newer true.
4. **Label before tuning.** The gold set was frozen before any configuration was
   swept, so the weights cannot be fitted to answers adjusted afterwards. The
   2026-11 additions were committed on their own, before their first sweep.
5. **Report the failures.** The harness prints its five worst queries every run.
   A benchmark with no visible failures is one nobody should believe.

## Not in CI

This is deliberate. The default provider downloads a ~23MB model on a cold
cache, which is a poor fit for every pull request. `npm run eval:hash` runs
without any download but substitutes the n-gram fallback for real embeddings,
which changes what is being measured rather than merely making it cheaper.

What does run in CI is `eval/check.mjs`, through
`src/__tests__/eval_data.test.ts`: it needs no model, and it catches a query
citing a document that was renamed or an exact term edited out of its answer.

Gating merges on nDCG@10 and Recall@20 floors is phase 3, and should wait until
the corpus is large enough for those numbers to be stable.
