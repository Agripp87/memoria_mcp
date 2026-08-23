/**
 * Core Ingestion Pipeline — processes events from the sub-memory collector
 * and integrates them into the Memoria memory store.
 *
 * Pipeline stages:
 *   1. Re-score importance with richer context (cross-reference existing memories)
 *   2. Rate-limit per source (prevent any single source from overwhelming memory)
 *   3. Deduplicate against existing memories (content hash + similarity)
 *   4. Consolidate with related memories (update vs create decision)
 *   5. Write to memory files + update index
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { contentHash } from "./crypto.js";
import { getProvider } from "../embeddings.js";
import { classifyPrivacy, mostRestrictiveTier } from "./adapters/base.js";
import { appendRawArchive, flushRawArchive, rawArchiveEnabled } from "./provenance.js";
import type { RawEvent } from "./adapters/base.js";

/** Max chars retained for a `summarize`-tier event before truncation. */
const SUMMARIZE_MAX_CHARS = 200;
const LOCAL_ONLY_REDACTION =
  "[redacted — local-only: content classified as sensitive and withheld from the synced/embedded store]";

// ── Types ──────────────────────────────────────────────────

/** Per-event ingestion outcome. Callers that stage events (the daemon, the
 * memory_ingest tool) use this to mark ONLY durably-handled events as synced:
 *  - "written" / "duplicate" / "below_threshold" → durably handled (sync)
 *  - "rate_limited" → DEFERRED: leave unsynced, retry next cycle
 *  - "error"        → DEFERRED: leave unsynced, count an attempt (dead-letter
 *                     after the retry cap)
 */
export interface EventOutcome {
  id: string;
  source: string;
  outcome: "written" | "duplicate" | "below_threshold" | "rate_limited" | "error";
  error?: string;
}

export interface IngestionResult {
  processed: number;
  written: number;
  deduplicated: number;
  rateLimited: number;
  errors: string[];
  /** Distinct source names that had at least one event written this batch.
   * Used to propagate a new fact to the entity pages it touches (rule V). */
  writtenSources: string[];
  /** Per-event outcomes, in input order. */
  outcomes: EventOutcome[];
}

export interface IngestionConfig {
  /** Max events per source per ingestion cycle (default: 20) */
  perSourceLimit?: number;
  /** Min importance to write to core memory (default: 4) */
  coreThreshold?: number;
  /** Directory for memory files */
  memoriesDir: string;
  /** Function to search existing memories (injected from MCP server) */
  searchMemories?: (query: string, limit: number) => Promise<SearchResult[]>;
}

export interface SearchResult {
  file: string;
  content: string;
  score: number;
}

interface RateLimitState {
  counts: Map<string, number>;
  windowStart: number;
}

// ── Constants ──────────────────────────────────────────────

const RATE_WINDOW_MS = 60_000; // 1 minute window
const DEDUP_SIMILARITY_THRESHOLD = 0.85;
// Per-source content-hash dedup window. Must exceed the polling interval of
// the noisiest scheduled job. Hourly health-checks emit identical content
// every 60 min, so a 10-min window (the old value) never caught them — it
// has to span a full day. The map is persisted to disk so the window also
// survives process restarts (otherwise every redeploy re-admits the spam).
const RECENT_DEDUP_WINDOW_MS = 26 * 60 * 60_000; // 26 hours
const DEDUP_SIDECAR = ".ingest-dedup.json"; // stored under the data dir
const DEDUP_MAX_ENTRIES = 20_000;

// ── Ingestion Pipeline ─────────────────────────────────────

export class IngestionPipeline {
  private config: Required<Omit<IngestionConfig, "searchMemories">> & {
    searchMemories?: IngestionConfig["searchMemories"];
  };
  private rateState: RateLimitState;
  // Map of "source:content_hash" -> timestamp_ms when we last accepted it.
  // Prevents identical scheduled-job results from being written every poll.
  // Persisted to disk so the dedup window survives restarts/redeploys.
  private recentBySource = new Map<string, number>();
  private dedupPath: string;
  private dedupDirty = false;
  private dataDir: string;

  constructor(config: IngestionConfig) {
    this.config = {
      perSourceLimit: config.perSourceLimit ?? 20,
      coreThreshold: config.coreThreshold ?? 4,
      memoriesDir: config.memoriesDir,
      searchMemories: config.searchMemories,
    };

    this.rateState = {
      counts: new Map(),
      windowStart: Date.now(),
    };

    // Sidecar lives in the sibling data/ dir, not memories/ (so it is never
    // indexed as a memory). memoriesDir is ".../Memoria/memories".
    this.dataDir = path.join(config.memoriesDir, "..", "data");
    this.dedupPath = path.join(this.dataDir, DEDUP_SIDECAR);
    this.loadDedupState();
  }

  /**
   * Process a batch of events through the full pipeline.
   */
  async ingest(events: RawEvent[]): Promise<IngestionResult> {
    const result: IngestionResult = {
      processed: events.length,
      written: 0,
      deduplicated: 0,
      rateLimited: 0,
      errors: [],
      writtenSources: [],
      outcomes: [],
    };
    const writtenSourceSet = new Set<string>();

    // Reset rate limit window if expired
    if (Date.now() - this.rateState.windowStart > RATE_WINDOW_MS) {
      this.rateState.counts.clear();
      this.rateState.windowStart = Date.now();
    }

    for (const event of events) {
      try {
        // Stage 1: Importance re-scoring
        const adjustedImportance = this.rescoreImportance(event);
        if (adjustedImportance < this.config.coreThreshold) {
          result.outcomes.push({ id: event.id, source: event.source, outcome: "below_threshold" });
          continue;
        }

        // Stage 2: Rate limiting. Over-budget events are DEFERRED, not dropped:
        // the caller leaves them unsynced and they retry next cycle, when the
        // 60s window may have refilled. Deferred events consume NO budget and
        // mutate NO dedup state — they have not been processed.
        if (this.isRateLimited(event.source)) {
          result.rateLimited++;
          result.outcomes.push({ id: event.id, source: event.source, outcome: "rate_limited" });
          continue;
        }

        // Stage 3: Per-source content-hash dedup (persistent window).
        // Catches scheduled-job spam where the same automated task emits
        // identical content on every poll. The window (26h) spans the
        // hourly cadence of the noisiest jobs, and the map is persisted so
        // it survives restarts.
        // NOTE: the hash is COMPUTED here but only RECORDED after a successful
        // write (or a deliberate skip) — recording before the write meant a
        // failed write left the event marked "seen", so its retry would be
        // deduped away (silent loss).
        const hash = contentHash(event.content);
        const sourceKey = `${event.source}:${hash}`;
        const lastSeen = this.recentBySource.get(sourceKey);
        const now = Date.now();
        if (lastSeen && now - lastSeen < RECENT_DEDUP_WINDOW_MS) {
          // A true duplicate still consumes rate budget (it was processed) so a
          // source emitting mostly-duplicates can't bypass the cap.
          this.incrementRateCount(event.source);
          result.deduplicated++;
          result.outcomes.push({ id: event.id, source: event.source, outcome: "duplicate" });
          continue;
        }

        // Periodic cleanup of the recent map to bound memory/disk
        if (this.recentBySource.size > DEDUP_MAX_ENTRIES) {
          for (const [k, t] of this.recentBySource) {
            if (now - t > RECENT_DEDUP_WINDOW_MS) this.recentBySource.delete(k);
          }
        }

        // Stage 4: Consolidation check.
        // NOTE: the collector only ever writes to daily logs. It must never
        // append into a curated core memory — with bag-of-words embeddings,
        // unrelated automated events score high enough to "match" a core doc
        // and would graffiti it. decideAction therefore returns only
        // "create" (→ today's daily log) or "skip" (already captured).
        const action = await this.decideAction(event);

        // Stage 5: Write
        if (action.type === "skip") {
          this.incrementRateCount(event.source);
          this.recentBySource.set(sourceKey, now);
          this.dedupDirty = true;
          result.deduplicated++;
          result.outcomes.push({ id: event.id, source: event.source, outcome: "duplicate" });
        } else {
          // Sink-side privacy enforcement (defense in depth). Adapters set a
          // privacyTier, but we never trust it as the sole gate: re-classify
          // the content here and take the MORE restrictive tier, then redact
          // accordingly before the content is persisted to a git-synced,
          // OpenAI-embedded daily log. This closes adapters that mislabel
          // events (e.g. calendar titles) and external /ingest callers that
          // supply their own tier.
          const safeEvent = this.enforcePrivacy(event);
          this.writeNewMemory(safeEvent, adjustedImportance);
          // Only now — after the write succeeded — consume budget and record
          // the event as seen.
          this.incrementRateCount(event.source);
          this.recentBySource.set(sourceKey, now);
          this.dedupDirty = true;
          // Durable, immutable provenance (rule I). The hash is of the ORIGINAL
          // content; what's stored respects the effective privacy tier.
          if (rawArchiveEnabled()) {
            appendRawArchive(this.dataDir, safeEvent, event.content);
          }
          result.written++;
          writtenSourceSet.add(event.source);
          result.outcomes.push({ id: event.id, source: event.source, outcome: "written" });
        }
      } catch (err: any) {
        result.errors.push(`${event.source}/${event.id}: ${err.message}`);
        result.outcomes.push({ id: event.id, source: event.source, outcome: "error", error: err.message });
      }
    }

    this.saveDedupState();
    // Flush the provenance batch once per ingest cycle: one append per
    // source/month per cycle instead of per event (F4 — FUSE append is a
    // full-object rewrite, so amortization matters).
    if (rawArchiveEnabled()) flushRawArchive();
    result.writtenSources = [...writtenSourceSet];
    return result;
  }

  // ── Persistent dedup state ─────────────────────────────────

  private loadDedupState(): void {
    try {
      if (!fs.existsSync(this.dedupPath)) return;
      const raw = JSON.parse(fs.readFileSync(this.dedupPath, "utf-8")) as Record<string, number>;
      const now = Date.now();
      for (const [k, t] of Object.entries(raw)) {
        // Drop entries already outside the window on load
        if (typeof t === "number" && now - t < RECENT_DEDUP_WINDOW_MS) {
          this.recentBySource.set(k, t);
        }
      }
    } catch {
      // Corrupt sidecar — start fresh, never block ingestion
    }
  }

  private saveDedupState(): void {
    if (!this.dedupDirty) return;
    // Prune entries older than the dedup window on every save so the map and
    // its on-disk sidecar stay bounded by recency, not only by the 20k cap.
    const cutoff = Date.now() - RECENT_DEDUP_WINDOW_MS;
    for (const [k, t] of this.recentBySource) {
      if (t < cutoff) this.recentBySource.delete(k);
    }
    try {
      fs.mkdirSync(path.dirname(this.dedupPath), { recursive: true });
      const obj: Record<string, number> = {};
      for (const [k, t] of this.recentBySource) obj[k] = t;
      fs.writeFileSync(this.dedupPath, JSON.stringify(obj), { encoding: "utf-8" });
      this.dedupDirty = false;
    } catch {
      // best-effort — never block ingestion on dedup persistence
    }
  }

  // ── Stage 1: Re-scoring ────────────────────────────────────

  private rescoreImportance(event: RawEvent): number {
    let score = event.importanceEstimate;

    // Boost personal messages (not automated)
    if (event.meta?.isAutomated) {
      score = Math.max(1, score - 3);
    }

    // Boost messages from known contacts
    if (event.meta?.isFromMe) {
      score = Math.min(10, score + 1); // user's own messages are slightly more important
    }

    // Boost events with rich content
    if (event.content.length > 200) {
      score = Math.min(10, score + 1);
    }

    // Reduce score for very short content
    if (event.content.length < 20) {
      score = Math.max(1, score - 1);
    }

    // Calendar events maintain at least moderate importance — but only when
    // the adapter didn't DELIBERATELY score them low (declined/cancelled/
    // automated entries arrive with estimate <= 2; flooring those to exactly
    // the core threshold resurrected events the adapter meant to suppress).
    if (event.source === "calendar" && event.importanceEstimate >= 3) {
      score = Math.max(4, score);
    }

    return score;
  }

  // ── Stage 2: Rate Limiting ─────────────────────────────────

  private isRateLimited(source: string): boolean {
    const count = this.rateState.counts.get(source) ?? 0;
    return count >= this.config.perSourceLimit;
  }

  private incrementRateCount(source: string): void {
    const count = this.rateState.counts.get(source) ?? 0;
    this.rateState.counts.set(source, count + 1);
  }

  // ── Stage 4: Consolidation Decision ────────────────────────

  private async decideAction(
    event: RawEvent
  ): Promise<{ type: "create" | "skip" }> {
    // If no search function, always create (write to today's daily log).
    if (!this.config.searchMemories) {
      return { type: "create" };
    }

    try {
      // Search for similar existing memories
      const similar = await this.config.searchMemories(
        event.content.slice(0, 200),
        3
      );

      if (similar.length === 0) {
        return { type: "create" };
      }

      // Only skip if a near-identical entry already exists. We never
      // "update" a core file from the collector — see Stage 5 note.
      // The threshold is provider-aware: the local n-gram fallback inflates
      // similarity, so a low cut would wrongly skip genuinely-new events
      // (silent data loss). Require near-certainty there; trust OpenAI more.
      const skipThreshold = getProvider() === "openai" ? DEDUP_SIMILARITY_THRESHOLD : 0.95;
      // searchMemories returns relevance in `score`, but results are ordered by
      // the combined three-signal score — so the most-relevant match may not be
      // similar[0]. Gate on the max relevance across the returned set.
      const maxRelevance = Math.max(...similar.map((s) => s.score));
      if (maxRelevance >= skipThreshold) {
        return { type: "skip" };
      }

      return { type: "create" };
    } catch {
      // Search failed — default to create
      return { type: "create" };
    }
  }

  // ── Sink-side privacy enforcement ──────────────────────────

  /**
   * Apply the effective privacy tier to an event before it is written to a
   * (synced, embedded) daily log. Returns a copy with content redacted or
   * truncated as required. The effective tier is the most restrictive of the
   * adapter-supplied tier and a fresh content re-classification, so a
   * mislabeled or caller-supplied "send" cannot leak sensitive content.
   */
  private enforcePrivacy(event: RawEvent): RawEvent {
    const reclassified = classifyPrivacy(event.content, event.meta);
    const tier = mostRestrictiveTier(event.privacyTier ?? "send", reclassified);

    // Meta is a leak vector of its own (locations, senders, attendee emails —
    // and daily-log formatting writes meta.from/location verbatim). Classify
    // the stringified meta VALUES separately; if anything in meta trips the
    // classifier, drop meta entirely rather than persist it. Content keeps its
    // own tier — a sensitive meta field shouldn't redact an innocuous body.
    let meta = event.meta ?? {};
    if (Object.keys(meta).length > 0) {
      const metaText = Object.values(meta)
        .filter((v) => typeof v === "string" || typeof v === "number")
        .join(" ");
      if (metaText && classifyPrivacy(String(metaText), {}) !== "send") {
        meta = {};
      }
    }

    if (tier === "local-only") {
      // Never persist the content (or potentially-revealing meta) to the
      // synced/embedded store. Keep a redacted stub so the timeline is intact.
      return { ...event, privacyTier: tier, content: LOCAL_ONLY_REDACTION, meta: {} };
    }

    if (tier === "summarize" && event.content.length > SUMMARIZE_MAX_CHARS) {
      const truncated =
        event.content.slice(0, SUMMARIZE_MAX_CHARS).trimEnd() +
        " … [truncated for privacy]";
      return { ...event, privacyTier: tier, content: truncated, meta };
    }

    return { ...event, privacyTier: tier, meta };
  }

  // ── Stage 5: Writing ───────────────────────────────────────

  private writeNewMemory(event: RawEvent, importance: number): void {
    const today = new Date().toISOString().slice(0, 10);
    const dailyDir = path.join(this.config.memoriesDir, "daily");
    fs.mkdirSync(dailyDir, { recursive: true });

    const dailyFile = path.join(dailyDir, `${today}.md`);

    // Format the event as a daily log entry
    const entry = this.formatDailyEntry(event, importance);

    if (fs.existsSync(dailyFile)) {
      fs.appendFileSync(dailyFile, `\n${entry}`);
      // Only let genuinely high-signal events (>=7: decisions, failures,
      // user-flagged) raise the file's importance. Routine rich-content
      // events (which get a +1 to importance ~6 in rescoring) must NOT
      // creep every daily log up to 6-7, which would just re-flatten the
      // distribution at a higher value and defeat the point.
      if (importance >= 7) this.maybeBumpFileImportance(dailyFile, importance);
    } else {
      // New daily log: base importance 5, unless the first event is itself
      // high-signal (>=7), in which case start there.
      const initialImportance = importance >= 7 ? importance : 5;
      const header = [
        "---",
        `name: Daily log ${today}`,
        `description: Auto-collected events for ${today}`,
        "type: session",
        `importance: ${initialImportance}`,
        `created: ${today}`,
        `updated: ${today}`,
        `last_accessed: ${today}`,
        "access_count: 0",
        "tags: [daily, auto-collected]",
        "origin: collector",
        "---",
        "",
        `# Daily Log — ${today}`,
        "",
      ].join("\n");

      fs.writeFileSync(dailyFile, header + entry, { encoding: "utf-8" });
    }
  }

  /**
   * Bump the file-level `importance` value to max(current, eventImportance)
   * so high-signal events surface in search even when buried in a daily log.
   */
  private maybeBumpFileImportance(filePath: string, eventImportance: number): void {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const m = content.match(/^(---\n[\s\S]*?\nimportance:\s*)(\d+)([\s\S]*?\n---)/);
      if (!m) return;
      const current = parseInt(m[2], 10);
      if (!Number.isFinite(current) || eventImportance <= current) return;
      const updated = content.replace(m[0], `${m[1]}${eventImportance}${m[3]}`);
      fs.writeFileSync(filePath, updated, { encoding: "utf-8" });
    } catch {
      // best-effort — never block ingestion on importance bumping
    }
  }

  // ── Formatting ─────────────────────────────────────────────

  private formatDailyEntry(event: RawEvent, importance: number): string {
    const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const sourceLabel = this.getSourceLabel(event.source);
    const privacyNote =
      event.privacyTier === "summarize" ? " *(summarized)*" : "";

    const lines = [
      `## ${time} — ${sourceLabel}${privacyNote}`,
      "",
      event.content,
      "",
    ];

    // Add relevant metadata
    const metaLines: string[] = [];
    if (event.meta?.from) metaLines.push(`From: ${event.meta.from}`);
    if (event.meta?.chatName && event.meta.chatName !== "direct")
      metaLines.push(`Chat: ${event.meta.chatName}`);
    if (event.meta?.calendarName)
      metaLines.push(`Calendar: ${event.meta.calendarName}`);
    if (event.meta?.location) metaLines.push(`Location: ${event.meta.location}`);

    if (metaLines.length > 0) {
      lines.push(`> ${metaLines.join(" | ")}`);
      lines.push("");
    }

    // Provenance pointer (rule I): source:id ties this entry back to the
    // immutable raw archive record under data/raw/<source>/.
    const ref = event.id ? ` | ref: ${event.source}:${event.id}` : "";
    lines.push(`*importance: ${importance} | privacy: ${event.privacyTier}${ref}*`);
    lines.push("");

    return lines.join("\n");
  }

  private getSourceLabel(source: string): string {
    const labels: Record<string, string> = {
      imessage: "iMessage",
      calendar: "Calendar",
      email: "Email",
    };
    return labels[source] ?? source;
  }
}
