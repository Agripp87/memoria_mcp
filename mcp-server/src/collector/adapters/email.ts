/**
 * Email adapter — reads email via IMAP.
 * Works cross-platform. Uses the `imapflow` npm package.
 * Auto-installed when the user enables this source.
 */

import type { SourceAdapter, AdapterInfo, AdapterConfig, RawEvent } from "./base.js";
import { estimateImportance, classifyPrivacy } from "./base.js";

export class EmailAdapter implements SourceAdapter {
  readonly info: AdapterInfo = {
    id: "email",
    name: "Email (IMAP)",
    description:
      "Collects email subjects and summaries via IMAP. Supports Gmail, Outlook, iCloud, and any IMAP server.",
    platforms: ["macos", "linux", "windows"],
    dependencies: ["imapflow"],
    requiredPermissions: ["IMAP credentials (server, username, app password)"],
    builtIn: true,
    defaultConfig: {
      enabled: false,
      pollIntervalSec: 600, // 10 minutes
      importanceThreshold: 3,
      settings: {
        host: "",
        port: 993,
        secure: true,
        user: "",
        password: "", // stored encrypted
        mailbox: "INBOX",
        maxFetch: 50,
      },
    },
  };

  private client: any = null;
  private checkpoint: number = 0; // UID of last processed message
  private config!: AdapterConfig;

  async init(config: AdapterConfig): Promise<void> {
    this.config = config;

    const { host, port, secure, user, password } = config.settings as Record<string, any>;

    if (!host || !user || !password) {
      throw new Error("Email adapter requires host, user, and password in settings.");
    }

    try {
      const { ImapFlow } = await import("imapflow");
      this.client = new ImapFlow({
        host,
        port: port ?? 993,
        secure: secure !== false,
        auth: { user, pass: password },
        logger: false,
      });

      await this.client.connect();
    } catch (err: any) {
      throw new Error(
        `Email connection failed: ${err.message}. ` +
          "Check your IMAP credentials and ensure app-specific passwords are used for Gmail/iCloud.",
        { cause: err },
      );
    }
  }

  async poll(): Promise<RawEvent[]> {
    if (!this.client) return [];

    const mailbox = (this.config.settings?.mailbox as string) ?? "INBOX";
    const maxFetch = (this.config.settings?.maxFetch as number) ?? 50;

    const events: RawEvent[] = [];

    try {
      const lock = await this.client.getMailboxLock(mailbox);

      try {
        // Fetch messages with UID greater than checkpoint
        const query = this.checkpoint > 0 ? `${this.checkpoint + 1}:*` : `*`;

        for await (const message of this.client.fetch(query, {
          uid: true,
          envelope: true,
          bodyStructure: true,
          source: { maxBytes: 1024 }, // first 1KB of body only
        })) {
          if (message.uid <= this.checkpoint && this.checkpoint > 0) continue;
          this.checkpoint = Math.max(this.checkpoint, message.uid);

          const env = message.envelope;
          if (!env) continue;

          const from = env.from?.[0]?.name ?? env.from?.[0]?.address ?? "unknown";
          const to = (env.to ?? []).map((t: any) => t.name ?? t.address).join(", ");

          const subject = env.subject ?? "(no subject)";
          const date = env.date ? new Date(env.date).toISOString() : new Date().toISOString();

          // Extract preview text from source (first 500 chars)
          let preview = "";
          if (message.source) {
            const bodyText = message.source.toString("utf-8");
            // Very basic: grab text after the headers
            const bodyStart = bodyText.indexOf("\r\n\r\n");
            if (bodyStart > -1) {
              preview = bodyText
                .slice(bodyStart + 4, bodyStart + 504)
                .replace(/[<>]/g, "")
                .replace(/\s+/g, " ")
                .trim();
            }
          }

          const content = preview ? `${subject} — ${preview.slice(0, 200)}` : subject;

          const meta: Record<string, unknown> = {
            from,
            to,
            subject,
            isAutomated: /no-?reply|automated|noreply|mailer-daemon/i.test(from),
          };

          const importance = estimateImportance(content, meta);
          if (importance < this.config.importanceThreshold) continue;

          const privacy = classifyPrivacy(content, meta);
          if (privacy === "local-only") continue; // never send sensitive email content

          events.push({
            id: `email-${message.uid}`,
            source: "email",
            eventType: "email_received",
            content: privacy === "summarize" ? `${subject} (from ${from})` : content,
            timestamp: date,
            meta,
            importanceEstimate: importance,
            privacyTier: privacy,
          });

          if (events.length >= maxFetch) break;
        }
      } finally {
        lock.release();
      }
    } catch (err: any) {
      process.stderr.write(`Memoria email poll error: ${err.message}\n`);
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
    if (this.client) {
      await this.client.logout().catch(() => {});
      this.client = null;
    }
  }
}
