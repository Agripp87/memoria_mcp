import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomAdapter } from "../collector/adapters/custom.js";

describe("custom source timestamps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces an implausible timestamp with the current time", async () => {
    const adapter = new CustomAdapter({
      id: "timestamp-test",
      name: "Timestamp test",
      description: "Test source",
      mode: "webhook",
      fieldMap: {
        content: "content",
        timestamp: "timestamp",
      },
    });

    await adapter.init({
      enabled: true,
      pollIntervalSec: 60,
      importanceThreshold: 1,
      settings: {},
    });

    adapter.pushWebhookEvent({
      content: "A custom event with a timestamp that needs checking.",
      timestamp: 1727186400000000,
    });

    const events = await adapter.poll();

    expect(events).toHaveLength(1);
    expect(events[0]?.timestamp).toBe("2026-09-24T12:00:00.000Z");
  });
});
