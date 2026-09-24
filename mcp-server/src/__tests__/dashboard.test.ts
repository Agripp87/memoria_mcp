import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

// dashboard.ts (via tools.ts) reads MEMORIA_DIR at load — point it at a temp dir.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-dash-"));
process.env.MEMORIA_DIR = ROOT;

let createDashboardRouter: (store: any) => any;
let MemoryStore: any;
let store: any;

beforeAll(async () => {
  fs.mkdirSync(path.join(ROOT, "memories"), { recursive: true });
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  const s = await import("../store.js");
  MemoryStore = s.MemoryStore;
  store = new MemoryStore(path.join(ROOT, "data", "dash.sqlite"));
  const d = await import("../dashboard.js");
  createDashboardRouter = d.createDashboardRouter;
});

afterAll(() => {
  try {
    store?.close();
  } catch {}
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {}
});

/** Render the dashboard page ("/") by invoking the router with a mock req/res. */
function renderDashboard(): { html: string; headers: Record<string, string> } {
  const router = createDashboardRouter(store);
  let html = "";
  const headers: Record<string, string> = {};
  const req: any = { method: "GET", url: "/", headers: {} };
  const res: any = {
    send(s: string) {
      html = String(s);
      return res;
    },
    set(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    type() {
      return res;
    },
    status() {
      return res;
    },
    json() {
      return res;
    },
    end() {
      return res;
    },
  };
  router(req, res, (err?: any) => {
    if (err) throw err;
  });
  return { html, headers };
}

const SCRIPT_RE = /<script nonce="([^"]+)">([\s\S]*?)<\/script>/;

function clientScript(html: string): string {
  const m = html.match(SCRIPT_RE);
  expect(m).toBeTruthy();
  return (m as RegExpMatchArray)[2];
}

describe("dashboard page", () => {
  it("renders the page with the Wiki tab", () => {
    const { html } = renderDashboard();
    expect(html).toContain('data-tab="wiki"');
    expect(html).toMatch(SCRIPT_RE);
    expect(html).not.toContain("__CSP_NONCE__");
  });

  it("emits a syntactically valid client script (guards against quoting bugs)", () => {
    // new Function() COMPILES (not runs) the body — throws SyntaxError on bad
    // syntax (e.g. a single quote that closes a JS string early). It would have
    // caught the `onkeyup="...'Enter'..."` regression.
    expect(() => new Function(clientScript(renderDashboard().html))).not.toThrow();
  });
});

describe("dashboard XSS defences (2026-09 review, H2)", () => {
  it("sends a CSP whose script nonce matches the page's one script, fresh per response", () => {
    const a = renderDashboard();
    const b = renderDashboard();
    const nonce = (a.html.match(SCRIPT_RE) as RegExpMatchArray)[1];
    const csp = a.headers["content-security-policy"];
    expect(csp).toContain(`script-src 'nonce-${nonce}'`);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect((b.html.match(SCRIPT_RE) as RegExpMatchArray)[1]).not.toBe(nonce);
  });

  it("has no inline event-handler attributes, in the markup or in HTML the script builds", () => {
    // The CSP blocks them, so one would be a silently dead button — and they
    // are exactly what an attribute breakout would inject.
    expect(renderDashboard().html).not.toMatch(/\son[a-z]+\s*=\s*["']/i);
  });

  it("every data-action in the page has a handler, and every handler is used", () => {
    const { html } = renderDashboard();
    const used = new Set([...html.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]));
    const block = html.match(/const ACTIONS = \{([\s\S]*?)\n\};/);
    expect(block).toBeTruthy();
    const defined = new Set(
      [...(block as RegExpMatchArray)[1].matchAll(/^\s*'([a-z-]+)':/gm)].map((m) => m[1]),
    );
    expect([...used].sort()).toEqual([...defined].sort());
  });

  it("every element the script binds at load exists in the static markup", () => {
    // A top-level getElementById(...).addEventListener on a missing id throws
    // on page load and takes every handler after it down with it.
    const { html } = renderDashboard();
    const markup = html.slice(0, html.search(SCRIPT_RE));
    const bound = [...clientScript(html).matchAll(/^document\.getElementById\('([\w-]+)'\)/gm)];
    expect(bound.length).toBeGreaterThanOrEqual(3);
    for (const [, id] of bound) expect(markup).toContain(`id="${id}"`);
  });

  it("the client escapeHtml escapes all five characters, quotes included", () => {
    // Run the page's own escaper, not a copy of it.
    const script = clientScript(renderDashboard().html);
    const src = script.match(
      /const HTML_ESCAPES = [^\n]*\nfunction escapeHtml\(s\) \{[\s\S]*?\n\}/,
    );
    expect(src).toBeTruthy();
    const escapeHtml = new Function(`${(src as RegExpMatchArray)[0]}; return escapeHtml;`)();
    expect(escapeHtml(`"><img src=x>'&`)).toBe("&quot;&gt;&lt;img src=x&gt;&#39;&amp;");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(0)).toBe("0");
  });
});

describe("POST /api/journal input validation (2026-09 review, L8/L9)", () => {
  async function post(body: unknown) {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const app = express();
    app.use(express.json());
    app.use("/", createDashboardRouter(store));
    return request(app).post("/api/journal").send(body);
  }

  it("rejects a mood the picker cannot produce", async () => {
    const r = await post({ entry: "x", mood: "good)\n## 00:00 — forged" });
    expect(r.status).toBe(400);
  });

  it("rejects tags that are not an array of short one-line strings", async () => {
    expect((await post({ entry: "x", tags: "not-an-array" })).status).toBe(400);
    expect((await post({ entry: "x", tags: ["ok", "two\nlines"] })).status).toBe(400);
    expect((await post({ entry: "x", tags: ["x".repeat(51)] })).status).toBe(400);
    expect((await post({ entry: "x", tags: Array(21).fill("t") })).status).toBe(400);
  });

  it("accepts a valid entry and labels it in UTC, matching the file's UTC date", async () => {
    const r = await post({ entry: "valid entry", mood: "good", tags: ["a", "b"] });
    expect(r.status).toBe(200);
    const file = path.join(ROOT, "memories", "daily", `${r.body.date}.md`);
    const text = fs.readFileSync(file, "utf-8");
    expect(text).toMatch(/## \d{2}:\d{2} UTC — Journal \(good\)\n\nvalid entry\n\*Tags: a, b\*/);
  });
});
