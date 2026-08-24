/**
 * Google Gmail adapter — reads email via the Gmail API.
 *
 * Advantages over generic IMAP:
 *   - Uses Google OAuth 2.0 (no app-specific passwords)
 *   - Access to Gmail labels, categories, importance markers
 *   - Shared auth with Calendar and Drive adapters
 *   - Better structured data (envelope, headers, snippets)
 *
 * Requires: googleapis npm package (auto-installed)
 */

import type { SourceAdapter, AdapterInfo, AdapterConfig, RawEvent } from "./base.js";
import { estimateImportance, classifyPrivacy } from "./base.js";
import { getGoogleAuth, extractGoogleAuthConfig } from "./google-auth.js";

export class GoogleGmailAdapter implements SourceAdapter {
  readonly info: AdapterInfo = {
    id: "google-gmail",
    name: "Gmail (Google)",
    description:
      "Collects email from Gmail using the Google API. Reads subjects, snippets, and labels. Supports label filtering.",
    platforms: ["macos", "linux", "windows"],
    dependencies: ["googleapis"],
    requiredPermissions: [
      "Google OAuth 2.0 credentials (client_id, client_secret, refresh_token)",
      "Gmail API enabled in Google Cloud Console",
    ],
    builtIn: true,
    defaultConfig: {
      enabled: false,
      pollIntervalSec: 300, // 5 minutes
      importanceThreshold: 3,
      settings: {
        google_client_id: "",
        google_client_secret: "",
        google_refresh_token: "",
        labels: ["INBOX"], // Gmail labels to poll
        excludeLabels: ["SPAM", "TRASH", "PROMOTIONS"],
        maxResults: 50,
        includeSpamTrash: false,
      },
    },
  };

  private gmail: any = null;
  private checkpoint: string = ""; // historyId for incremental sync
  private config!: AdapterConfig;

  async init(config: AdapterConfig): Promise<void> {
    this.config = config;
    const authConfig = extractGoogleAuthConfig(config.settings as Record<string, any>);
    const auth = await getGoogleAuth(authConfig);

    const { google } = await import("googleapis");
    this.gmail = google.gmail({ version: "v1", auth });

    // Get initial historyId if no checkpoint
    if (!this.checkpoint) {
      try {
        const profile = await this.gmail.users.getProfile({ userId: "me" });
        this.checkpoint = String(profile.data.historyId || "");
      } catch (err: any) {
        throw new Error(
          `Gmail API connection failed: ${err.message}. ` +
            "Ensure the Gmail API is enabled in your Google Cloud Console.",
          { cause: err },
        );
      }
    }
  }

  async poll(): Promise<RawEvent[]> {
    if (!this.gmail) return [];

    const labels = (this.config.settings?.labels as string[]) ?? ["INBOX"];
    const excludeLabels = (this.config.settings?.excludeLabels as string[]) ?? [
      "SPAM",
      "TRASH",
      "PROMOTIONS",
    ];
    const maxResults = (this.config.settings?.maxResults as number) ?? 50;
    const events: RawEvent[] = [];

    try {
      // Use history-based incremental sync if we have a checkpoint
      if (this.checkpoint) {
        const historyEvents = await this.pollHistory(
          this.checkpoint,
          labels,
          excludeLabels,
          maxResults,
        );
        events.push(...historyEvents);
      } else {
        // Fallback: list recent messages
        const listEvents = await this.pollList(labels, excludeLabels, maxResults);
        events.push(...listEvents);
      }
    } catch (err: any) {
      // historyId expired — fall back to list
      if (err.code === 404 || err.message?.includes("historyId")) {
        process.stderr.write("Memoria: Gmail historyId expired, falling back to list\n");
        const listEvents = await this.pollList(labels, excludeLabels, maxResults);
        events.push(...listEvents);
      } else {
        process.stderr.write(`Memoria: Gmail poll error: ${err.message}\n`);
      }
    }

    return events;
  }

  // ── History-based incremental sync ─────────────────────────

  private async pollHistory(
    startHistoryId: string,
    labels: string[],
    excludeLabels: string[],
    maxResults: number,
  ): Promise<RawEvent[]> {
    const events: RawEvent[] = [];
    const messageIds: string[] = [];

    let pageToken: string | undefined;
    do {
      const response = await this.gmail.users.history.list({
        userId: "me",
        startHistoryId,
        labelId: labels.length === 1 ? labels[0] : undefined,
        historyTypes: ["messageAdded"],
        maxResults: Math.min(maxResults, 100),
        pageToken,
      });

      const history = response.data.history || [];
      for (const record of history) {
        for (const msg of record.messagesAdded || []) {
          if (msg.message?.id) {
            // Skip excluded labels
            const msgLabels = msg.message.labelIds || [];
            const hasExcluded = msgLabels.some((l: string) => excludeLabels.includes(l));
            if (!hasExcluded) {
              messageIds.push(msg.message.id);
            }
          }
        }
      }

      // Update checkpoint to latest historyId
      if (response.data.historyId) {
        this.checkpoint = String(response.data.historyId);
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken && messageIds.length < maxResults);

    // Fetch message details
    for (const msgId of messageIds.slice(0, maxResults)) {
      const event = await this.fetchMessage(msgId);
      if (event) events.push(event);
    }

    return events;
  }

  // ── List-based fallback ────────────────────────────────────

  private async pollList(
    labels: string[],
    excludeLabels: string[],
    maxResults: number,
  ): Promise<RawEvent[]> {
    const events: RawEvent[] = [];

    // Build query to exclude unwanted labels
    const excludeQuery = excludeLabels.map((l) => `-label:${l.toLowerCase()}`).join(" ");
    const labelQuery = labels.map((l) => `label:${l.toLowerCase()}`).join(" OR ");
    const query = `(${labelQuery}) ${excludeQuery} newer_than:1d`;

    const response = await this.gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults,
    });

    const messages = response.data.messages || [];

    for (const msg of messages) {
      const event = await this.fetchMessage(msg.id);
      if (event) events.push(event);
    }

    // Update historyId from profile
    try {
      const profile = await this.gmail.users.getProfile({ userId: "me" });
      if (profile.data.historyId) {
        this.checkpoint = String(profile.data.historyId);
      }
    } catch (err) {
      process.stderr.write(
        `Memoria gmail: failed to update historyId: ${(err as Error).message}\n`,
      );
    }

    return events;
  }

  // ── Fetch individual message ───────────────────────────────

  private async fetchMessage(messageId: string): Promise<RawEvent | null> {
    try {
      const msg = await this.gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      });

      const headers = msg.data.payload?.headers || [];
      const getHeader = (name: string): string =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

      const from = getHeader("From");
      const to = getHeader("To");
      const subject = getHeader("Subject") || "(no subject)";
      const date = getHeader("Date");
      const snippet = msg.data.snippet || "";
      const labelIds = msg.data.labelIds || [];

      const timestamp = date
        ? new Date(date).toISOString()
        : new Date(parseInt(msg.data.internalDate || "0")).toISOString();

      // Extract sender name/address
      const fromMatch = from.match(/^(?:"?(.+?)"?\s)?<?([^>]+)>?$/);
      const fromName = fromMatch?.[1] || fromMatch?.[2] || from;
      const fromAddress = fromMatch?.[2] || from;

      const content = snippet ? `${subject} — ${snippet.slice(0, 300)}` : subject;

      const meta: Record<string, unknown> = {
        from: fromName,
        fromAddress,
        to,
        subject,
        labels: labelIds,
        isAutomated: /no-?reply|automated|noreply|mailer-daemon/i.test(fromAddress),
        isImportant: labelIds.includes("IMPORTANT"),
        isStarred: labelIds.includes("STARRED"),
        category: labelIds.find((l: string) => l.startsWith("CATEGORY_")) ?? null,
      };

      const importance = estimateImportance(content, meta);
      if (importance < this.config.importanceThreshold) return null;

      // Boost for Gmail importance markers
      let adjustedImportance = importance;
      if (meta.isImportant) adjustedImportance = Math.min(10, adjustedImportance + 1);
      if (meta.isStarred) adjustedImportance = Math.min(10, adjustedImportance + 2);

      const privacy = classifyPrivacy(content, meta);
      if (privacy === "local-only") return null;

      return {
        id: `gmail-${messageId}`,
        source: "google-gmail",
        eventType: "email_received",
        content: privacy === "summarize" ? `${subject} (from ${fromName})` : content,
        timestamp,
        meta,
        importanceEstimate: adjustedImportance,
        privacyTier: privacy,
      };
    } catch (err: any) {
      process.stderr.write(`Memoria: Gmail fetch error for ${messageId}: ${err.message}\n`);
      return null;
    }
  }

  getCheckpoint(): string {
    return this.checkpoint;
  }

  setCheckpoint(cursor: string): void {
    this.checkpoint = cursor;
  }

  async destroy(): Promise<void> {
    this.gmail = null;
    // Don't clear shared auth — other Google adapters may be using it
  }
}
