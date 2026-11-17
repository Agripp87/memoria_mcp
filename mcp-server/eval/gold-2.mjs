/**
 * Gold queries for corpus-2.mjs (2026-11).
 *
 * gold.mjs paraphrases every query on purpose, which tests the vector half
 * and cannot tell whether keyword matching earns its 30% of relevance. This
 * set adds the two kinds of query that can:
 *
 *   EXACT-TERM   The query is, or contains, an identifier that appears
 *                verbatim in the answer: an incident number, an error code, a
 *                config key, a name, a booking reference. `term` records it,
 *                and eval/check.mjs verifies it is in every relevant document.
 *                Many terms have a near-miss elsewhere in the corpus
 *                (INC-2291 / INC-2219) or are mentioned by a second document
 *                that does not answer the question.
 *   MIXED        An ordinary question that names one thing (a carrier, a
 *                customer, a tool) and paraphrases the rest. This is what most
 *                real queries look like.
 *
 * and more of the three kinds gold.mjs has, with one change: the TEMPORAL
 * pairs here that end in -a / -b are word-for-word the same except for one
 * value, so only their dates can separate them.
 *
 * Frozen before any weight was swept (see README.md, "Label before tuning").
 * `relevant` may list two documents when both genuinely answer.
 */

const exact = (q, term, relevant, extra = {}) => ({
  q,
  term,
  relevant: [].concat(relevant),
  kind: "exact-term",
  ...extra,
});
const mixed = (q, relevant) => ({ q, relevant: [].concat(relevant), kind: "mixed" });
const para = (q, relevant) => ({ q, relevant: [].concat(relevant), kind: "paraphrase" });
const temporal = (q, relevant, stale) => ({
  q,
  relevant: [relevant],
  stale: [stale],
  kind: "temporal",
});
const hard = (q, relevant, stale) => ({
  q,
  relevant: [].concat(relevant),
  ...(stale ? { stale: [stale] } : {}),
  kind: "hard-negative",
});

export const GOLD_2 = [
  // ── exact-term ─────────────────────────────────────────────────────────
  exact("INC-2291", "INC-2291", "inc-2291-postmortem"),
  exact("INC-2219", "INC-2219", "inc-2219-postmortem"),
  exact("INC-2292", "INC-2292", "inc-2292-followup"),
  exact("what happened in INC-2304", "INC-2304", "inc-2304"),
  exact("INC-2188 root cause", "INC-2188", "inc-2188"),
  exact("ERR_CUSTOMS_4012", "ERR_CUSTOMS_4012", "err-customs-4012"),
  exact("ERR_CUSTOMS_4021", "ERR_CUSTOMS_4021", "err-customs-4021"),
  exact("ERR_LABEL_5107", "ERR_LABEL_5107", "err-label-5107"),
  exact("what does ERR_BOOK_3300 mean", "ERR_BOOK_3300", "err-book-3300"),
  exact("TRACKING_DEDUPE_WINDOW_S", "TRACKING_DEDUPE_WINDOW_S", "cfg-dedupe-window"),
  exact("carrier.retry.max_attempts", "carrier.retry.max_attempts", "cfg-retry-max"),
  exact("what is wrong with ingest-edge-03", "ingest-edge-03", [
    "host-ingest-edge-03",
    "daily-ops-1",
  ]),
  exact("what is pg-replica-ams2 for", "pg-replica-ams2", "host-db-replica"),
  exact("ff_multi_leg_timeline", "ff_multi_leg_timeline", "flag-multi-leg"),
  exact("ff_eta_v2", "ff_eta_v2", "flag-eta"),
  exact("who is Tomasz Wieczorek", "Tomasz Wieczorek", "person-tomasz"),
  exact("Anneke de Vries", "Anneke de Vries", "person-anneke"),
  exact("Priya Nair", "Priya Nair", "person-priya"),
  exact("Yuki Tanabe", "Yuki Tanabe", "person-yuki"),
  exact("Mateus Oliveira", "Mateus Oliveira", "person-mateus"),
  exact("Lars Bakken", "Lars Bakken", ["person-ingrid-cover", "daily-ops-4"]),
  exact("Sigrid Aune", "Sigrid Aune", "daily-ops-1"),
  exact("PO 4500017731", "4500017731", "ref-po-number"),
  exact("V84.20.18Z", "V84.20.18Z", "ref-zebra-fw"),
  exact("CASE-88213", "CASE-88213", "daily-ops-1"),
  exact("DSP-0457", "DSP-0457", "daily-ops-2"),
  exact("ENG-1420", "ENG-1420", "daily-ops-2"),
  exact("flight KL1143", "KL1143", "daily-personal-2"),
  exact("QX7RML", "QX7RML", "daily-personal-2"),
  exact("KR-482-B", "KR-482-B", "user-car"),
  exact("first_scan_depot", "first_scan_depot", "daily-ops-3"),
  exact("NL861234567B01", "NL861234567B01", "ref-vat"),
  exact("SSCC prefix 8719333", "8719333", "ref-sscc"),
  exact("pg_repack", "pg_repack", "runbook-repack"),
  exact("kubectl rollout restart", "kubectl rollout restart", "runbook-rollout"),
  exact("Karl Johans gate", "Karl Johans gate", "daily-personal-2"),

  // ── mixed: names one thing, paraphrases the rest ───────────────────────
  mixed("why does the Maersk adapter wait so long before giving up", [
    "carrier-maersk-retry",
    "cfg-retry-max",
  ]),
  mixed("what does PostNord need for a locker delivery", ["carrier-postnord", "daily-ops-2"]),
  mixed("which carrier takes the Veldkamp bicycle boxes", "cust-veldkamp"),
  mixed("what did Nordlys dispute on their February bill", "cust-nordlys-dispute"),
  mixed("what is special about deliveries for Brouwerij De Kraan", "cust-kraan"),
  mixed("which Node version does the label renderer run on", "versions-pinned"),
  mixed("which Postgres version are the services on", "versions-pinned"),
  mixed("when does the Bring sandbox lose its bookings", "ref-sandbox-accounts"),
  mixed("how are DSV timestamps converted", "carrier-dsv"),
  mixed("why does DHL hold some parcels at the hub", "carrier-dhl-customs"),
  mixed("what is wrong with a GB EORI on an EU export", "err-customs-4021"),
  mixed("where do carrier invoice disputes get raised", ["person-ingrid", "ref-channels"]),
  mixed("what time must a Gdańsk order be booked to leave the same day", [
    "ref-cutoffs",
    "daily-ops-3",
  ]),
  mixed("is Saturday delivery available in Germany", "proj-sat-delivery"),
  mixed("can lithium batteries be sent by air", "proj-dangerous-goods"),
  mixed("how do I restart the ingest workers", "runbook-rollout"),
  mixed("how to shrink a bloated tracking_events partition", "runbook-repack"),
  mixed("when does the nightly reconciliation job run", "cron-reconcile"),
  mixed("which firmware release fixes the ZT411 cutter", "daily-ops-4"),
  mixed("why did booking errors spike for Bring", "daily-ops-3"),
  mixed("when is the dentist appointment with Dr. Halvorsen", "daily-personal-1"),
  mixed("which room is the parents' evening in", "daily-personal-1"),
  mixed("what does the Tryg car insurance renewal cost", "daily-personal-1"),
  mixed("where are the Volvo's winter tyres kept", "user-car"),
  mixed("which pharmacy gets the prescriptions", "user-doctor"),
  mixed("what temperature range do Halden Medical kits need", "cust-halden"),
  mixed("when is Gdańsk closed in January", "ref-closures"),
  mixed("which port does the label renderer listen on", "ref-ports"),
  mixed("what did DSV ask for before adding a second Friday pickup", "daily-ops-1"),
  mixed("how long should both buses run in parallel during the Kafka migration", "daily-ops-3"),

  // ── paraphrase: no distinctive word shared with the answer ─────────────
  para("why did we stop rewarding couriers for each drop", "proj-driver-pay"),
  para("how much is a package covered for if nothing extra is bought", "proj-insurance-cap"),
  para("are the CO2 numbers given to customers real measurements", "proj-carbon-report"),
  para("how often are partner API passwords changed", "ref-secrets"),
  para("how far back can the database be rewound after a mistake", "ref-backup"),
  para("what must never be copied into automated checks", "pref-test-data"),
  para("how should a write-up be ordered", "pref-summary-first"),
  para("which language variant do customers read", "pref-british-spelling"),
  para("when is the start of the week kept clear", "pref-no-monday-early"),
  para("may a reply to a haulier go out unreviewed", "pref-no-auto-send"),
  para("how big may a code change be before it has to be broken up", "pref-pr-size"),
  para("what to write down after phoning a client", "pref-call-notes"),
  para("which foods are off the table when booking dinner", "user-diet"),
  para("where do I like to sit on a plane", "user-travel"),
  para("when do the kids have sport", "user-family"),
  para("why were the warehouse automation machines turned down", "proj-warehouse-robots"),
  para("did suggesting delivery locations while typing help", "proj-address-autocomplete"),
  para("two abbreviations people mix up in shift notes", "ref-glossary"),
  para("which database server should accountants' reports query", "host-db-replica"),
  para("when is the heating engineer visiting the flat", "daily-personal-1"),
  para("what present did my mother hint at", "daily-personal-1"),
  para("how much will the fitness club cost after the summer", "daily-personal-2"),
  para("how long does my aunt's casserole stay in the oven", "daily-personal-2"),
  para("what small compensation can the helpdesk grant by itself", "daily-ops-1"),
  para("when is the outside security firm attacking our systems", "daily-ops-2"),
  para("what are customers moaning about most", "daily-ops-3"),
  para("will hauliers get to see how we rate them", "daily-ops-4"),
  para("how much dearer would the new Norwegian site be to serve", "daily-ops-2"),
  para("which host must not be served seafood this week", "daily-personal-2"),
  para("what will the cycle repair cost", "daily-personal-1"),
  para("does a free returns slip cost anything if unused", "proj-returns-labels"),
  para("what happens to a consignment note bigger than the paper roll", "err-label-5107"),
  para(
    "why is one of the intake machines taken out of rotation before the weekend",
    "host-ingest-edge-03",
  ),

  // ── temporal: the -a/-b pairs differ only in one value and in date ─────
  temporal("how long is one on-call shift", "oncall-rotation-b", "oncall-rotation-a"),
  temporal("on which days can we release to production", "deploy-window-b", "deploy-window-a"),
  temporal("which label format does a new depot start with", "label-format-b", "label-format-a"),
  temporal("how quickly must support answer a ticket", "support-sla-b", "support-sla-a"),
  temporal("how much can a team lead approve alone", "expense-limit-b", "expense-limit-a"),
  temporal(
    "how long may a Halden Medical parcel be out of range before the penalty applies",
    "cust-halden-renewal",
    "cust-halden",
  ),
  temporal(
    "does a British recipient still pay import duty to the courier",
    "proj-customs-preclear",
    "proj-customs-ddu",
  ),

  // ── hard negatives ─────────────────────────────────────────────────────
  hard(
    "who covers invoice disputes while Ingrid is away",
    ["person-ingrid-cover", "daily-ops-4"],
    "person-ingrid",
  ),
  hard("who decides shift rosters in Rotterdam", "person-anneke", "person-tomasz"),
  hard("when is API v1 switched off", "proj-api-v1-sunset", "proj-api-v2-stays"),
  hard("is API v2 being retired as well", "proj-api-v2-stays", "proj-api-v1-sunset"),
  hard("what did the Utrecht locker trial show", "proj-locker-pilot", "proj-locker-rejected"),
  hard("why is there no locker trial in Malmö", "proj-locker-rejected", "proj-locker-pilot"),
  hard("do we deliver on Sundays", "proj-sunday", "proj-sat-delivery"),
  hard("which incident showed one customer's parcels to another", "inc-2188"),
  hard("which incident got us locked out by a carrier", "inc-2219-postmortem"),
  hard("which incident sent a customer the same bills twice", "inc-2304"),
  hard(
    "which error is about a missing tariff classification",
    "err-customs-4012",
    "err-customs-4021",
  ),
  hard("which feature flag is only partly rolled out", "flag-multi-leg", "flag-eta"),

  // ── unanswerable: several look like the identifiers above ──────────────
  { q: "INC-3051", relevant: [], kind: "unanswerable" },
  { q: "ERR_CUSTOMS_4099", relevant: [], kind: "unanswerable" },
  { q: "PO 4500019999", relevant: [], kind: "unanswerable" },
  { q: "who is Henrik Dahl", relevant: [], kind: "unanswerable" },
  { q: "what is the office alarm code", relevant: [], kind: "unanswerable" },
  { q: "what did we decide about drone delivery", relevant: [], kind: "unanswerable" },
  { q: "when is the company offsite", relevant: [], kind: "unanswerable" },
  { q: "what is the salary band for a senior engineer", relevant: [], kind: "unanswerable" },
];
