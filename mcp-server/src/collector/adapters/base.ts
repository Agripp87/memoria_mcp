/**
 * Base adapter interface for all data source collectors.
 *
 * Every adapter implements this interface. New sources can be added by:
 *   1. Creating a file in adapters/ that exports a class implementing SourceAdapter
 *   2. Registering it in the source registry
 *   3. Or: user creates a custom adapter via the config UI
 */

export interface RawEvent {
  /** Unique ID within the source (for dedup) */
  id: string;
  /** Source identifier */
  source: string;
  /** Event type within the source */
  eventType: string;
  /** Main content (message text, email subject, event title, etc.) */
  content: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Structured metadata (sender, recipients, location, etc.) */
  meta: Record<string, unknown>;
  /** Edge-estimated importance (1-10) */
  importanceEstimate: number;
  /** Privacy tier: what level of processing is allowed */
  privacyTier: "send" | "summarize" | "local-only";
}

export interface AdapterConfig {
  /** Whether this adapter is enabled */
  enabled: boolean;
  /** Polling interval in seconds */
  pollIntervalSec: number;
  /** Minimum importance threshold — events below this are discarded */
  importanceThreshold: number;
  /** Source-specific settings */
  settings: Record<string, unknown>;
}

export interface AdapterInfo {
  /** Unique adapter ID (e.g., "imessage", "calendar", "email") */
  id: string;
  /** Display name */
  name: string;
  /** Description of what this adapter collects */
  description: string;
  /** Platform availability */
  platforms: ("macos" | "ios" | "linux" | "windows")[];
  /** npm packages required (auto-installed on enable) */
  dependencies: string[];
  /** System permissions needed */
  requiredPermissions: string[];
  /** Whether the adapter is built-in or user-added */
  builtIn: boolean;
  /** Default config */
  defaultConfig: AdapterConfig;
}

export interface SourceAdapter {
  /** Static info about this adapter */
  readonly info: AdapterInfo;

  /**
   * Initialize the adapter (open DB connections, etc.)
   * Called once when the adapter is enabled.
   */
  init(config: AdapterConfig): Promise<void>;

  /**
   * Poll for new events since the last checkpoint.
   * Returns new events found.
   */
  poll(): Promise<RawEvent[]>;

  /**
   * Get the current checkpoint cursor (opaque, adapter-defined).
   * Used to resume polling after restart.
   */
  getCheckpoint(): string;

  /**
   * Restore from a saved checkpoint.
   */
  setCheckpoint(cursor: string): void;

  /**
   * Clean up resources (close DB connections, etc.)
   */
  destroy(): Promise<void>;
}

/**
 * Helper: estimate importance for a text-based event.
 * Rule-based heuristic for MVP — can be replaced with a model later.
 */
/**
 * macOS CoreData epoch offset (2001-01-01T00:00:00Z) in seconds.
 * Used by iMessage and Calendar adapters to convert macOS timestamps.
 */
export const CORE_DATA_EPOCH = 978307200;

/**
 * Helper: estimate importance for a text-based event.
 * Rule-based heuristic for MVP — can be replaced with a model later.
 */
export function estimateImportance(
  content: string,
  meta: Record<string, unknown> = {}
): number {
  let score = 3; // default: routine

  const lower = content.toLowerCase();

  // Boost for decisions / action items
  if (/\b(decided|decision|agreed|let's go with|action item|todo|deadline)\b/i.test(content))
    score += 2;

  // Boost for questions directed at user
  if (/\?/.test(content) && content.length > 20) score += 1;

  // Boost for names, dates, specific plans
  if (/\b(tomorrow|next week|monday|tuesday|wednesday|thursday|friday)\b/i.test(content))
    score += 1;
  if (/\b\d{1,2}[:/]\d{2}\b/.test(content)) score += 1; // times

  // Boost for emotional content
  if (/\b(love|miss|worried|excited|sorry|thank|congrat)\b/i.test(content))
    score += 1;

  // Suppress automated / marketing
  if (/\b(unsubscribe|no-?reply|automated|do not reply)\b/i.test(content))
    score -= 3;
  if (meta.isAutomated) score -= 2;

  // Boost for multiple participants (group decision)
  if (typeof meta.participantCount === "number" && meta.participantCount > 2)
    score += 1;

  return Math.max(1, Math.min(10, score));
}

/** Luhn checksum validation for a bare digit string (credit-card detection). */
function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Whether content contains a value that looks like a real credit-card number. */
function hasCreditCard(content: string): boolean {
  const candidates = content.match(/\b(?:\d[ -]?){13,19}\b/g);
  if (!candidates) return false;
  return candidates.some((c) => luhnValid(c.replace(/\D/g, "")));
}

/**
 * Value-shaped secrets that should never leave the device even when no trigger
 * keyword accompanies them — the common real-world leak is a bare token, key,
 * or card pasted into a message/email with no "password:" prefix.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/, // OpenAI-style secret key
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bASIA[0-9A-Z]{16}\b/, // AWS temporary access key id
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, // GitHub personal/OAuth/refresh tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack tokens
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/, // JWT
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, // PEM private key
];

/**
 * Helper: classify privacy tier based on content.
 *
 * Note: this is a best-effort edge filter. The ingestion pipeline ALSO
 * re-classifies and takes the most-restrictive tier at the sink, so an adapter
 * (or external /ingest caller) that mislabels an event cannot bypass redaction.
 */
export function classifyPrivacy(
  content: string,
  _meta: Record<string, unknown> = {}
): "send" | "summarize" | "local-only" {
  // Financial / sensitive keyword triggers — local only
  if (
    /\b(password|passcode|credit card|ssn|social security|bank account|routing number|cvv)\b/i.test(
      content
    )
  )
    return "local-only";
  if (/\b(pin code|secret key|private key|api[- ]?key|access token|refresh token)\b/i.test(content))
    return "local-only";

  // Value-shaped secrets — caught even without a trigger keyword.
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(content)) return "local-only"; // SSN
  if (SECRET_VALUE_PATTERNS.some((re) => re.test(content))) return "local-only";
  if (hasCreditCard(content)) return "local-only";

  // Long content — summarize before sending
  if (content.length > 500) return "summarize";

  return "send";
}

/** Privacy-tier ordering: higher = more restrictive. */
const TIER_RANK: Record<RawEvent["privacyTier"], number> = {
  send: 0,
  summarize: 1,
  "local-only": 2,
};

/** Return the more restrictive of two privacy tiers. */
export function mostRestrictiveTier(
  a: RawEvent["privacyTier"],
  b: RawEvent["privacyTier"]
): RawEvent["privacyTier"] {
  return (TIER_RANK[a] ?? 0) >= (TIER_RANK[b] ?? 0) ? a : b;
}
