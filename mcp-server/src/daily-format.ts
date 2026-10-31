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

/**
 * Event text made safe to embed in a daily log. The readers split a log at
 * line-leading "## " headings and read each entry's importance from its
 * "*importance: N*" trailer, so collected text (a calendar invite's
 * description, a message, a document) that holds either could forge an
 * entry for another source or override the real entry's importance. Both are
 * escaped at line start; Markdown renders the escaped text unchanged.
 */
export function neutralizeEntryContent(text: string): string {
  return text.replace(/^([ \t]*)(#|\*importance:)/gm, "$1\\$2");
}

/** A single-line heading label: no line breaks, no entry separator. */
export function neutralizeHeadingLabel(text: string): string {
  return text.replace(/\s+/g, " ").replace(/ — /g, " - ").trim();
}

/**
 * The importance an entry body records: its LAST line-anchored trailer. The
 * writer escapes any trailer-like line in the content, so the real trailer
 * is the only unescaped one and always the last.
 */
export function entryImportance(body: string, fallback = 5): number {
  const all = [...body.matchAll(/^\*importance:\s*(\d+)/gm)];
  return all.length ? parseInt(all[all.length - 1][1], 10) : fallback;
}

/** An entry body without its importance trailer line. */
export function stripImportanceTrailer(body: string): string {
  const all = [...body.matchAll(/^\*importance:.*$/gm)];
  if (!all.length) return body;
  const last = all[all.length - 1];
  return body.slice(0, last.index) + body.slice(last.index! + last[0].length);
}
