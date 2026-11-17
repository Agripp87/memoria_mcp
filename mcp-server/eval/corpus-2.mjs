/**
 * The second, larger part of the evaluation corpus (2026-11).
 *
 * corpus.mjs has 51 single-paragraph documents and a gold set whose queries
 * all avoid their answer's wording. That measures the vector half and is, by
 * construction, unfair to keyword matching: nobody in it ever searches for a
 * ticket number. This file adds what a real store also holds and the first
 * corpus had none of:
 *
 *   1. IDENTIFIERS. Incident numbers, error codes, config keys, host names,
 *      people, customers, order and booking references. Many come in
 *      near-miss pairs (INC-2291 / INC-2219, ERR_CUSTOMS_4012 / _4021), and
 *      several are mentioned in a second document that is not the answer.
 *   2. DATE-ONLY PAIRS. Five decisions exist twice with the same title and
 *      the same sentences, differing in one value and in their date. Neither
 *      vectors nor keywords can prefer one; only recency can. (The first
 *      corpus's temporal pairs were also separable on content: caveat 4 in
 *      README.md.)
 *   3. LONG FILES. Six daily logs of seven or so entries each, long enough to
 *      be split into several chunks, with the answer in one entry. Every
 *      document in corpus.mjs is a single chunk.
 *   4. A SECOND REGISTER. Some personal notes (family, travel, appointments)
 *      next to the logistics company, because a memory store is rarely about
 *      one subject.
 *
 * Same conventions as corpus.mjs: `day` counts back from the run, and
 * `importance` is invented (caveat 3 still applies).
 *
 * Rows: [id, type, day, importance, title, body].
 */

const DOCS = [
  // ─── Incidents: numbered, with near-miss numbers and cross-references ────
  [
    "inc-2291-postmortem",
    "project",
    52,
    0.8,
    "INC-2291 — customs paperwork printed with the wrong HS code",
    `INC-2291: for nine hours the Antwerp depot printed commercial invoices
carrying the HS code of the previous shipment in the batch. Root cause was a
template cache keyed by batch instead of by shipment. 212 parcels were held at
Belgian customs; all were released within two days once corrected paperwork
arrived. Fix: the cache key includes the shipment id.`,
  ],
  [
    "inc-2219-postmortem",
    "project",
    131,
    0.7,
    "INC-2219 — PostNord suspended our account for a day",
    `INC-2219: PostNord suspended our API account for 26 hours after a retry
loop sent the same booking request 40,000 times. Root cause was a missing
idempotency key on the booking call. Fix: bookings carry an idempotency key and
the retry budget is capped at five attempts per booking.`,
  ],
  [
    "inc-2292-followup",
    "project",
    48,
    0.5,
    "INC-2292 — audit of the other document templates",
    `INC-2292 was opened as the follow-up to the customs paperwork incident
(INC-2291). The other eleven document templates were audited for the same
caching mistake. Two more, the packing list and the dangerous-goods note, shared
it and were fixed before they caused harm.`,
  ],
  [
    "inc-2304",
    "project",
    20,
    0.75,
    "INC-2304 — duplicate invoices sent to Halden Medical",
    `INC-2304: Halden Medical received every March invoice twice. Root cause
was the invoice mailer being started by hand while the scheduled run was still
in progress. No money moved twice, but their accounts team spent two days
reconciling. Fix: the mailer takes a lock and refuses a second run.`,
  ],
  [
    "inc-2188",
    "project",
    210,
    0.6,
    "INC-2188 — tracking pages served across tenants",
    `INC-2188: for eleven minutes a cache misconfiguration served tracking
pages across tenants, and 37 page views showed a parcel belonging to another
shipper. Reported to the Dutch data protection authority inside the 72-hour
window. Fix: the tenant id is part of every cache key and a test asserts it.`,
  ],

  // ─── Error codes: near-identical names, different meanings ───────────────
  [
    "err-customs-4012",
    "reference",
    95,
    0.5,
    "ERR_CUSTOMS_4012 — line item without an HS code",
    `ERR_CUSTOMS_4012 means a line item has no HS code. The shipper has to
supply it; we never guess. Most cases are new SKUs added in the shipper's
webshop without the customs field. Reply with the SKU list and a link to the
customs profile page.`,
  ],
  [
    "err-customs-4021",
    "reference",
    93,
    0.5,
    "ERR_CUSTOMS_4021 — EORI number rejected",
    `ERR_CUSTOMS_4021 means the EORI number failed validation at the customs
gateway. Usually a UK shipper still using a GB-prefixed EORI for an EU export,
which needs an XI or EU number instead. Nothing we can fix on our side.`,
  ],
  [
    "err-label-5107",
    "reference",
    160,
    0.45,
    "ERR_LABEL_5107 — label larger than the media",
    `ERR_LABEL_5107 is raised when the rendered label is larger than the
printer's configured media. Almost always a depot that switched from 4x6 to A6
rolls without updating the printer profile. Fix the profile; do not scale the
label.`,
  ],
  [
    "err-book-3300",
    "reference",
    140,
    0.5,
    "ERR_BOOK_3300 — pickup window refused",
    `ERR_BOOK_3300 comes back when the requested pickup window is past the
carrier's cut-off. DSV cuts off at 15:00 local time, Bring at 16:30. The console
should grey out impossible windows; until it does, tell the shipper the
cut-off.`,
  ],

  // ─── Configuration, hosts, flags, runbooks ───────────────────────────────
  [
    "cfg-dedupe-window",
    "reference",
    75,
    0.55,
    "TRACKING_DEDUPE_WINDOW_S",
    `TRACKING_DEDUPE_WINDOW_S is 900. Two tracking events with the same
carrier reference and status inside fifteen minutes are treated as one. It was
300 until the webhook storm showed that carriers replay with longer gaps than
that.`,
  ],
  [
    "cfg-retry-max",
    "reference",
    128,
    0.55,
    "carrier.retry.max_attempts",
    `carrier.retry.max_attempts defaults to 5 and applies per booking, not per
request. Maersk overrides it to 8 with a longer backoff, because their gateway
answers 503 for whole minutes around vessel cut-offs.`,
  ],
  [
    "host-ingest-edge-03",
    "reference",
    33,
    0.4,
    "ingest-edge-03 runs hot",
    `ingest-edge-03 has run fifteen degrees hotter than its siblings since the
rack move. A hardware ticket is open with the colocation provider. It is
drained from the pool on Friday afternoons, when the weekly volume peak hits, to
be safe.`,
  ],
  [
    "host-db-replica",
    "reference",
    66,
    0.5,
    "pg-replica-ams2 is the reporting replica",
    `pg-replica-ams2 is the read replica that finance and the reporting jobs
use. It lags by up to ninety seconds during the nightly reconciliation. Never
point the console at it.`,
  ],
  [
    "flag-multi-leg",
    "reference",
    40,
    0.5,
    "ff_multi_leg_timeline rollout",
    `ff_multi_leg_timeline is on for 25% of shippers. Hold at 25% until the
support queue confirms nobody reads the merged timeline as missing scans. Full
rollout needs Dana's sign-off.`,
  ],
  [
    "flag-eta",
    "reference",
    58,
    0.45,
    "ff_eta_v2 stays off",
    `ff_eta_v2 stays off. The new estimate model was better on average and
worse on islands and ferry routes, where a wrong date is expensive. Revisit
when the ferry timetable feed is in.`,
  ],
  [
    "cron-reconcile",
    "reference",
    115,
    0.4,
    "Nightly reconciliation job",
    `The reconciliation job runs at 02:30 UTC (cron 30 2 * * *) and takes
about forty minutes. It must finish before the 04:00 carrier invoice import,
which assumes reconciled data.`,
  ],
  [
    "runbook-rollout",
    "reference",
    88,
    0.5,
    "Restarting the ingest workers",
    `To restart ingest safely: kubectl rollout restart deploy/ingest-worker -n
tracking, then watch the lag panel. Never delete pods by hand; a rolling restart
keeps two thirds of the consumers attached throughout.`,
  ],
  [
    "runbook-repack",
    "reference",
    170,
    0.45,
    "Reclaiming table bloat",
    `tracking_events bloats after large backfills. Use pg_repack on the
affected partition, never VACUUM FULL, which takes a lock that stops writes. Run
it outside 06:00 to 20:00 CET.`,
  ],
  [
    "versions-pinned",
    "reference",
    62,
    0.4,
    "Pinned runtime versions",
    `Services run Node 22.11 and Postgres 16.4. The label renderer is the
exception: it is pinned to Node 20.18, because the PDF library it uses has a
native module that does not build on 22.`,
  ],

  // ─── People ──────────────────────────────────────────────────────────────
  [
    "person-ingrid",
    "reference",
    100,
    0.55,
    "Ingrid Solberg — finance",
    `Ingrid Solberg runs finance operations. She owns carrier invoice disputes
and the month-end close, and wants disputes raised in the finance queue, not by
direct message. Out every other Friday.`,
  ],
  [
    "person-ingrid-cover",
    "reference",
    25,
    0.45,
    "Finance cover while Ingrid is away",
    `While Ingrid Solberg is on leave until the end of the month, Lars Bakken
covers invoice disputes. The month-end close is unchanged and still hers when
she is back.`,
  ],
  [
    "person-tomasz",
    "reference",
    155,
    0.5,
    "Tomasz Wieczorek — Gdańsk depot",
    `Tomasz Wieczorek manages the Gdańsk depot. He decides the shift rosters
and is the person to call when a truck is turned away at the gate. Prefers a
phone call to a ticket for anything happening today.`,
  ],
  [
    "person-anneke",
    "reference",
    180,
    0.5,
    "Anneke de Vries — Rotterdam depot",
    `Anneke de Vries manages the Rotterdam depot. She decides the shift
rosters there and signs off any change to slotting. Prefers changes proposed in
writing a week ahead.`,
  ],
  [
    "person-priya",
    "reference",
    85,
    0.6,
    "Priya Nair — security",
    `Priya Nair leads security. Anything touching customer data exports, new
third-party processors or penetration test scheduling goes through her first.
She runs the quarterly access review.`,
  ],
  [
    "person-mateus",
    "reference",
    60,
    0.5,
    "Mateus Oliveira — support lead",
    `Mateus Oliveira leads the support team. He owns the macros, the
escalation ladder and the weekly digest of what shippers complained about most.
Based in Porto.`,
  ],
  [
    "person-yuki",
    "reference",
    45,
    0.5,
    "Yuki Tanabe — data",
    `Yuki Tanabe owns the analytics warehouse and the carrier scorecard
pipeline. Ask her before adding a column to the events export; three dashboards
break quietly when the schema moves.`,
  ],

  // ─── Customers ───────────────────────────────────────────────────────────
  [
    "cust-nordlys",
    "project",
    70,
    0.65,
    "Nordlys Outdoor — account notes",
    `Nordlys Outdoor ships tents and stoves from Tromsø. Their contract
guarantees a pickup every weekday, including the polar-night months when the
regular carrier drops to three days a week. We subcontract the missing two days
and absorb the cost.`,
  ],
  [
    "cust-nordlys-dispute",
    "project",
    36,
    0.5,
    "Nordlys Outdoor — February invoice dispute",
    `Nordlys Outdoor disputed the February invoice: they had been billed the
subcontractor surcharge for the two extra pickup days. That cost is ours to
absorb under the contract. Credit note issued and the billing rule corrected.`,
  ],
  [
    "cust-kraan",
    "project",
    98,
    0.6,
    "Brouwerij De Kraan — account notes",
    `Brouwerij De Kraan ships beer, so every parcel needs an age check at the
door. They pay for signature on delivery on all consignments and will not
accept safe-place delivery under any circumstances.`,
  ],
  [
    "cust-halden",
    "project",
    255,
    0.7,
    "Halden Medical — account notes",
    `Halden Medical ships diagnostic kits that must stay between 2 and 8
degrees. A contract penalty applies per parcel for any excursion over thirty
minutes. Their logistics contact wants a phone call, not an email, the moment
an alert fires.`,
  ],
  [
    "cust-halden-renewal",
    "project",
    18,
    0.6,
    "Halden Medical — renewal terms agreed",
    `Halden Medical renewed for three years. The price is fixed for the first
eighteen months, then indexed. The per-parcel excursion penalty stays, but the
threshold moved from thirty minutes to forty-five.`,
  ],
  [
    "cust-veldkamp",
    "project",
    120,
    0.5,
    "Veldkamp Fietsen — account notes",
    `Veldkamp Fietsen ships assembled bicycles. The boxes are oversize for
every carrier except DSV, so they are DSV-only, and any rerouting must be
approved by their warehouse lead first.`,
  ],

  // ─── Carriers ────────────────────────────────────────────────────────────
  [
    "carrier-dsv",
    "reference",
    145,
    0.5,
    "DSV quirks",
    `DSV accepts oversize parcels up to 240 cm that nobody else will take.
Their tracking API returns local time without an offset, so every timestamp is
converted using the depot's timezone, not the server's.`,
  ],
  [
    "carrier-bring",
    "reference",
    150,
    0.5,
    "Bring quirks",
    `Bring covers northern Norway with reduced frequency in winter. Their
webhooks arrive in batches every ten minutes rather than per event, so a quiet
ten minutes is normal and not an outage.`,
  ],
  [
    "carrier-postnord",
    "reference",
    125,
    0.5,
    "PostNord quirks",
    `PostNord requires the recipient's mobile number for parcel-locker
delivery; without it the parcel goes to a staffed pickup point instead. Their
sandbox does not enforce this, production does.`,
  ],
  [
    "carrier-maersk-retry",
    "reference",
    126,
    0.55,
    "Why the Maersk adapter retries differently",
    `Maersk's booking gateway goes unavailable for minutes at a time around
vessel cut-off. A short retry burst simply fails five times, so that adapter
waits up to twelve minutes in total before giving up, unlike every other
carrier.`,
  ],
  [
    "carrier-dhl-customs",
    "reference",
    138,
    0.5,
    "DHL customs paperwork",
    `DHL wants the commercial invoice as structured data, not a PDF. A
PDF-only booking is accepted and then held at the hub until someone types the
lines in by hand, which adds a day.`,
  ],

  // ─── Date-only pairs: same words, one value differs, only the date tells ──
  [
    "oncall-rotation-a",
    "project",
    260,
    0.6,
    "On-call rotation length",
    `The on-call rotation is one week per engineer, handing over on Monday at
10:00 CET. Swaps are arranged between engineers and noted in the schedule.`,
  ],
  [
    "oncall-rotation-b",
    "project",
    28,
    0.6,
    "On-call rotation length",
    `The on-call rotation is two weeks per engineer, handing over on Wednesday
at 10:00 CET. Swaps are arranged between engineers and noted in the schedule.`,
  ],
  [
    "deploy-window-a",
    "project",
    230,
    0.6,
    "Production deploy window",
    `Production deploys happen on Tuesdays and Thursdays between 09:00 and
12:00 CET. Anything outside that needs the on-call engineer's agreement.`,
  ],
  [
    "deploy-window-b",
    "project",
    34,
    0.6,
    "Production deploy window",
    `Production deploys happen on any weekday between 09:00 and 14:00 CET.
Anything outside that needs the on-call engineer's agreement.`,
  ],
  [
    "label-format-a",
    "project",
    280,
    0.5,
    "Default label format",
    `New depots are set up with PDF labels by default. Other formats are
available on request, per printer.`,
  ],
  [
    "label-format-b",
    "project",
    50,
    0.5,
    "Default label format",
    `New depots are set up with ZPL labels by default. Other formats are
available on request, per printer.`,
  ],
  [
    "support-sla-a",
    "project",
    250,
    0.6,
    "Support first-response target",
    `Support answers every shipper ticket within four working hours. Tickets
marked urgent by the shipper are answered within one hour.`,
  ],
  [
    "support-sla-b",
    "project",
    42,
    0.6,
    "Support first-response target",
    `Support answers every shipper ticket within two working hours. Tickets
marked urgent by the shipper are answered within thirty minutes.`,
  ],
  [
    "expense-limit-a",
    "project",
    290,
    0.4,
    "Expense approval limit",
    `Team leads approve expenses up to 500 euros without a second signature.
Above that, finance countersigns.`,
  ],
  [
    "expense-limit-b",
    "project",
    22,
    0.4,
    "Expense approval limit",
    `Team leads approve expenses up to 1,000 euros without a second
signature. Above that, finance countersigns.`,
  ],

  // ─── Preferences and working agreements ──────────────────────────────────
  [
    "pref-british-spelling",
    "feedback",
    90,
    0.7,
    "Spelling in shipper-facing text",
    `Use British spelling in anything a shipper reads: colour, organise,
cancelled. Internal documents can be whatever the author writes.`,
  ],
  [
    "pref-no-monday-early",
    "feedback",
    65,
    0.7,
    "Nothing before ten on Mondays",
    `Do not book anything before 10:00 on a Monday. That slot is for reading
the weekend's incident channel and the support digest, and it gets defended.`,
  ],
  [
    "pref-summary-first",
    "feedback",
    110,
    0.75,
    "Lead with the conclusion",
    `When writing anything up, put the conclusion and the ask in the first two
lines, then the reasoning. People who need the detail will read on; everyone
else already has what they need.`,
  ],
  [
    "pref-metric-units",
    "feedback",
    200,
    0.5,
    "Units",
    `Metric units everywhere, including in conversations with UK shippers.
Weights in kilograms, dimensions in centimetres. Pounds and inches have caused
two mis-quotes.`,
  ],
  [
    "pref-no-auto-send",
    "feedback",
    30,
    0.85,
    "Never send external email without showing it first",
    `Drafts to shippers or carriers are always shown for approval before they
are sent. No exceptions for follow-ups or one-line replies; a wrong sentence to
a carrier account manager is expensive.`,
  ],
  [
    "pref-pr-size",
    "feedback",
    77,
    0.6,
    "Small pull requests",
    `Keep pull requests under roughly four hundred changed lines. Bigger ones
get split, even if the split is artificial, because nobody reviews a
two-thousand-line diff properly.`,
  ],
  [
    "pref-test-data",
    "feedback",
    58,
    0.65,
    "No production data in test fixtures",
    `Test fixtures are synthetic. Copying a real shipment into a fixture, even
with the name removed, is not allowed; addresses identify people.`,
  ],
  [
    "pref-call-notes",
    "feedback",
    44,
    0.6,
    "Notes after every shipper call",
    `After any call with a shipper, write three lines in the account notes the
same day: what they asked, what was promised, and by when. Memory of a promise
is not a record of it.`,
  ],

  // ─── Decisions and projects (several are hard-negative pairs) ────────────
  [
    "proj-customs-preclear",
    "project",
    68,
    0.65,
    "Pre-clearance for UK exports",
    `UK-bound parcels are pre-cleared: duties are calculated and charged at
checkout, so nothing is collected at the door. Refused-delivery rates on that
lane dropped by two thirds in the pilot.`,
  ],
  [
    "proj-customs-ddu",
    "project",
    205,
    0.5,
    "UK parcels are delivered duty unpaid",
    `UK parcels go out duty unpaid, because the checkout integration for
duties does not exist yet. The recipient pays the courier at the door, and
about one in nine refuses.`,
  ],
  [
    "proj-locker-pilot",
    "project",
    84,
    0.55,
    "Parcel locker pilot in Utrecht",
    `Ran a twelve-week parcel locker pilot in Utrecht. Lockers cut failed
first-attempt deliveries from 14% to 3%, but a third of parcels were too large
for the largest compartment. Continuing for small-parcel shippers only.`,
  ],
  [
    "proj-locker-rejected",
    "project",
    79,
    0.4,
    "No locker pilot in Malmö",
    `Decided against a second locker pilot in Malmö. The locker operator there
wanted exclusivity for five years, and the parcel mix is mostly oversize.`,
  ],
  [
    "proj-carbon-report",
    "project",
    47,
    0.55,
    "Emissions reporting per shipment",
    `Shippers can download emissions per shipment, calculated from distance,
weight and vehicle class. The figures are estimates under the GLEC framework
and are labelled as such; nobody may quote them as measured.`,
  ],
  [
    "proj-sat-delivery",
    "project",
    132,
    0.5,
    "Saturday delivery",
    `Saturday delivery is offered in the Netherlands and Belgium only. Germany
was dropped after six weeks: volume was a tenth of the forecast and the depot
overtime cost more than the revenue.`,
  ],
  [
    "proj-sunday",
    "project",
    129,
    0.35,
    "Sunday delivery was never offered",
    `Sunday delivery has been asked for by three shippers and declined each
time. Collective labour agreements in two of our countries make it
uneconomic.`,
  ],
  [
    "proj-returns-labels",
    "project",
    73,
    0.5,
    "Return labels in the box",
    `Shippers can have a return label printed and packed with the outbound
parcel. It is only charged if it is scanned. Take-up is highest in fashion and
near zero in electronics.`,
  ],
  [
    "proj-api-v1-sunset",
    "project",
    39,
    0.7,
    "Shipper API v1 is switched off",
    `API v1 is switched off on the last day of the second quarter. Eleven
shippers still call it; each has a named contact and a migration date. No
extensions: the v1 authentication scheme cannot be made safe.`,
  ],
  [
    "proj-api-v2-stays",
    "project",
    37,
    0.5,
    "Shipper API v2 stays",
    `API v2 is not being retired along with v1. It shares v3's authentication
and costs little to keep. It gets security fixes only, no new fields.`,
  ],
  [
    "proj-warehouse-robots",
    "project",
    190,
    0.45,
    "Goods-to-person robots evaluated",
    `Evaluated goods-to-person robots for the Rotterdam mezzanine. Payback was
nine years at current volumes, so no. The floor loading survey done for it is
reusable.`,
  ],
  [
    "proj-driver-pay",
    "project",
    142,
    0.5,
    "Per-stop bonus dropped",
    `The per-stop driver bonus was dropped after it pushed drivers to mark
parcels as attempted without ringing. Base pay went up by the average bonus, so
nobody lost out.`,
  ],
  [
    "proj-address-autocomplete",
    "project",
    53,
    0.5,
    "Address autocomplete at booking",
    `Booking now autocompletes addresses from a postal database.
Undeliverable-address exceptions fell by 40% in the first month. Ireland and
Malta are excluded; coverage there is too thin to trust.`,
  ],
  [
    "proj-insurance-cap",
    "project",
    112,
    0.55,
    "Default insured value",
    `Parcels are insured to 500 euros by default. Higher cover is bought per
shipment at booking and cannot be added after pickup, because that is exactly
when people discover they need it.`,
  ],
  [
    "proj-dangerous-goods",
    "project",
    165,
    0.6,
    "Lithium batteries",
    `Lithium batteries ship by road only, never by air, and only for shippers
who have completed the dangerous-goods questionnaire. The console blocks the
booking otherwise; there is no override.`,
  ],

  // ─── Reference facts with exact numbers ──────────────────────────────────
  [
    "ref-po-number",
    "reference",
    27,
    0.4,
    "Purchase order for the scanner fleet",
    `The scanner order went out under PO 4500017731 for 180 units. Delivery is
in three batches; the second batch is the one with the extended batteries for
the cold store.`,
  ],
  [
    "ref-vat",
    "reference",
    240,
    0.35,
    "VAT registration numbers",
    `Dutch entity VAT id NL861234567B01; Belgian entity BE0723456789. Invoices
for Antwerp pickups must carry the Belgian one.`,
  ],
  [
    "ref-sscc",
    "reference",
    175,
    0.4,
    "SSCC pallet labels",
    `Pallet labels carry an 18-digit SSCC. Ours start with the company prefix
8719333. A label whose SSCC fails the check digit is rejected at the depot
gate.`,
  ],
  [
    "ref-zebra-fw",
    "reference",
    54,
    0.45,
    "Zebra firmware pin",
    `Depot printers are pinned to firmware V84.20.18Z. V84.20.21Z fixed the
address truncation but broke the cutter on the ZT411, so the pin stays until
the next release.`,
  ],
  [
    "ref-ports",
    "reference",
    195,
    0.35,
    "Service ports",
    `Ingest listens on 8443, the console on 8080 behind the proxy, the label
renderer on 9102. Metrics for all three are on 9464.`,
  ],
  [
    "ref-channels",
    "reference",
    80,
    0.4,
    "Where to ask what",
    `#ops-incidents for anything live, #carrier-desk for carrier questions,
#finance-queue for invoice disputes, #depot-rtm and #depot-gdn for the depots.
Do not start incidents in direct messages.`,
  ],
  [
    "ref-cutoffs",
    "reference",
    148,
    0.5,
    "Same-day dispatch cut-off times",
    `Orders booked before 14:00 CET leave the Rotterdam depot the same day.
Gdańsk cuts off at 13:00, because its line-haul leaves earlier. Antwerp has no
same-day dispatch.`,
  ],
  [
    "ref-closures",
    "reference",
    12,
    0.4,
    "Depot closures this winter",
    `All depots close on 25 and 26 December and on 1 January. Gdańsk also
closes on 6 January. Rotterdam runs a half shift on 24 and 31 December.`,
  ],
  [
    "ref-glossary",
    "reference",
    220,
    0.35,
    "What RTS and RTD mean here",
    `RTS is return to sender. RTD is ready to dispatch: packed, labelled and
waiting for the line-haul. They are one letter apart and regularly confused in
handover notes.`,
  ],
  [
    "ref-backup",
    "reference",
    102,
    0.55,
    "Backups",
    `Postgres is backed up continuously, with point-in-time recovery for 14
days and a weekly full copy kept for a year in a second region. Restores are
rehearsed every quarter; the last one took 47 minutes.`,
  ],
  [
    "ref-secrets",
    "reference",
    91,
    0.5,
    "Carrier credentials rotation",
    `Carrier API credentials rotate every 90 days. DHL and DSV support two
live keys, so rotation is seamless; PostNord does not, so theirs is rotated in
the Sunday maintenance window.`,
  ],
  [
    "ref-sandbox-accounts",
    "reference",
    135,
    0.35,
    "Sandbox logins",
    `Each carrier sandbox has one shared account, stored in the team vault
under carrier-sandbox. Bring's sandbox resets every night at midnight Oslo time
and forgets all bookings.`,
  ],

  // ─── Personal notes: a second register ───────────────────────────────────
  [
    "user-diet",
    "user",
    150,
    0.6,
    "Food",
    `No coriander, and nothing with hazelnuts. The second is an allergy, not a
preference. Restaurant bookings should mention it.`,
  ],
  [
    "user-travel",
    "user",
    95,
    0.55,
    "Travel preferences",
    `Aisle seat, morning flights, and a hotel within walking distance of the
meeting. Never a connection under ninety minutes at Frankfurt.`,
  ],
  [
    "user-family",
    "user",
    300,
    0.5,
    "Family",
    `Partner Elin; children Jonas (9) and Mari (6). Jonas has football on
Wednesdays at 17:00 and Mari swims on Saturdays at 09:30.`,
  ],
  [
    "user-car",
    "user",
    180,
    0.4,
    "Car",
    `Volvo V60, registration KR-482-B. Winter tyres are stored at
Dekkhotellet. A service is due every 30,000 km; the last one was at 61,400.`,
  ],
  [
    "user-doctor",
    "user",
    210,
    0.45,
    "Doctors",
    `The GP is Dr. Lindqvist at the Oosterpark practice; the dentist is Dr.
Halvorsen. Prescriptions go to the pharmacy on Linnaeusstraat.`,
  ],
  [
    "user-subscriptions",
    "user",
    75,
    0.35,
    "Subscriptions",
    `The newspaper's digital plan renews in September at 14 euros a month.
Cloud storage is the 2 TB plan shared with Elin. Music is the family plan.`,
  ],

  // ─── Daily logs: long, several entries, split into more than one chunk ───
  [
    "daily-ops-1",
    "daily",
    16,
    0.5,
    "Daily log",
    `## 07:40 UTC — Email

From Tomasz Wieczorek: the gate scanner at Gdańsk dock 4 has been dead since
the night shift. They are scanning with a handheld, which doubles the time per
truck. He asks for a replacement by Thursday, before the pre-holiday volume.

## 08:15 UTC — Standup

Wei: the new on-call engineer read Bring's batched webhooks as an outage and
paged the carrier desk at night. Adding a line to the runbook. Rahul: the Kafka
migration design review moves to next Tuesday, because two reviewers are out.

## 09:30 UTC — Call

Halden Medical's logistics contact, Sigrid Aune, asked whether excursion alerts
can also be sent by SMS, since their night staff do not read email. Promised an
answer by Friday.

## 11:05 UTC — Decision

Agreed with Mateus: support grants refunds under 25 euros for late delivery on
its own, without finance approval, starting next month. Finance gets a monthly
total instead of a request per case.

## 13:20 UTC — Note

ingest-edge-03 raised its temperature alarm again at the midday peak. The
colocation ticket CASE-88213 is updated with the new readings; they offer a
slot swap next week.

## 15:45 UTC — Email

Veldkamp Fietsen asked for a second DSV pickup on Fridays from May, when the
cycling season starts. Forwarded to the carrier desk to check line-haul space.

## 16:30 UTC — Journal

Long day. The refund threshold conversation took ten minutes and should have
happened a year ago. Most of what we escalate to finance is not worth their
time or ours.

## 17:15 UTC — Email

From the Rotterdam cold store: the scanner batteries from the first delivery
batch last under four hours at two degrees. The second batch, with the extended
batteries, is due in three weeks. Until then the night shift swaps batteries at
the break.

## 17:50 UTC — Note

Checked the peak forecast with the depot leads. Rotterdam expects 1.4 times a
normal week in the first week of December, Gdańsk 1.2. Temporary staff are
booked for both. Antwerp sees no peak, because it has no consumer volume.

## 18:20 UTC — Call

Carrier desk: DSV confirmed line-haul space for a second Friday pickup in
principle, but they want four weeks' notice and a minimum of six pallets.
Passing that back to Veldkamp tomorrow.

## 18:45 UTC — Note

Reminder: the quarterly carrier review deck is due on the 28th. Wei has the
exception data; the on-time figures come from the analytics warehouse.`,
  ],
  [
    "daily-ops-2",
    "daily",
    9,
    0.5,
    "Daily log",
    `## 08:05 UTC — Email

From Ingrid Solberg: DSV's March invoice double-billed the oversize surcharge
on 31 consignments. Dispute raised with the carrier under reference DSP-0457;
she expects a credit on the April invoice.

## 09:00 UTC — Meeting

API v1 check-in. Seven shippers still call it, down from eleven. Brouwerij De
Kraan's integrator says they need until week 26, which is the last possible
week. Everyone else has a date in May.

## 10:40 UTC — Note

Priya Nair: the external penetration test is booked for the week of the 14th.
Staging will be noisy. Do not chase alerts that come from 10.40.0.0/16 that
week; that range is the testers.

## 12:10 UTC — Call

Nordlys Outdoor are opening a second warehouse in Bodø in the autumn and want
the same weekday-pickup guarantee there. Need a quote from the subcontractor
before answering.

## 14:00 UTC — Decision

The label renderer's move to Node 22 is postponed until the PDF library ships a
prebuilt binary. Tracked as ENG-1420. Nothing else is blocked by it.

## 15:30 UTC — Email

PostNord's account manager: from 1 June a locker booking without a mobile
number is rejected outright instead of being quietly sent to a staffed pickup
point. The console needs to make the field mandatory before then.

## 17:10 UTC — Journal

Good progress on the API sunset. The De Kraan date is tight but real.

## 17:45 UTC — Email

From the Antwerp depot: customs asked for sample packs of the three corrected
document templates. Sent by courier today; they expect to close their file
within two weeks.

## 18:10 UTC — Note

The console's booking form still lets a shipper pick a pickup window after the
carrier's cut-off. Raised again with the console team; they say the greyed-out
windows ship in the release after next.

## 18:30 UTC — Call

Mateus: two support agents are leaving in the same month. Hiring takes eight
weeks, so the response target will be tight over the summer. He wants the
macros reviewed to save handling time.

## 19:00 UTC — Note

Read the subcontractor's draft quote for Bodø: about 30% above Tromsø per
pickup, because the round trip is longer. Not sending it on until finance has
seen it.`,
  ],
  [
    "daily-ops-3",
    "daily",
    4,
    0.5,
    "Daily log",
    `## 07:55 UTC — Email

From Yuki Tanabe: the events export gains a column, first_scan_depot, next
sprint. The three dashboards that read the export are already updated, so
nothing should break this time.

## 09:10 UTC — Meeting

Depot leads. Gdańsk wants its same-day cut-off moved from 13:00 to 13:30 once
the new line-haul contract starts. Anneke is against changing Rotterdam's at
all. No decision; Gdańsk to bring departure data next time.

## 10:25 UTC — Note

ERR_BOOK_3300 spiked this morning: 140 in an hour, all of them Bring. Their
cut-off moved to 16:00 for the holiday week and nobody told us. Console copy
updated by hand for now.

## 12:00 UTC — Call

Carrier desk with Maersk: maintenance windows around vessel cut-offs will be
published a week ahead from now on, which lets us pause bookings instead of
retrying into a closed gateway.

## 14:15 UTC — Decision

SMS excursion alerts for Halden Medical are approved as a pilot: two phone
numbers, no charge during the pilot, review after eight weeks.

## 15:40 UTC — Email

From Mateus Oliveira, the support digest: the top complaint is still "tracking
says delivered, nothing here" for safe-place deliveries. Second is being asked
for a mobile number at booking.

## 16:50 UTC — Journal

The Bring cut-off change cost the support team a morning. A carrier
announcements feed would have paid for itself today.

## 17:20 UTC — Email

From the colocation provider: the slot swap for the hot server is scheduled for
Tuesday at 05:00 UTC, with about twenty minutes of downtime for that one
machine.

## 17:45 UTC — Note

Looked at failed first attempts by postcode for the locker shippers. The gain
holds outside city centres too, which was the open question from the pilot.

## 18:15 UTC — Call

Rahul: the Kafka design review went well. The open point is how long to run
both buses in parallel; he wants four weeks, Wei wants two.

## 18:40 UTC — Note

The holiday rota is published. Each depot has a named duty manager for every
closure day, and the carrier desk runs a half shift on the 24th.`,
  ],
  [
    "daily-ops-4",
    "daily",
    21,
    0.5,
    "Daily log",
    `## 08:30 UTC — Meeting

Quarterly access review with Priya. Fourteen dormant console accounts removed.
The 3PL partner accounts move to single sign-on by the end of next month.

## 09:45 UTC — Email

Zebra support: firmware V84.20.23Z is expected next month and fixes the ZT411
cutter fault. Until then the pin stays where it is.

## 11:00 UTC — Note

pg-replica-ams2 lag reached four minutes during the events backfill. Reporting
jobs were paused by hand until it caught up. The backfill should have been
throttled.

## 13:10 UTC — Decision

Carrier scorecards will be shared with the carriers themselves every quarter,
starting with DSV and Bring. They see their own numbers and the anonymous
median, nothing else.

## 14:35 UTC — Call

Brouwerij De Kraan complained about a parcel left with a neighbour, which their
contract forbids. The driver has been retrained and they get a one-off credit
of 40 euros.

## 16:05 UTC — Email

From Lars Bakken: he is covering invoice disputes this month and wants the DSP
number in the subject line of anything sent to the finance queue.

## 17:00 UTC — Journal

Sharing the scorecards is overdue. Carriers argue less with numbers they have
already seen.

## 17:30 UTC — Email

From the label team: three depots still print PDF labels by their own choice.
There is no plan to force a change; the default only applies to depots that are
newly set up.

## 17:55 UTC — Note

Went through the open hardware tickets. The dead gate scanner at Gdańsk is
replaced. Two handhelds in Rotterdam have cracked screens and are with the
repairer.

## 18:20 UTC — Meeting

Short sync with Dana on the merged timeline. Support has seen four tickets
where a shipper read it as missing scans, out of roughly nine hundred users in
the rollout group. She wants one more week before deciding.

## 18:50 UTC — Call

Halden Medical's contact confirmed the two phone numbers for the SMS pilot and
asked for a test message on Monday morning.

## 19:15 UTC — Note

Expenses for the depot visit are filed. The hotel was over the usual rate
because of the trade fair, so that one needs a countersignature.`,
  ],
  [
    "daily-personal-1",
    "daily",
    13,
    0.5,
    "Daily log",
    `## 07:15 UTC — Calendar

Dentist on Thursday at 16:15 with Dr. Halvorsen, moved from Tuesday. Leave the
office by 15:30.

## 08:40 UTC — Email

From the landlord: the boiler is serviced on the 22nd between 08:00 and 12:00
and someone has to be home to let the engineer in. Elin is travelling, so it is
me.

## 10:05 UTC — Note

The passport expires in October. Renewal takes about six weeks and appointments
at the town hall are booked a month out, so book one before June.

## 12:30 UTC — Journal

Ran 8 km along the canal at lunch. The knee was fine for the first time since
February.

## 14:20 UTC — Email

From the school: parents' evening is on the 19th at 18:30 in room B12. Jonas's
teacher wants to talk about moving him up a reading group.

## 16:45 UTC — Note

Car insurance renewal quote from Tryg is 612 euros; last year it was 548. Ask
for a counter-quote before the renewal date.

## 19:10 UTC — Note

Mum's birthday is on the 27th. She mentioned the blue enamel teapot from the
shop in Delft twice, which is as close to a request as she gets.

## 19:40 UTC — Email

From the library: two books have been overdue since the 2nd. The fine is small,
but they block new loans until they are back.

## 20:05 UTC — Note

The bike shop says the rear wheel needs a new rim, about 85 euros, ready on
Friday. Tram until then.

## 20:30 UTC — Email

From the tax office: the provisional assessment for next year has arrived. The
first instalment is due at the end of January; set a reminder two weeks before.

## 20:50 UTC — Note

Elin lands on Sunday at 21:40. Mari wants to come to the airport, which means a
late night before school, so probably not.

## 21:15 UTC — Journal

Cooked for the three of us. Mari ate the fish without negotiating, which has
not happened before.`,
  ],
  [
    "daily-personal-2",
    "daily",
    6,
    0.5,
    "Daily log",
    `## 06:50 UTC — Email

From the airline: flight KL1143 to Oslo on the 3rd now departs at 07:05 instead
of 09:30, from gate D7. Booking reference QX7RML. The earlier time means the
05:40 train.

## 08:20 UTC — Calendar

Physiotherapy on Mondays at 17:30 for six weeks, starting on the 8th. Blocks
the late slot on those days.

## 09:35 UTC — Note

The wifi at the cabin drops when it rains. Restarting the router fixes it; the
password is on the card stuck to the fridge.

## 11:15 UTC — Email

From the bank: a new card arrives by post this week and the old one stops
working on the 30th. Update the card on the train app and the streaming
accounts.

## 13:00 UTC — Journal

Quiet day. Finished the book Elin lent me in the spring.

## 15:25 UTC — Note

Aunt Marit's lamb stew: two hours at 150 degrees, juniper instead of rosemary,
and the potatoes go in for the last forty minutes only.

## 17:40 UTC — Email

From the gym: membership goes up to 39 euros a month from July. Cancelling
needs a month's notice.

## 18:10 UTC — Note

Oslo trip: the hotel is the one by the central station, two nights, breakfast
included. The meeting is a ten-minute walk away, on Karl Johans gate.

## 18:35 UTC — Email

From the electrician: the quote for moving the fuse box is 1,450 euros and the
job takes a day. The earliest date is the second week of next month.

## 19:00 UTC — Calendar

Dinner with Kari and Stein on Friday at 19:30 at their place. Bring wine; Stein
does not eat shellfish.

## 19:25 UTC — Note

The season ticket on the train app ends on the 15th. The monthly pass is
cheaper than daily tickets from eleven working days upwards.

## 19:50 UTC — Email

From the housing association: the bike shed keys are being replaced. Collect
the new key from number 14 before the end of the month.

## 20:15 UTC — Note

Winter jacket for Jonas: size 140 is already too small. Look at the outdoor
shop's sale at the weekend.`,
  ],
];

// ─── Distractors ───────────────────────────────────────────────────────────
// Same purpose as in corpus.mjs: they share vocabulary and entities with the
// answer documents above and answer none of the queries.
const DISTRACTOR_SEEDS_2 = [
  [
    "Gate procedures at Gdańsk",
    "reference",
    "Trucks arriving at Gdańsk without a booking slot wait in the outer yard. The gate has four docks; dock 2 is reserved for the line-haul.",
  ],
  [
    "Antwerp depot scope",
    "reference",
    "Antwerp handles Belgian pickups and the customs paperwork for UK exports. It has no cold store and no oversize lane.",
  ],
  [
    "Cold store alarms",
    "reference",
    "The cold store alarms at 8.5 degrees held for five minutes. The night shift acknowledges on the handheld; an unacknowledged alarm pages the depot manager.",
  ],
  [
    "Excursion reports",
    "reference",
    "Every temperature excursion gets a one-page report with the logger trace attached, sent to the shipper within a working day whether or not a penalty applies.",
  ],
  [
    "Signature capture",
    "reference",
    "Drivers capture signatures on the handheld. A typed name is accepted where the recipient cannot sign on glass; a photograph of the door is not a signature.",
  ],
  [
    "Safe-place delivery rules",
    "reference",
    "Safe-place delivery needs the recipient's opt-in at booking. Without it, the driver takes the parcel to a pickup point after one failed attempt.",
  ],
  [
    "Neighbour delivery",
    "reference",
    "Neighbour delivery is allowed in the Netherlands and Germany unless the shipper has disabled it. The neighbour signs, and the recipient gets a card and an email.",
  ],
  [
    "Oversize surcharge",
    "reference",
    "Parcels over 120 cm on the longest side carry an oversize surcharge, set per carrier. The surcharge is quoted at booking and never added afterwards.",
  ],
  [
    "Line-haul schedule",
    "reference",
    "The line-haul leaves Rotterdam at 19:30 and Gdańsk at 18:00. A missed line-haul means next-day dispatch, so late bookings are held rather than rushed.",
  ],
  [
    "Invoice delivery",
    "reference",
    "Invoices are emailed on the second working day of the month as a PDF with a machine-readable attachment. Shippers on the EDI plan get neither; theirs go over EDI.",
  ],
  [
    "Credit notes",
    "reference",
    "Credit notes are issued by finance only, reference the original invoice number and appear on the next statement. Support can promise one but cannot issue it.",
  ],
  [
    "Refunds for late delivery",
    "reference",
    "A parcel more than two working days late against the quoted date is refunded the delivery charge on request. Weather and customs holds are excluded.",
  ],
  [
    "Dormant accounts",
    "reference",
    "Console accounts unused for ninety days are disabled, not deleted, so the audit history survives. Re-enabling one needs the account owner's manager.",
  ],
  [
    "Single sign-on",
    "reference",
    "Staff sign in through single sign-on with a hardware key. Shippers can bring their own identity provider on the enterprise plan.",
  ],
  [
    "Penetration test findings",
    "reference",
    "Penetration tests run twice a year against staging. Findings are triaged within five working days, and criticals are fixed before the report is final.",
  ],
  [
    "Analytics warehouse refresh",
    "reference",
    "The analytics warehouse refreshes hourly from the events export. Dashboards show the refresh time, and numbers older than three hours raise a banner.",
  ],
  [
    "Carrier desk hours",
    "reference",
    "The carrier desk is staffed from 07:00 to 19:00 CET on weekdays. Outside those hours the on-call engineer has the carriers' emergency numbers.",
  ],
  [
    "Vessel cut-offs",
    "reference",
    "A vessel cut-off is the last moment a container can be gated in. Missing it means the next sailing, typically a week later on the Asia lanes.",
  ],
  [
    "Parcel locker sizes",
    "reference",
    "Locker compartments come in three sizes; the largest takes 60 by 40 by 40 cm. Anything bigger is rerouted to a staffed point at booking time.",
  ],
  [
    "Duties calculator",
    "reference",
    "The duties calculator uses the HS code, the declared value and the destination. It is refreshed when tariff schedules change, usually in January and July.",
  ],
  [
    "EORI basics",
    "reference",
    "An EORI number identifies a business to EU customs. Private senders do not need one. It is stored on the customs profile, never on the shipment.",
  ],
  [
    "Document templates",
    "reference",
    "Documents are rendered from templates, one per shipment. Templates are versioned with the rate cards, and a change needs a sample pack reviewed by the Antwerp depot.",
  ],
  [
    "Idempotency keys",
    "reference",
    "Every state-changing carrier call carries an idempotency key derived from the shipment id and the operation. Carriers that ignore the header are wrapped with our own dedupe table.",
  ],
  [
    "Tenant isolation tests",
    "reference",
    "A pair of test tenants runs against every release and asserts that no API response, page or export crosses tenants. A failure blocks the release.",
  ],
  [
    "Emission factors",
    "reference",
    "Emission factors are updated yearly from the published tables. A change in factors restates nothing: past shipments keep the figure they were given.",
  ],
  [
    "Driver training",
    "project",
    "New drivers ride along for three days and are assessed on scanning discipline and doorstep conduct. Retraining after a complaint is one paid shift.",
  ],
  [
    "Polar-night operations",
    "reference",
    "From late November to late January the northern Norway routes run on reduced-daylight rules: shorter shifts, studded tyres and no deliveries to unlit farm roads.",
  ],
  [
    "Ferry-dependent postcodes",
    "reference",
    "Some postcodes are reachable only by ferry. Transit estimates there add the timetable gap, and a cancelled sailing is classed as weather.",
  ],
  [
    "Dangerous-goods questionnaire",
    "reference",
    "The dangerous-goods questionnaire has fourteen questions and is renewed yearly. A lapsed questionnaire blocks bookings for the affected product categories only.",
  ],
  [
    "Scanner batteries",
    "reference",
    "Handheld scanners last a shift on the standard battery at room temperature and about half that in the cold store.",
  ],
];

export const CORPUS_2 = DOCS.map(([id, type, day, importance, title, body]) => ({
  id,
  type,
  day,
  importance,
  title,
  body,
}));

for (let i = 0; i < DISTRACTOR_SEEDS_2.length; i++) {
  const [title, type, body] = DISTRACTOR_SEEDS_2[i];
  CORPUS_2.push({
    id: `distractor2-${i + 1}`,
    type,
    day: 10 + ((i * 29) % 300),
    importance: 0.3 + (i % 5) * 0.1,
    title,
    body,
    distractor: true,
  });
}
