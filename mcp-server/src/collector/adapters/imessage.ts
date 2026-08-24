/**
 * iMessage adapter — reads the macOS Messages database.
 * Requires: Full Disk Access in System Preferences.
 * Path: ~/Library/Messages/chat.db (SQLite)
 */

import * as path from "node:path";
import * as os from "node:os";
import type { SourceAdapter, AdapterInfo, AdapterConfig, RawEvent } from "./base.js";
import { estimateImportance, classifyPrivacy } from "./base.js";

export class IMessageAdapter implements SourceAdapter {
  readonly info: AdapterInfo = {
    id: "imessage",
    name: "iMessage",
    description:
      "Collects messages from Apple iMessage/SMS. Reads the local Messages database on macOS.",
    platforms: ["macos"],
    dependencies: [], // uses better-sqlite3 already in project
    requiredPermissions: ["Full Disk Access (System Preferences > Privacy & Security)"],
    builtIn: true,
    defaultConfig: {
      enabled: false,
      pollIntervalSec: 30,
      importanceThreshold: 3,
      settings: {
        contactFilter: [], // empty = all contacts; or list of names/numbers to include
        excludeGroupChats: false,
      },
    },
  };

  private db: any = null;
  private checkpoint: number = 0; // ROWID of last processed message
  private config!: AdapterConfig;

  async init(config: AdapterConfig): Promise<void> {
    this.config = config;

    const dbPath = path.join(os.homedir(), "Library/Messages/chat.db");

    try {
      // Dynamic import — better-sqlite3 is already a project dependency
      const Database = (await import("better-sqlite3")).default;
      this.db = new Database(dbPath, { readonly: true });
      this.db.pragma("journal_mode = WAL");

      // Get the latest ROWID as initial checkpoint (don't replay history)
      if (this.checkpoint === 0) {
        const row = this.db.prepare("SELECT MAX(ROWID) as maxid FROM message").get() as
          { maxid: number } | undefined;
        this.checkpoint = row?.maxid ?? 0;
      }
    } catch (err: any) {
      if (err.code === "SQLITE_CANTOPEN" || err.message?.includes("unable to open")) {
        throw new Error(
          "Cannot open iMessage database. Grant Full Disk Access to this app in " +
            "System Preferences > Privacy & Security > Full Disk Access.",
          { cause: err },
        );
      }
      throw err;
    }
  }

  async poll(): Promise<RawEvent[]> {
    if (!this.db) return [];

    const rows = this.db
      .prepare(
        `SELECT
          m.ROWID,
          m.text,
          m.date / 1000000000 + 978307200 as unix_ts,
          m.is_from_me,
          m.cache_has_attachments,
          h.id as handle_id,
          c.display_name as chat_name,
          c.chat_identifier
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.ROWID > ?
        ORDER BY m.ROWID ASC
        LIMIT 100`,
      )
      .all(this.checkpoint) as any[];

    const events: RawEvent[] = [];
    const contactFilter = (this.config.settings?.contactFilter as string[]) ?? [];
    const excludeGroups = this.config.settings?.excludeGroupChats === true;

    for (const row of rows) {
      this.checkpoint = row.ROWID;

      // Skip empty messages (reactions, tapbacks, etc.)
      if (!row.text || row.text.trim().length === 0) continue;

      // Apply contact filter
      if (contactFilter.length > 0) {
        const matchesFilter = contactFilter.some(
          (f: string) => row.handle_id?.includes(f) || row.chat_name?.includes(f),
        );
        if (!matchesFilter) continue;
      }

      // Apply group chat filter
      if (excludeGroups && row.chat_identifier?.startsWith("chat")) continue;

      const meta: Record<string, unknown> = {
        sender: row.is_from_me ? "me" : (row.handle_id ?? "unknown"),
        chatName: row.chat_name ?? row.chat_identifier ?? "direct",
        isFromMe: !!row.is_from_me,
        hasAttachments: !!row.cache_has_attachments,
      };

      const importance = estimateImportance(row.text, meta);
      if (importance < this.config.importanceThreshold) continue;

      const privacy = classifyPrivacy(row.text, meta);

      events.push({
        id: `imessage-${row.ROWID}`,
        source: "imessage",
        eventType: "message",
        content:
          privacy === "summarize"
            ? row.text.slice(0, 200) + "..."
            : privacy === "local-only"
              ? "[REDACTED — local only]"
              : row.text,
        timestamp: new Date(row.unix_ts * 1000).toISOString(),
        meta,
        importanceEstimate: importance,
        privacyTier: privacy,
      });
    }

    return events;
  }

  getCheckpoint(): string {
    return String(this.checkpoint);
  }

  setCheckpoint(cursor: string): void {
    this.checkpoint = parseInt(cursor, 10) || 0;
  }

  async destroy(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
