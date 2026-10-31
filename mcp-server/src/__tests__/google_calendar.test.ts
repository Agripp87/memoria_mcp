import { describe, it, expect, vi } from "vitest";
import { GoogleCalendarAdapter } from "../collector/adapters/google-calendar.js";

// A fake events.list that behaves like the API where it matters here: a
// syncToken request refuses orderBy/timeMin/timeMax (400), and both kinds of
// request hand back a nextSyncToken on their last page (2026-10 re-review F19).
function fakeCalendar(opts: { fail?: (calendarId: string) => Error | null } = {}) {
  const calls: any[] = [];
  const soon = new Date(Date.now() + 3600_000).toISOString();
  const farAway = new Date(Date.now() + 90 * 86400_000).toISOString();
  const calendar = {
    events: {
      list: vi.fn(async (params: any) => {
        calls.push({ ...params });
        const failure = opts.fail?.(params.calendarId);
        if (failure) throw failure;
        if (params.syncToken && (params.orderBy || params.timeMin || params.timeMax)) {
          throw Object.assign(new Error("Invalid request: orderBy with syncToken"), { code: 400 });
        }
        const items = params.syncToken
          ? [
              { id: "e2", summary: "Planning review meeting", start: { dateTime: soon } },
              { id: "e3", summary: "Offsite far ahead", start: { dateTime: farAway } },
            ]
          : [{ id: "e1", summary: "Planning kickoff meeting", start: { dateTime: soon } }];
        return { data: { items, nextSyncToken: `tok-${calls.length}` } };
      }),
    },
  };
  return { calendar, calls };
}

function adapter(calendar: any, calendarIds = ["primary"]) {
  const a = new GoogleCalendarAdapter();
  (a as any).calendar = calendar;
  (a as any).config = {
    enabled: true,
    pollIntervalSec: 300,
    importanceThreshold: 1,
    settings: { calendarIds, lookAheadDays: 7, lookBehindDays: 1 },
  };
  return a;
}

describe("GoogleCalendarAdapter incremental sync", () => {
  it("the second poll sends the sync token alone, and keeps to the window", async () => {
    const { calendar, calls } = fakeCalendar();
    const a = adapter(calendar);
    expect((await a.poll()).map((e) => e.content)).toEqual(["Planning kickoff meeting"]);
    const second = await a.poll();
    expect(calls[1].syncToken).toBe("tok-1");
    expect(calls[1]).not.toHaveProperty("orderBy");
    expect(calls[1]).not.toHaveProperty("timeMin");
    expect(second.map((e) => e.content)).toEqual(["Planning review meeting"]);
  });

  it("fails the poll when every calendar failed, so the daemon backs off and shows it", async () => {
    const { calendar } = fakeCalendar({
      fail: () => Object.assign(new Error("invalid_grant"), { code: 401 }),
    });
    await expect(adapter(calendar).poll()).rejects.toThrow(/invalid_grant/);
  });

  it("returns the calendars that worked when only some failed", async () => {
    const { calendar } = fakeCalendar({
      fail: (id) => (id === "broken" ? Object.assign(new Error("not found"), { code: 404 }) : null),
    });
    const events = await adapter(calendar, ["primary", "broken"]).poll();
    expect(events.map((e) => e.content)).toEqual(["Planning kickoff meeting"]);
  });

  it("an expired sync token starts over with a full sync", async () => {
    let expired = true;
    const { calendar, calls } = fakeCalendar({
      fail: () => {
        if (calls.length === 1 && expired) {
          expired = false;
          return Object.assign(new Error("Sync token is no longer valid"), { code: 410 });
        }
        return null;
      },
    });
    const a = adapter(calendar);
    a.setCheckpoint(JSON.stringify({ syncTokens: { primary: "old" } }));
    expect((await a.poll()).map((e) => e.content)).toEqual(["Planning kickoff meeting"]);
    expect(calls[1].timeMin).toBeDefined();
  });
});
