/**
 * The gold query set.
 *
 * Construction rules, applied deliberately (see eval/README.md for why):
 *
 *   PARAPHRASE      No query reuses the answer's distinctive wording. A query
 *                   sharing surface tokens with its answer is won by BM25 alone
 *                   and teaches nothing about the vector half.
 *   HARD NEGATIVE   Where two memories cover the same topic and differ in one
 *                   load-bearing detail, the query targets that detail.
 *   TEMPORAL        Some questions have an older answer that reads as correct
 *                   and a newer one that supersedes it. Only the newer is gold.
 *                   These are the only queries that actually exercise recency.
 *   UNANSWERABLE    Queries with no correct answer in the corpus. Scored
 *                   separately: the metric is whether the system declines
 *                   rather than returning its least-bad guess.
 *
 * `relevant` lists file ids that are genuinely correct. `supersededBy` records
 * a stale near-answer so a failure report can say "returned the old decision"
 * rather than just "wrong".
 */

export const GOLD = [
  // ── temporal: the newer decision supersedes the older one ──────────────
  {
    q: "which message broker did we settle on for the event pipeline",
    relevant: ["queue-decision-reversed"],
    stale: ["queue-decision-original"],
    kind: "temporal",
  },
  {
    q: "who is the right person for a platform-wide architecture call",
    relevant: ["person-rahul-new-role"],
    stale: ["person-rahul-old-role"],
    kind: "temporal",
  },
  {
    q: "who owns the shipping provider adapters day to day now",
    relevant: ["person-wei"],
    stale: ["person-rahul-old-role"],
    kind: "temporal",
  },

  // ── hard negatives: two similar memories, one load-bearing difference ──
  {
    q: "which incident actually lost data",
    relevant: ["outage-july-database"],
    stale: ["outage-march-carrier"],
    kind: "hard-negative",
  },
  {
    q: "when did an upstream partner flood us with repeated notifications",
    relevant: ["outage-march-carrier"],
    kind: "hard-negative",
  },
  {
    q: "may we add margin to the diesel charge we are billed",
    relevant: ["pricing-surcharge-policy"],
    stale: ["pricing-handling-policy"],
    kind: "hard-negative",
  },
  {
    q: "is it acceptable to profit on our own warehouse labour",
    relevant: ["pricing-handling-policy"],
    stale: ["pricing-surcharge-policy"],
    kind: "hard-negative",
  },
  {
    q: "why was the cheaper storage window turned down",
    relevant: ["retention-rejected-option"],
    stale: ["retention-decision"],
    kind: "hard-negative",
  },

  // ── paraphrase: correct answer, reworded so keywords do not carry it ───
  {
    q: "how far back can a customer still query their parcel history",
    relevant: ["retention-decision"],
    kind: "paraphrase",
  },
  {
    q: "why does this team avoid a standing weekly sync",
    relevant: ["pref-no-status-meetings"],
    kind: "paraphrase",
  },
  {
    q: "what should a reviewer actually spend their attention on",
    relevant: ["pref-review-depth"],
    kind: "paraphrase",
  },
  {
    q: "what to do when workers fall behind the backlog",
    relevant: ["queue-runbook"],
    kind: "paraphrase",
  },
  {
    q: "how soon after an incident must the writeup exist",
    relevant: ["outage-postmortem-policy"],
    kind: "paraphrase",
  },
  {
    q: "why do we block deploys late in the year",
    relevant: ["distractor-8"],
    kind: "paraphrase",
  },
  {
    q: "what stops a single customs partner failing taking out a whole region",
    relevant: ["distractor-2"],
    kind: "paraphrase",
  },
  {
    q: "why can we not just add more API credentials to go faster",
    relevant: ["distractor-25"],
    kind: "paraphrase",
  },
  {
    q: "what evidence does a damage claim require",
    relevant: ["distractor-9"],
    kind: "paraphrase",
  },
  {
    q: "why is the parcel status page held to a strict speed limit",
    relevant: ["distractor-32"],
    kind: "paraphrase",
  },
  {
    q: "how do we price a shipment booked before a tariff change",
    relevant: ["distractor-17"],
    kind: "paraphrase",
  },
  {
    q: "where is European customer data physically kept",
    relevant: ["distractor-16"],
    kind: "paraphrase",
  },
  {
    q: "why did we stop paginating by numeric position",
    relevant: ["distractor-28"],
    kind: "paraphrase",
  },
  {
    q: "how is partner access to other depots prevented",
    relevant: ["distractor-35"],
    kind: "paraphrase",
  },
  {
    q: "why is automatic damage spotting not switched on",
    relevant: ["distractor-30"],
    kind: "paraphrase",
  },
  {
    q: "what drove building offline capability into the driver tooling",
    relevant: ["distractor-6"],
    kind: "paraphrase",
  },
  {
    q: "why are supplier bills checked more often than monthly",
    relevant: ["distractor-11"],
    kind: "paraphrase",
  },
  {
    q: "how much weight difference is tolerated before recharging",
    relevant: ["distractor-23"],
    kind: "paraphrase",
  },

  // ── unanswerable: nothing in the corpus answers these ──────────────────
  { q: "what is the parental leave allowance", relevant: [], kind: "unanswerable" },
  { q: "how much did the last funding round raise", relevant: [], kind: "unanswerable" },
  { q: "what uptime do we contractually guarantee shippers", relevant: [], kind: "unanswerable" },
  { q: "which law firm handles our trademark filings", relevant: [], kind: "unanswerable" },
];

export const ANSWERABLE = GOLD.filter((g) => g.kind !== "unanswerable");
export const UNANSWERABLE = GOLD.filter((g) => g.kind === "unanswerable");
