import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { buildEntityPages, GENERATED_MARKER } from "../entities.js";

let ROOT: string;
let MEM: string;

function writeDaily(date: string, body: string) {
  const dir = path.join(MEM, "daily");
  fs.mkdirSync(dir, { recursive: true });
  const header = `---\nname: Daily log ${date}\ntype: session\nimportance: 3\n---\n\n# Daily Log — ${date}\n\n`;
  fs.writeFileSync(path.join(dir, `${date}.md`), header + body, "utf-8");
}

function entry(time: string, source: string, content: string, importance = 5) {
  return `## ${time} — ${source}\n\n${content}\n\n*importance: ${importance} | privacy: send*\n`;
}

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-ent-"));
  MEM = path.join(ROOT, "memories");
  fs.mkdirSync(MEM, { recursive: true });
});

afterEach(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

describe("buildEntityPages (P0)", () => {
  it("compiles per-source pages once a source clears the event threshold", () => {
    writeDaily("2026-06-01", entry("10:00 AM", "research-agent", "found paper A") + entry("11:00 AM", "calendar", "standup"));
    writeDaily("2026-06-02", entry("10:00 AM", "research-agent", "found paper B") + entry("12:00 PM", "research-agent", "found paper C", 8));

    const res = buildEntityPages(MEM, { minEvents: 3 });
    // research-agent has 3 events -> page; calendar has 1 -> no page.
    expect(res.written).toContain("entities/research-agent.md");
    expect(res.written).not.toContain("entities/calendar.md");
    expect(res.sourcesSeen).toBe(2);

    const page = fs.readFileSync(path.join(MEM, "entities/research-agent.md"), "utf-8");
    expect(page).toContain("type: source-rollup");
    expect(page).toContain(`generated: ${GENERATED_MARKER}`);
    // Backlinks to the source daily logs (graph edges).
    expect(page).toContain("[[daily/2026-06-01]]");
    expect(page).toContain("[[daily/2026-06-02]]");
    // High-importance event surfaced individually.
    expect(page).toContain("found paper C");
    expect(page).toContain("Notable events");
  });

  it("is idempotent — re-running an unchanged rollup writes nothing", () => {
    writeDaily("2026-06-01", entry("10:00 AM", "agent-x", "a") + entry("10:01 AM", "agent-x", "b") + entry("10:02 AM", "agent-x", "c"));
    const first = buildEntityPages(MEM, { minEvents: 3 });
    expect(first.written).toContain("entities/agent-x.md");
    const second = buildEntityPages(MEM, { minEvents: 3 });
    expect(second.written).toHaveLength(0);
  });

  it("never overwrites a page a human has taken over (marker removed)", () => {
    writeDaily("2026-06-01", entry("10:00 AM", "agent-y", "a") + entry("10:01 AM", "agent-y", "b") + entry("10:02 AM", "agent-y", "c"));
    buildEntityPages(MEM, { minEvents: 3 });
    const p = path.join(MEM, "entities/agent-y.md");
    // Human takes ownership: remove the generated marker, edit content.
    fs.writeFileSync(p, "---\nname: My curated page\ntype: source-rollup\nimportance: 8\n---\n\nHand-written.\n", "utf-8");
    writeDaily("2026-06-03", entry("09:00 AM", "agent-y", "d") + entry("09:01 AM", "agent-y", "e") + entry("09:02 AM", "agent-y", "f"));

    const res = buildEntityPages(MEM, { minEvents: 3 });
    expect(res.skipped).toContain("entities/agent-y.md");
    expect(res.written).not.toContain("entities/agent-y.md");
    expect(fs.readFileSync(p, "utf-8")).toContain("Hand-written.");
  });

  it("onlySources restricts the rebuild to the named sources (P2 propagation)", () => {
    writeDaily("2026-06-01",
      entry("10:00 AM", "src-a", "1") + entry("10:01 AM", "src-a", "2") + entry("10:02 AM", "src-a", "3") +
      entry("11:00 AM", "src-b", "1") + entry("11:01 AM", "src-b", "2") + entry("11:02 AM", "src-b", "3"));
    const res = buildEntityPages(MEM, { minEvents: 3, onlySources: ["src-b"] });
    expect(res.written).toEqual(["entities/src-b.md"]);
    expect(fs.existsSync(path.join(MEM, "entities/src-a.md"))).toBe(false);
  });
});
