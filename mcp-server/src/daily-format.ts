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
  return `${t.toISOString().slice(11, 16)} UTC`;
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
