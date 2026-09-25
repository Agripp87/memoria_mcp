/**
 * The daily-log entry heading format, shared by the writers (journal,
 * ingestion, fusion) and the readers that parse it back (entities,
 * memory_compact, memory_stats).
 */

/**
 * Daily logs are UTC days: every writer picks the file with
 * toISOString().slice(0, 10). Entry time labels are UTC for the same reason.
 * Until 2026-09 they were server-local ("09:05 PM"), which put an evening
 * entry west of UTC, labelled in the evening, inside the NEXT day's log.
 */
export function utcTimeLabel(d: Date = new Date()): string {
  // An invalid Date labels as the current time: toISOString() would throw,
  // failing the whole entry, and a placeholder like "??:??" would hide the
  // entry from every heading parser.
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  // From the UTC fields, not toISOString(): past year 9999 that becomes
  // "+056702-05-12T08:…", and a fixed slice of it read "12T08".
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

/**
 * An event timestamp as ISO 8601, or `now` when it cannot be used. Years
 * outside 1970–9999 are treated the same way as unparsable values because
 * epoch microseconds sent as milliseconds land around year 56,000.
 */
export function normalizeTimestamp(v: unknown, now: Date = new Date()): string {
  const d = new Date(typeof v === "string" || typeof v === "number" ? v : NaN);
  const year = d.getUTCFullYear();
  const plausible = !Number.isNaN(d.getTime()) && year >= 1970 && year <= 9999;
  return (plausible ? d : now).toISOString();
}

/**
 * Frontmatter and title for a daily log first created by the collector
 * (ingestion or fusion). High-signal first events start the file at their
 * own importance; everything else starts at 5.
 */
export function collectorDailyHeader(date: string, importance = 5): string {
  return [
    "---",
    `name: Daily log ${date}`,
    `description: Auto-collected events for ${date}`,
    "type: session",
    `importance: ${importance}`,
    `created: ${date}`,
    `updated: ${date}`,
    `last_accessed: ${date}`,
    "access_count: 0",
    "tags: [daily, auto-collected]",
    "origin: collector",
    "---",
    "",
    `# Daily Log — ${date}`,
    "",
  ].join("\n");
}

/**
 * Regex source matching an entry heading's time label, current and legacy:
 * "14:05 UTC", and the server-local "02:05 PM" that older logs hold. A strict
 * superset of the `[\d:APM ]+` the parsers used before, so every heading
 * that parsed then still parses.
 */
export const TIME_LABEL_SRC = String.raw`[\d:APM ]+(?:UTC)?`;
