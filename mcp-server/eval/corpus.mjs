/**
 * The evaluation corpus: a synthetic but internally consistent memory store.
 *
 * Every memory here was written by hand for this benchmark. The world is a
 * fictional logistics company, chosen because it produces the things a real
 * memory store contains — decisions that get reversed, people who change roles,
 * near-identical incidents, and jargon that repeats across unrelated topics.
 *
 * Three properties are deliberate, and the gold set depends on all of them:
 *
 *   1. HARD NEGATIVES. Several topics have two or three memories that are
 *      superficially near-identical and differ in one load-bearing detail.
 *      Retrieval that keys on topic alone will pick the wrong one.
 *   2. TEMPORAL PAIRS. Some questions have two truthful-looking answers where
 *      only the later one still holds. This is the only thing that actually
 *      tests the recency weight.
 *   3. DISTRACTOR DENSITY. Roughly half the corpus exists to be wrong. A
 *      benchmark where most documents are plausible answers measures nothing.
 *
 * Dates are relative to a fixed anchor so runs are reproducible; see run.mjs.
 */

// Day offsets are counted back from the run anchor. Larger = older.
export const CORPUS = [
  // ─── Topic: the queue migration (temporal pair + hard negatives) ─────────
  {
    id: "queue-decision-original",
    type: "project",
    day: 240,
    importance: 0.7,
    title: "Shipment events move to RabbitMQ",
    body: `We settled on RabbitMQ for the shipment event bus. Kafka was the other
finalist but the operational burden was judged too high for a team of six, and
we do not need log compaction or replay beyond a few hours. Quorum queues give
us the durability we actually need.`,
  },
  {
    id: "queue-decision-reversed",
    type: "project",
    day: 45,
    importance: 0.9,
    title: "Reversing the RabbitMQ decision — moving to Kafka",
    body: `We are reversing the event bus decision. Three separate incidents this
quarter came down to unbounded queue growth during carrier outages, and the
replay window we said we would never need turned out to be exactly what
post-incident reconciliation requires. Kafka it is. The migration is scheduled
after the peak season freeze lifts.`,
  },
  {
    id: "queue-runbook",
    type: "reference",
    day: 120,
    importance: 0.5,
    title: "Draining a stuck shipment queue",
    body: `When consumers fall behind, do not purge. Shift the consumer group to
the parallel exchange, let the backlog drain against the replica, then cut back.
Purging loses carrier acknowledgements that cannot be re-requested.`,
  },

  // ─── Topic: the two outages (classic hard negative pair) ────────────────
  {
    id: "outage-march-carrier",
    type: "project",
    day: 175,
    importance: 0.8,
    title: "March outage — carrier webhook storm",
    body: `Four hours of degraded tracking. Root cause was a carrier replaying
eleven days of webhooks after their own recovery, which saturated our ingest
workers. Fix was a per-carrier token bucket at the edge. Customer impact was
visible but no data was lost.`,
  },
  {
    id: "outage-july-database",
    type: "project",
    day: 60,
    importance: 0.85,
    title: "July outage — connection pool exhaustion",
    body: `Six hours of failed writes. Root cause was a migration that added an
index without CONCURRENTLY, taking an exclusive lock while the pool filled with
waiters. Fix was a lint rule rejecting bare CREATE INDEX in migrations. Roughly
two hours of tracking updates were lost and had to be re-pulled.`,
  },
  {
    id: "outage-postmortem-policy",
    type: "reference",
    day: 150,
    importance: 0.6,
    title: "Postmortem policy",
    body: `Every incident over thirty minutes gets a written postmortem within
three working days. Postmortems are blameless and are never used in performance
review. The action items are tracked like any other work, not in a separate
document nobody opens.`,
  },

  // ─── Topic: people and roles (temporal pair) ────────────────────────────
  {
    id: "person-rahul-old-role",
    type: "reference",
    day: 300,
    importance: 0.5,
    title: "Rahul — backend engineer",
    body: `Rahul joined the platform team as a backend engineer. Owns the carrier
integration layer and knows the DHL and Maersk quirks better than anyone.
Prefers async review over meetings.`,
  },
  {
    id: "person-rahul-new-role",
    type: "reference",
    day: 30,
    importance: 0.7,
    title: "Rahul now leads the platform team",
    body: `Rahul stepped up to lead the platform team after the reorg. He is no
longer the day-to-day owner of carrier integrations — that moved to Wei — and
should be treated as the escalation point for platform-wide decisions rather
than for individual carrier bugs.`,
  },
  {
    id: "person-wei",
    type: "reference",
    day: 90,
    importance: 0.6,
    title: "Wei — carrier integrations",
    body: `Wei owns the carrier integration layer. Deep on the customs
declaration formats and the reason the Maersk adapter has its own retry policy.
Based in Singapore, so European mornings are the overlap window.`,
  },
  {
    id: "person-dana",
    type: "reference",
    day: 200,
    importance: 0.5,
    title: "Dana — design",
    body: `Dana runs design for the shipper-facing console. Strong opinions about
dense data tables and why the tracking timeline should never collapse by
default. Works Tuesday to Friday.`,
  },

  // ─── Topic: pricing (hard negative: two similar policies) ───────────────
  {
    id: "pricing-surcharge-policy",
    type: "project",
    day: 110,
    importance: 0.7,
    title: "Fuel surcharge passes through at cost",
    body: `Fuel surcharges are passed through to shippers at exactly the carrier
rate with no markup. This was a deliberate trust decision: shippers can verify
the number against their own carrier contracts, and being caught adding margin
there would cost more than the margin is worth.`,
  },
  {
    id: "pricing-handling-policy",
    type: "project",
    day: 105,
    importance: 0.65,
    title: "Handling fees carry a fixed markup",
    body: `Handling fees, unlike fuel, carry a flat markup that is disclosed in
the contract but not itemised per shipment. The distinction matters: handling is
our own labour and warehouse cost, so marking it up is ordinary business, while
marking up a pass-through carrier charge is not.`,
  },

  // ─── Topic: the retention argument (nuanced, single correct answer) ─────
  {
    id: "retention-decision",
    type: "project",
    day: 80,
    importance: 0.75,
    title: "Tracking events retained for 400 days",
    body: `Settled on 400 days for raw tracking events. The number is not
arbitrary: it is 13 months, so a shipper closing an annual dispute always has
the full prior year plus the month they are working in. Aggregates are kept
indefinitely; only raw events expire.`,
  },
  {
    id: "retention-rejected-option",
    type: "project",
    day: 82,
    importance: 0.4,
    title: "Why not 90 days for tracking events",
    body: `Ninety days was proposed on storage cost grounds and rejected. The
storage saving was real but small, and it would have made annual dispute
resolution impossible without a restore from cold backup, which is a support
burden that dwarfs the saving.`,
  },

  // ─── Topic: a preference expressed once, buried ─────────────────────────
  {
    id: "pref-no-status-meetings",
    type: "feedback",
    day: 135,
    importance: 0.8,
    title: "Written updates instead of status meetings",
    body: `Stop scheduling recurring status meetings for this team. Written
updates in the channel, read asynchronously, with a meeting only when there is
an actual decision to make. The reason is not meeting-hatred: half the team is
in a timezone where every recurring slot lands badly, so a standing meeting
quietly taxes the same people every week.`,
  },
  {
    id: "pref-review-depth",
    type: "feedback",
    day: 70,
    importance: 0.7,
    title: "Review for correctness, not style",
    body: `Code review comments should be about correctness, data safety and
whether the change does what it claims. Formatting is the formatter's job and
naming bikesheds are not worth the round trip. If a review has more style notes
than substance notes, it is the wrong review.`,
  },
];

// ─── Distractors ─────────────────────────────────────────────────────────
// Half the corpus exists to be wrong. These share vocabulary, entities and
// shape with the answer documents without answering any gold query. Without
// them, top-10 retrieval over a small corpus is trivially perfect and the
// benchmark measures nothing.
const DISTRACTOR_SEEDS = [
  [
    "Warehouse slotting review",
    "reference",
    "Reslotted the Rotterdam warehouse so fast-moving SKUs sit within ten metres of the pack stations. Pick times dropped but replenishment trips went up.",
  ],
  [
    "Customs broker onboarding",
    "project",
    "Onboarded a second customs broker for the Nordics so a single broker outage stops being a regional outage. Their API is SOAP and will need an adapter.",
  ],
  [
    "Barcode symbology support",
    "reference",
    "We read Code 128 and GS1 DataMatrix. QR appears on some carrier labels but carries no data we use, so it is ignored rather than parsed.",
  ],
  [
    "Pallet dimension defaults",
    "reference",
    "Euro pallet is assumed unless the shipper declares otherwise. Mis-declared dimensions are the second most common source of billing disputes.",
  ],
  [
    "Carrier scorecard metrics",
    "project",
    "Carrier scorecards weigh on-time delivery, damage rate and how quickly the carrier acknowledges an exception. Acknowledgement speed correlates with everything else.",
  ],
  [
    "Driver app offline mode",
    "project",
    "The driver app queues scans locally and syncs opportunistically. Rural routes in Norway drove this; assuming connectivity was never realistic.",
  ],
  [
    "Address normalisation library",
    "reference",
    "We normalise addresses before dedupe. The library handles most European formats and falls over on Irish Eircodes, which get a special case.",
  ],
  [
    "Peak season freeze",
    "project",
    "No non-critical deploys between mid-November and the first week of January. The freeze is about carrier volume, not our own confidence.",
  ],
  [
    "Insurance claim workflow",
    "project",
    "Damage claims need photographs at both pickup and delivery. Claims without a pickup photo are almost always denied, so the app now blocks pickup completion without one.",
  ],
  [
    "Temperature-controlled lanes",
    "reference",
    "Cold-chain shipments have their own lane and their own alerting threshold. A two-degree excursion matters more than a two-hour delay.",
  ],
  [
    "Invoice reconciliation cadence",
    "project",
    "Carrier invoices reconcile weekly rather than monthly. Monthly meant disputes were raised past the carrier's own window.",
  ],
  [
    "Shipper onboarding checklist",
    "reference",
    "New shippers need a rate card, a customs profile and at least one test shipment before going live. Skipping the test shipment is how the first invoice becomes an argument.",
  ],
  [
    "Label printer firmware",
    "reference",
    "Zebra printers on the older firmware truncate long addresses silently. Firmware is pinned and upgrades are tested against a fixed label set.",
  ],
  [
    "Route optimisation limits",
    "project",
    "Route optimisation is advisory, not binding. Drivers override it often and are usually right, because they know which loading bays are blocked at eight in the morning.",
  ],
  [
    "Returns portal scope",
    "project",
    "The returns portal covers consumer returns only. Business returns go through the account manager because they are almost always negotiated.",
  ],
  [
    "Data residency for EU shippers",
    "reference",
    "EU shipper data stays in the Frankfurt region. Cross-region replication is disabled for those tenants even though it costs us a failover option.",
  ],
  [
    "Rate card versioning",
    "reference",
    "Rate cards are versioned and never edited in place. A shipment prices against the card version live at the time of booking, not at invoicing.",
  ],
  [
    "Exception taxonomy",
    "reference",
    "Exceptions are classed as carrier-caused, shipper-caused or ours. The three-way split exists because the remediation is different for each and blame-free language was making that ambiguous.",
  ],
  [
    "Mobile scanner procurement",
    "project",
    "Standardised on one scanner model across depots. Mixed fleets meant every firmware issue needed three investigations.",
  ],
  [
    "Sandbox carrier simulator",
    "reference",
    "The carrier simulator replays recorded webhook sequences. It is the only way to test the exception paths without waiting for a real carrier to misbehave.",
  ],
  [
    "Depot handover notes",
    "project",
    "Shift handover moved from a paper log to the app. The paper log was more complete, which nobody expected, so the app now prompts for the same three fields.",
  ],
  [
    "Fuel card reconciliation",
    "project",
    "Fuel card transactions reconcile against route data nightly. Mismatches are usually a driver refuelling a personal vehicle or a mistyped odometer.",
  ],
  [
    "Weight tolerance thresholds",
    "reference",
    "Declared weight within two percent is accepted silently. Beyond that the shipment reweighs and the shipper sees the adjustment before invoicing.",
  ],
  [
    "Multi-leg tracking display",
    "project",
    "Multi-leg shipments show one timeline, not one per leg. Users consistently misread per-leg timelines as duplicate shipments.",
  ],
  [
    "Carrier API rate limits",
    "reference",
    "Most carriers rate limit per account, not per key, so adding keys does not help. The token bucket is shared across workers for this reason.",
  ],
  [
    "Holiday calendar per country",
    "reference",
    "Transit estimates use a per-country holiday calendar. Getting this wrong produces confidently incorrect delivery dates, which erodes trust faster than a vague estimate.",
  ],
  [
    "Proof of delivery retention",
    "reference",
    "Signatures and delivery photographs are kept for two years, longer than tracking events, because they are the evidence in a dispute rather than the narrative.",
  ],
  [
    "Shipper API pagination",
    "reference",
    "The shipper API paginates by cursor, not offset. Offset pagination was skipping shipments whenever new ones arrived mid-scan.",
  ],
  [
    "Warehouse wifi coverage",
    "project",
    "Two dead zones in the Rotterdam mezzanine caused scan gaps that looked like process failures. Access points fixed what training could not.",
  ],
  [
    "Automated damage detection",
    "project",
    "Trialled automated damage detection on pack station cameras. Precision was too low to act on, and a false damage claim is worse than a missed one.",
  ],
  [
    "Carrier contract renewal dates",
    "reference",
    "Contract renewals cluster in Q1, which concentrates negotiating leverage but also concentrates risk. Staggering them is a standing goal nobody has funded.",
  ],
  [
    "Tracking page performance budget",
    "reference",
    "The public tracking page has a hard performance budget because it is opened on poor mobile connections by people who are already anxious about a parcel.",
  ],
  [
    "Depot capacity planning",
    "project",
    "Depot capacity plans off the ninety-fifth percentile day, not the average. Planning off the average guarantees the worst weeks are the worst experience.",
  ],
  [
    "Localisation coverage",
    "reference",
    "The console ships in English, German, Dutch and French. Adding a language is cheap; keeping the exception taxonomy translated accurately is not.",
  ],
  [
    "Third-party logistics partners",
    "project",
    "3PL partners get a restricted console view scoped to their own depots. The scoping is enforced server-side, never by hiding UI.",
  ],
];

for (let i = 0; i < DISTRACTOR_SEEDS.length; i++) {
  const [title, type, body] = DISTRACTOR_SEEDS[i];
  CORPUS.push({
    id: `distractor-${i + 1}`,
    type,
    // Spread across the same time range as the answer documents, so recency
    // cannot be used as a shortcut to separate signal from noise.
    day: 15 + ((i * 23) % 300),
    importance: 0.3 + (i % 5) * 0.1,
    title,
    body,
    distractor: true,
  });
}

// Note: `distractor: true` marks how a document was AUTHORED, not whether any
// query happens to cite it — several of the seeded documents below are the gold
// answer for a paraphrase query. run.mjs derives the real counts from the gold
// set so the two files cannot drift apart.
