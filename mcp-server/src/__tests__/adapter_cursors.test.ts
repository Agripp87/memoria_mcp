/**
 * Adapter cursors (review 2026-10): each adapter must advance its cursor only
 * past what it actually returned, and surface failures to the daemon instead
 * of reporting "nothing new". The external services are faked at the client
 * boundary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── IMAP ────────────────────────────────────────────────────

interface FakeMessage {
  uid: number;
  seq: number;
  /** As imapflow parses it: a Date, possibly invalid. */
  date?: Date;
  internalDate?: Date;
}

const imap = {
  instances: [] as any[],
  messages: [] as FakeMessage[],
  fetchCalls: [] as Array<{ range: string; query: any; options: any }>,
  searchCalls: [] as Array<{ query: any; options: any }>,
  failLock: false,
  uidValidity: 1,
};

class FakeImapFlow {
  usable = false;
  mailbox: { uidValidity: number } | false = false;
  constructor(public opts: any) {
    imap.instances.push(this);
  }
  on() {
    return this;
  }
  async connect() {
    this.usable = true;
  }
  async logout() {
    this.usable = false;
  }
  async getMailboxLock() {
    if (imap.failLock) throw new Error("connection not available");
    this.mailbox = { uidValidity: imap.uidValidity };
    return { release() {} };
  }
  // Mirrors IMAP: "N:*" by UID when options.uid, else by sequence number
  // ("*" always matches the newest); "a,b,c" is an explicit set.
  select(range: string, key: "uid" | "seq") {
    const sorted = [...imap.messages].sort((a, b) => a[key] - b[key]);
    if (range === "*") return sorted.slice(-1);
    if (range.includes(",")) {
      const want = new Set(range.split(",").map(Number));
      return sorted.filter((m) => want.has(m[key]));
    }
    const from = parseInt(range, 10);
    const selected = range.endsWith(":*")
      ? sorted.filter((m) => m[key] >= from)
      : sorted.filter((m) => m[key] === from);
    return selected.length ? selected : sorted.slice(-1);
  }
  async search(query: { uid: string }, options: any = {}) {
    imap.searchCalls.push({ query, options });
    return this.select(query.uid, "uid").map((m) => m.uid);
  }
  async *fetch(range: string, query: any, options: any = {}) {
    imap.fetchCalls.push({ range, query, options });
    for (const m of this.select(range, options.uid ? "uid" : "seq")) {
      const raw = Buffer.from(`Header: x\r\n\r\nWe decided to ship the release on Friday.`);
      yield {
        uid: m.uid,
        envelope: {
          from: [{ name: "Alice" }],
          to: [],
          subject: `Project update ${m.uid}`,
          date: m.date,
        },
        internalDate: query.internalDate ? m.internalDate : undefined,
        // imapflow reads a partial fetch from start/maxLength.
        source: typeof query.source === "object" ? raw.subarray(0, query.source.maxLength) : raw,
      };
    }
  }
}

vi.mock("../collector/deps.js", () => ({
  importDependency: async (name: string) => {
    if (name === "imapflow") return { ImapFlow: FakeImapFlow };
    throw new Error(`unexpected dependency ${name}`);
  },
}));

const { EmailAdapter } = await import("../collector/adapters/email.js");
const { GoogleGmailAdapter } = await import("../collector/adapters/google-gmail.js");
const { CalendarAdapter } = await import("../collector/adapters/calendar.js");

function emailConfig() {
  return {
    enabled: true,
    pollIntervalSec: 600,
    importanceThreshold: 1,
    settings: { host: "imap.example.com", user: "u", password: "p", maxFetch: 50 },
  };
}

beforeEach(() => {
  imap.instances = [];
  imap.fetchCalls = [];
  imap.searchCalls = [];
  imap.failLock = false;
  imap.uidValidity = 1;
  // A long-lived mailbox: UIDs far above sequence numbers.
  imap.messages = Array.from({ length: 5 }, (_, i) => ({ uid: 120_000 + i, seq: 4_996 + i }));
});

describe("EmailAdapter", () => {
  it("fetches by UID, so a stored UID cursor resumes at the right message", async () => {
    const a = new EmailAdapter();
    await a.init(emailConfig());
    a.setCheckpoint("120001");
    const events = await a.poll();
    expect(imap.searchCalls[0]).toEqual({ query: { uid: "120002:*" }, options: { uid: true } });
    expect(imap.fetchCalls[0].range).toBe("120002,120003,120004");
    expect(imap.fetchCalls[0].options).toEqual({ uid: true });
    expect(events.map((e) => e.id)).toEqual(["email-120002", "email-120003", "email-120004"]);
    expect(a.getCheckpoint()).toBe("1:120004");
  });

  it("restarts from the newest message when UIDVALIDITY changes", async () => {
    const a = new EmailAdapter();
    await a.init(emailConfig());
    a.setCheckpoint("1:999999"); // a UID from the mailbox's previous life
    imap.uidValidity = 2;
    const events = await a.poll();
    expect(events.map((e) => e.id)).toEqual(["email-120004"]);
    expect(a.getCheckpoint()).toBe("2:120004");
  });

  it("fetches only one batch of a long backlog, and the next poll continues", async () => {
    // Fetching "N:*" downloaded every newer message each poll.
    imap.messages = Array.from({ length: 500 }, (_, i) => ({ uid: 1_000 + i, seq: 1 + i }));
    const a = new EmailAdapter();
    await a.init({ ...emailConfig(), settings: { ...emailConfig().settings, maxFetch: 20 } });
    a.setCheckpoint("1:999");
    const first = await a.poll();
    expect(first).toHaveLength(20);
    expect(imap.fetchCalls[0].range.split(",")).toHaveLength(20);
    const second = await a.poll();
    expect(second[0].id).toBe("email-1020");
    expect(a.getCheckpoint()).toBe("1:1039");
  });

  it("does not fetch at all when nothing is new", async () => {
    const a = new EmailAdapter();
    await a.init(emailConfig());
    a.setCheckpoint("1:120004");
    expect(await a.poll()).toEqual([]);
    expect(imap.fetchCalls).toHaveLength(0);
  });

  it("starts from the newest message when there is no cursor", async () => {
    const a = new EmailAdapter();
    await a.init(emailConfig());
    const events = await a.poll();
    expect(events.map((e) => e.id)).toEqual(["email-120004"]);
    expect(a.getCheckpoint()).toBe("1:120004");
    // Nothing new: the "*" match on the newest message is not re-emitted.
    expect(await a.poll()).toEqual([]);
  });

  it("reconnects when the connection was dropped", async () => {
    const a = new EmailAdapter();
    await a.init(emailConfig());
    imap.instances[0].usable = false; // server closed the idle connection
    a.setCheckpoint("120003");
    const events = await a.poll();
    expect(imap.instances).toHaveLength(2);
    expect(events.map((e) => e.id)).toEqual(["email-120004"]);
  });

  it("an unparseable Date header skips nothing and stalls nothing (F3)", async () => {
    const a = new EmailAdapter();
    await a.init(emailConfig());
    a.setCheckpoint("1:119999");
    const received = new Date("2026-10-29T08:00:00Z");
    imap.messages[1].date = new Date("Thu, 29 Oct 2026 10:00:00 CEST"); // Invalid Date
    imap.messages[1].internalDate = received;
    const events = await a.poll();
    expect(events).toHaveLength(5);
    expect(events.find((e) => e.id === `email-${imap.messages[1].uid}`)!.timestamp).toBe(
      received.toISOString(),
    );
    expect(a.getCheckpoint()).toBe(`1:${imap.messages[4].uid}`);
  });

  it("fetches a bounded part of each message, not the whole of it (F30)", async () => {
    const a = new EmailAdapter();
    await a.init(emailConfig());
    a.setCheckpoint("1:119999");
    await a.poll();
    const source = imap.fetchCalls[0].query.source;
    expect(source).not.toHaveProperty("maxBytes");
    expect(typeof source.maxLength).toBe("number");
    expect(source.maxLength).toBeLessThanOrEqual(64 * 1024);
  });

  it("throws on a failed poll instead of reporting an empty mailbox", async () => {
    const a = new EmailAdapter();
    await a.init(emailConfig());
    imap.failLock = true;
    await expect(a.poll()).rejects.toThrow(/email poll failed/);
  });
});

// ── Gmail ───────────────────────────────────────────────────

function fakeGmail(pages: Array<{ history: any[]; nextPageToken?: string }>, current = "900") {
  const fetched: string[] = [];
  const gmail = {
    users: {
      history: {
        list: vi.fn(
          async ({ pageToken, startHistoryId }: { pageToken?: string; startHistoryId: string }) => {
            const page = pages[pageToken ? parseInt(pageToken, 10) : 0];
            // startHistoryId is exclusive, as in the Gmail API.
            const history = page.history.filter((r) => Number(r.id) > Number(startHistoryId));
            return { data: { ...page, history, historyId: current } };
          },
        ),
      },
      messages: {
        get: vi.fn(async ({ id }: { id: string }) => {
          fetched.push(id);
          return {
            data: {
              snippet: "We decided to ship the release on Friday",
              labelIds: ["INBOX"],
              payload: {
                headers: [
                  { name: "From", value: "Alice <alice@example.com>" },
                  { name: "Subject", value: `Project update ${id}` },
                  { name: "Date", value: "Mon, 26 Oct 2026 10:00:00 +0000" },
                ],
              },
            },
          };
        }),
      },
      getProfile: vi.fn(async () => ({ data: { historyId: current } })),
      labels: {
        list: vi.fn(async () => ({
          data: {
            labels: [
              { id: "INBOX", name: "INBOX" },
              { id: "STARRED", name: "STARRED" },
              { id: "Label_12", name: "Work" },
            ],
          },
        })),
      },
    },
  };
  return { gmail, fetched };
}

function record(id: number, ...msgIds: string[]) {
  return {
    id: String(id),
    messagesAdded: msgIds.map((m) => ({ message: { id: m, labelIds: [] } })),
  };
}

function gmailAdapter(gmail: any, maxResults: number) {
  const a = new GoogleGmailAdapter();
  (a as any).gmail = gmail;
  (a as any).config = {
    enabled: true,
    pollIntervalSec: 300,
    importanceThreshold: 1,
    settings: { labels: ["INBOX"], excludeLabels: [], maxResults },
  };
  a.setCheckpoint("100");
  return a;
}

describe("GoogleGmailAdapter history cursor", () => {
  it("does not skip messages beyond one batch: the cursor stops at the last record taken", async () => {
    const { gmail, fetched } = fakeGmail([
      { history: [record(101, "m1", "m2"), record(102, "m3")], nextPageToken: "1" },
      { history: [record(103, "m4"), record(104, "m5")] },
    ]);
    const a = gmailAdapter(gmail, 3);
    await a.poll();
    expect(fetched).toEqual(["m1", "m2", "m3"]);
    // Not the mailbox's current id (900): records 103-104 are still pending.
    expect(a.getCheckpoint()).toBe("102");
  });

  it("the next poll resumes exactly where the previous batch stopped", async () => {
    const { gmail, fetched } = fakeGmail([
      {
        history: [record(101, "m1", "m2"), record(102, "m3"), record(103, "m4"), record(104, "m5")],
      },
    ]);
    const a = gmailAdapter(gmail, 3);
    await a.poll();
    expect(a.getCheckpoint()).toBe("102");
    await a.poll();
    expect(fetched).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(a.getCheckpoint()).toBe("900");
  });

  it("jumps to the mailbox's current history id once everything was read", async () => {
    const { gmail, fetched } = fakeGmail([
      { history: [record(101, "m1")], nextPageToken: "1" },
      { history: [record(102, "m2")] },
    ]);
    const a = gmailAdapter(gmail, 50);
    await a.poll();
    expect(fetched).toEqual(["m1", "m2"]);
    expect(a.getCheckpoint()).toBe("900");
  });

  it("a failed message fetch fails the poll (the daemon restores the cursor)", async () => {
    const { gmail } = fakeGmail([{ history: [record(101, "m1")] }]);
    gmail.users.messages.get = vi.fn(async () => {
      throw Object.assign(new Error("rate limited"), { code: 429 });
    });
    const a = gmailAdapter(gmail, 50);
    await expect(a.poll()).rejects.toThrow(/rate limited/);
  });

  it("an unparseable Date header falls back to the receive time (F3)", async () => {
    const { gmail, fetched } = fakeGmail([{ history: [record(101, "m1"), record(102, "m2")] }]);
    const get = gmail.users.messages.get;
    gmail.users.messages.get = vi.fn(async (args: { id: string }) => {
      const r = await get(args);
      if (args.id === "m1") {
        r.data.payload.headers[2].value = "Thu, 29 Oct 2026 10:00:00 CEST";
        (r.data as any).internalDate = String(Date.parse("2026-10-29T08:00:00Z"));
      }
      return r;
    });
    const a = gmailAdapter(gmail, 50);
    const events = await a.poll();
    expect(events).toHaveLength(2);
    expect(events[0].timestamp).toBe("2026-10-29T08:00:00.000Z");
    expect(a.getCheckpoint()).toBe("900");
    expect(fetched).toEqual(["m1", "m2"]);
  });

  it("the default excludes skip the Promotions tab, also in the old spelling (F20)", async () => {
    const history = [
      {
        id: "101",
        messagesAdded: [{ message: { id: "promo", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] } }],
      },
      { id: "102", messagesAdded: [{ message: { id: "real", labelIds: ["INBOX"] } }] },
    ];
    for (const excludeLabels of [
      new GoogleGmailAdapter().info.defaultConfig.settings!.excludeLabels,
      ["SPAM", "TRASH", "PROMOTIONS"],
      ["promotions"],
    ]) {
      const { gmail, fetched } = fakeGmail([{ history }]);
      const a = gmailAdapter(gmail, 50);
      (a as any).config.settings.excludeLabels = excludeLabels;
      await a.poll();
      expect(fetched, JSON.stringify(excludeLabels)).toEqual(["real"]);
    }
  });

  it("with several labels, takes messages carrying any of them, by name or id", async () => {
    const history = [
      { id: "101", messagesAdded: [{ message: { id: "work", labelIds: ["Label_12"] } }] },
      { id: "102", messagesAdded: [{ message: { id: "starred", labelIds: ["STARRED"] } }] },
      { id: "103", messagesAdded: [{ message: { id: "other", labelIds: ["Label_99"] } }] },
    ];
    const { gmail, fetched } = fakeGmail([{ history }]);
    const a = gmailAdapter(gmail, 50);
    (a as any).config.settings.labels = ["work", "STARRED"];
    await a.poll();
    expect(fetched).toEqual(["work", "starred"]);
    // A single label goes to the API's own filter, as its id.
    const single = fakeGmail([{ history: [] }]);
    const b = gmailAdapter(single.gmail, 50);
    (b as any).config.settings.labels = ["Work"];
    await b.poll();
    expect((single.gmail.users.history.list.mock.calls[0] as any)[0].labelId).toBe("Label_12");
  });

  it("list mode excludes the tab as a category (F20)", async () => {
    const { gmail } = fakeGmail([{ history: [] }]);
    const list = vi.fn(async () => ({ data: { messages: [] } }));
    (gmail.users.messages as any).list = list;
    const a = gmailAdapter(gmail, 50);
    (a as any).config.settings.excludeLabels = ["SPAM", "PROMOTIONS"];
    a.setCheckpoint("");
    await a.poll();
    const q = (list.mock.calls[0] as any)[0].q as string;
    expect(q).toContain("-category:promotions");
    expect(q).toContain("-label:spam");
  });

  it("skips a message deleted since its history record (404)", async () => {
    const { gmail } = fakeGmail([{ history: [record(101, "m1")] }]);
    gmail.users.messages.get = vi.fn(async () => {
      throw Object.assign(new Error("not found"), { code: 404 });
    });
    const a = gmailAdapter(gmail, 50);
    expect(await a.poll()).toEqual([]);
    expect(a.getCheckpoint()).toBe("900");
  });
});

// ── macOS Calendar ──────────────────────────────────────────

const CORE_DATA_EPOCH = 978307200;
const nowCore = () => Date.now() / 1000 - CORE_DATA_EPOCH;

function calendarDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ZCALENDAR (Z_PK INTEGER PRIMARY KEY, ZTITLE TEXT);
    CREATE TABLE ZCALENDARITEM (Z_PK INTEGER PRIMARY KEY, ZSTARTDATE REAL, ZENDDATE REAL,
      ZSUMMARY TEXT, ZLOCATION TEXT, ZNOTES TEXT, ZALLDAY INTEGER, ZMODIFIEDDATE REAL,
      ZCALENDAR INTEGER);
    INSERT INTO ZCALENDAR VALUES (1, 'Work');
  `);
  return db;
}

function addEvent(
  db: Database.Database,
  title: string,
  startInHours: number,
  modified: number | null,
): number {
  const start = nowCore() + startInHours * 3600;
  return Number(
    db
      .prepare(
        `INSERT INTO ZCALENDARITEM (ZSTARTDATE, ZENDDATE, ZSUMMARY, ZALLDAY, ZMODIFIEDDATE, ZCALENDAR)
         VALUES (?, ?, ?, 0, ?, 1)`,
      )
      .run(start, start + 3600, title, modified).lastInsertRowid,
  );
}

// The adapter keys its event ids with the collector key in this directory.
const CAL_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-cal-data-"));

function calendarAdapter(db: Database.Database, lookAheadDays = 7) {
  const a = new CalendarAdapter({ dataDir: CAL_DATA });
  (a as any).db = db;
  (a as any).config = {
    enabled: true,
    pollIntervalSec: 300,
    importanceThreshold: 1,
    settings: { lookAheadDays },
  };
  return a;
}

const titles = (events: Array<{ content: string }>) => events.map((e) => e.content).sort();

describe("CalendarAdapter collection", () => {
  it("the first poll returns the window, including never-modified events", async () => {
    const db = calendarDb();
    addEvent(db, "Planning meeting A", 2, null);
    addEvent(db, "Planning meeting B", 3, nowCore() - 600);
    expect(titles(await calendarAdapter(db).poll())).toEqual([
      "Planning meeting A",
      "Planning meeting B",
    ]);
  });

  it("event ids carry no title text, and change when the event is edited (F2)", async () => {
    // Ids reach the synced daily log (its ref) even for local-only events.
    const db = calendarDb();
    const id = addEvent(db, "Zoom passcode 123456", 2, nowCore() - 600);
    const a = calendarAdapter(db);
    const [first] = await a.poll();
    expect(first.id).toMatch(/^cal-\d+-\d+-[0-9a-f]{16}$/);
    expect(first.id).not.toMatch(/passcode|123456|Zoom/);
    db.prepare("UPDATE ZCALENDARITEM SET ZSUMMARY = ? WHERE Z_PK = ?").run(
      "Zoom passcode 654321",
      id,
    );
    const [edited] = await a.poll();
    expect(edited.id).not.toBe(first.id);
    expect(edited.id).not.toMatch(/passcode|654321/);
  });

  it("collects each event once, and again when it is edited", async () => {
    const db = calendarDb();
    const id = addEvent(db, "Planning meeting", 2, nowCore() - 600);
    const a = calendarAdapter(db);
    expect(await a.poll()).toHaveLength(1);
    expect(await a.poll()).toEqual([]);
    db.prepare("UPDATE ZCALENDARITEM SET ZSUMMARY = ?, ZMODIFIEDDATE = ? WHERE Z_PK = ?").run(
      "Planning meeting moved",
      nowCore(),
      id,
    );
    expect(titles(await a.poll())).toEqual(["Planning meeting moved"]);
  });

  it("collects an event created later with no modification date", async () => {
    // The modification-date cursor could never see these after the first poll.
    const db = calendarDb();
    addEvent(db, "Planning meeting A", 2, nowCore() - 600);
    const a = calendarAdapter(db);
    await a.poll();
    addEvent(db, "Planning meeting B", 5, null);
    expect(titles(await a.poll())).toEqual(["Planning meeting B"]);
  });

  it("collects an event created long ago once it enters the look-ahead window", async () => {
    const db = calendarDb();
    addEvent(db, "Planning offsite", 24 * 20, nowCore() - 86400 * 30); // 20 days out
    const a = calendarAdapter(db, 7);
    expect(await a.poll()).toEqual([]);
    // Time passes: simulate by widening the window to where "now" will be.
    (a as any).config.settings.lookAheadDays = 21;
    expect(titles(await a.poll())).toEqual(["Planning offsite"]);
  });

  it("collects every event of a busy window in one poll, with no tie rules", async () => {
    const db = calendarDb();
    const t = nowCore() - 100_000 + 0.123456; // one shared, fractional modification time
    for (let i = 0; i < 600; i++) addEvent(db, `Planning meeting ${i}`, 1 + i / 100, t);
    const a = calendarAdapter(db);
    expect(await a.poll()).toHaveLength(600);
    expect(await a.poll()).toEqual([]);
  });

  it("upgrading from a modification-date cursor skips only what it provably collected", async () => {
    const db = calendarDb();
    addEvent(db, "Planning meeting old", 2, nowCore() - 86400); // seen by v1
    addEvent(db, "Planning meeting new", 3, nowCore() - 60); // after the cursor
    addEvent(db, "Planning meeting undated", 4, null); // v1 could miss it
    // Modified 30 days ago, 20 days before it entered the 7-day window: v1 missed it.
    addEvent(db, "Planning offsite", 24 * 3, nowCore() - 86400 * 30);
    const a = calendarAdapter(db);
    a.setCheckpoint(new Date(Date.now() - 3600_000).toISOString()); // a v1 cursor
    expect(titles(await a.poll())).toEqual([
      "Planning meeting new",
      "Planning meeting undated",
      "Planning offsite",
    ]);
    expect(a.getCheckpoint()).toMatch(/^v2:/);
    expect(await a.poll()).toEqual([]);
  });

  it("the checkpoint round-trips, and a restored one suppresses re-collection", async () => {
    const db = calendarDb();
    addEvent(db, "Planning meeting", 2, null);
    const a = calendarAdapter(db);
    await a.poll();
    const b = calendarAdapter(db);
    b.setCheckpoint(a.getCheckpoint());
    expect(await b.poll()).toEqual([]);
  });

  it("throws on a query error instead of returning an empty calendar", async () => {
    const db = new Database(":memory:"); // no tables: a schema mismatch
    await expect(calendarAdapter(db).poll()).rejects.toThrow();
  });
});
