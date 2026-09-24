/**
 * The daily-log entry heading format, shared by the writers (journal,
 * ingestion, fusion) and the readers that parse it back (entities,
 * memory_compact, memory_reflect).
 */

/**
 * Daily logs are UTC days: every writer picks the file with
 * toISOString().slice(0, 10). Entry time labels are UTC for the same reason.
 * Until 2026-09 they were server-local ("09:05 PM"), which put an evening
 * entry west of UTC, labelled in the evening, inside the NEXT day's log.
 */
export function utcTimeLabel(d: Date = new Date()): string {
  return `${d.toISOString().slice(11, 16)} UTC`;
}

/**
 * Regex source matching an entry heading's time label, current and legacy:
 * "14:05 UTC", and the server-local "02:05 PM" that older logs hold. A strict
 * superset of the `[\d:APM ]+` the parsers used before, so every heading
 * that parsed then still parses.
 */
export const TIME_LABEL_SRC = String.raw`[\d:APM ]+(?:UTC)?`;
