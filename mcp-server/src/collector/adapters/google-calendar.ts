/**
 * Google Calendar adapter — reads events via the Google Calendar API.
 *
 * Cross-platform alternative to the macOS-only CalendarAdapter.
 * Uses Google OAuth 2.0 (shared with Gmail and Drive adapters).
 *
 * Features:
 *   - Polls primary + selected calendars
 *   - Look-ahead/look-behind window
 *   - Attendee and meeting link detection
 *   - Recurring event support
 *   - syncToken-based incremental sync
 *
 * Requires: googleapis npm package (auto-installed)
 */

import type {
  SourceAdapter,
  AdapterInfo,
  AdapterConfig,
  RawEvent,
} from "./base.js";
import { estimateImportance, classifyPrivacy } from "./base.js";
import {
  getGoogleAuth,
  extractGoogleAuthConfig,
} from "./google-auth.js";

export class GoogleCalendarAdapter implements SourceAdapter {
  readonly info: AdapterInfo = {
    id: "google-calendar",
    name: "Google Calendar",
    description:
      "Collects calendar events from Google Calendar. Captures meetings, appointments, attendees, and video call links.",
    platforms: ["macos", "linux", "windows"],
    dependencies: ["googleapis"],
    requiredPermissions: [
      "Google OAuth 2.0 credentials (client_id, client_secret, refresh_token)",
      "Google Calendar API enabled in Google Cloud Console",
    ],
    builtIn: true,
    defaultConfig: {
      enabled: false,
      pollIntervalSec: 300, // 5 minutes
      importanceThreshold: 2,
      settings: {
        google_client_id: "",
        google_client_secret: "",
        google_refresh_token: "",
        calendarIds: ["primary"], // Calendar IDs to poll
        lookAheadDays: 7,
        lookBehindDays: 1,
        includeAllDayEvents: true,
        includeDeclined: false,
      },
    },
  };

  private calendar: any = null;
  private checkpoint: string = ""; // JSON: { syncTokens: { [calId]: syncToken } }
  private syncTokens: Record<string, string> = {};
  private config!: AdapterConfig;

  async init(config: AdapterConfig): Promise<void> {
    this.config = config;
    const authConfig = extractGoogleAuthConfig(
      config.settings as Record<string, any>
    );
    const auth = await getGoogleAuth(authConfig);

    const { google } = await import("googleapis");
    this.calendar = google.calendar({ version: "v3", auth });

    // Restore sync tokens from checkpoint
    if (this.checkpoint) {
      try {
        const parsed = JSON.parse(this.checkpoint);
        this.syncTokens = parsed.syncTokens || {};
      } catch (err) {
        process.stderr.write(`Memoria google-calendar: invalid checkpoint, starting fresh: ${(err as Error).message}\n`);
        // Clear corrupted checkpoint so the next poll starts fresh
        this.checkpoint = "";
        this.syncTokens = {};
      }
    }

    // Validate by listing calendars
    try {
      await this.calendar.calendarList.list({ maxResults: 1 });
    } catch (err: any) {
      throw new Error(
        `Google Calendar API connection failed: ${err.message}. ` +
          "Ensure the Google Calendar API is enabled in your Google Cloud Console."
      );
    }
  }

  async poll(): Promise<RawEvent[]> {
    if (!this.calendar) return [];

    const calendarIds = (this.config.settings?.calendarIds as string[]) ?? [
      "primary",
    ];
    const lookAhead = (this.config.settings?.lookAheadDays as number) ?? 7;
    const lookBehind = (this.config.settings?.lookBehindDays as number) ?? 1;
    const includeAllDay = this.config.settings?.includeAllDayEvents !== false;
    const includeDeclined = this.config.settings?.includeDeclined === true;

    const events: RawEvent[] = [];

    for (const calId of calendarIds) {
      try {
        const calEvents = await this.pollCalendar(
          calId,
          lookAhead,
          lookBehind,
          includeAllDay,
          includeDeclined
        );
        events.push(...calEvents);
      } catch (err: any) {
        // If sync token is invalid, reset and do a full sync
        if (err.code === 410 || err.message?.includes("Sync token")) {
          delete this.syncTokens[calId];
          try {
            const calEvents = await this.pollCalendar(
              calId,
              lookAhead,
              lookBehind,
              includeAllDay,
              includeDeclined
            );
            events.push(...calEvents);
          } catch (retryErr: any) {
            process.stderr.write(
              `Memoria: Google Calendar poll error (${calId}): ${retryErr.message}\n`
            );
          }
        } else {
          process.stderr.write(
            `Memoria: Google Calendar poll error (${calId}): ${err.message}\n`
          );
        }
      }
    }

    return events;
  }

  private async pollCalendar(
    calendarId: string,
    lookAhead: number,
    lookBehind: number,
    includeAllDay: boolean,
    includeDeclined: boolean
  ): Promise<RawEvent[]> {
    const events: RawEvent[] = [];
    const syncToken = this.syncTokens[calendarId];

    const params: any = {
      calendarId,
      maxResults: 200,
      singleEvents: true,
      orderBy: "startTime",
    };

    if (syncToken) {
      // Incremental sync
      params.syncToken = syncToken;
    } else {
      // Full sync with time window
      const now = new Date();
      params.timeMin = new Date(
        now.getTime() - lookBehind * 86400_000
      ).toISOString();
      params.timeMax = new Date(
        now.getTime() + lookAhead * 86400_000
      ).toISOString();
    }

    let pageToken: string | undefined;
    do {
      if (pageToken) params.pageToken = pageToken;

      const response = await this.calendar.events.list(params);
      const items = response.data.items || [];

      for (const item of items) {
        const event = this.convertEvent(
          item,
          calendarId,
          includeAllDay,
          includeDeclined
        );
        if (event) events.push(event);
      }

      // Save sync token for next incremental sync
      if (response.data.nextSyncToken) {
        this.syncTokens[calendarId] = response.data.nextSyncToken;
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return events;
  }

  private convertEvent(
    item: any,
    calendarId: string,
    includeAllDay: boolean,
    includeDeclined: boolean
  ): RawEvent | null {
    if (!item.summary) return null;
    if (item.status === "cancelled") return null;

    // Check if all-day event
    const isAllDay = !!item.start?.date;
    if (!includeAllDay && isAllDay) return null;

    // Check if declined
    if (!includeDeclined && item.attendees) {
      const self = item.attendees.find((a: any) => a.self);
      if (self?.responseStatus === "declined") return null;
    }

    // Parse times
    const startTime = item.start?.dateTime || item.start?.date;
    const endTime = item.end?.dateTime || item.end?.date;
    const timestamp = startTime
      ? new Date(startTime).toISOString()
      : new Date().toISOString();

    // Attendee info
    const attendees = (item.attendees || [])
      .filter((a: any) => !a.self)
      .map((a: any) => a.displayName || a.email)
      .slice(0, 10);

    // Detect video meeting link
    const meetingLink =
      item.hangoutLink ||
      item.conferenceData?.entryPoints?.find(
        (e: any) => e.entryPointType === "video"
      )?.uri ||
      null;

    // Build content
    const parts = [
      item.summary,
      item.location ? `at ${item.location}` : "",
      attendees.length > 0 ? `with ${attendees.join(", ")}` : "",
      item.description ? `— ${item.description.slice(0, 200)}` : "",
    ];
    const content = parts.filter(Boolean).join(" ");

    const meta: Record<string, unknown> = {
      calendarId,
      calendarName: calendarId === "primary" ? "Primary" : calendarId,
      location: item.location ?? null,
      isAllDay,
      endTime: endTime ? new Date(endTime).toISOString() : null,
      attendeeCount: (item.attendees || []).length,
      attendees: attendees.slice(0, 5),
      meetingLink,
      isRecurring: !!item.recurringEventId,
      organizer: item.organizer?.displayName || item.organizer?.email || null,
      status: item.status,
      htmlLink: item.htmlLink,
    };

    const importance = estimateImportance(content, {
      ...meta,
      participantCount: (item.attendees || []).length,
    });

    if (importance < this.config.importanceThreshold) return null;

    // Calendar events are at least moderate importance
    const adjustedImportance = Math.max(importance, 4);

    return {
      id: `gcal-${item.id}`,
      source: "google-calendar",
      eventType: isAllDay ? "all_day_event" : "event",
      content,
      timestamp,
      meta,
      importanceEstimate: adjustedImportance,
      // Event titles/notes routinely carry secrets (meeting passcodes, keys).
      // Classify rather than blanket-"send"; the ingestion sink also enforces.
      privacyTier: classifyPrivacy(content, meta),
    };
  }

  getCheckpoint(): string {
    return JSON.stringify({ syncTokens: this.syncTokens });
  }

  setCheckpoint(cursor: string): void {
    this.checkpoint = cursor;
    try {
      const parsed = JSON.parse(cursor);
      this.syncTokens = parsed.syncTokens || {};
    } catch (err) {
      // Corrupt checkpoint — reset to a full re-sync, but log it.
      process.stderr.write(
        `Memoria google-calendar: corrupt checkpoint, resetting sync tokens: ${(err as Error).message}\n`
      );
      this.syncTokens = {};
    }
  }

  async destroy(): Promise<void> {
    this.calendar = null;
  }
}
