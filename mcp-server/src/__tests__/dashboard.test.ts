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
  try { store?.close(); } catch {}
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

/** Render the dashboard page ("/") by invoking the router with a mock req/res. */
function renderDashboardHtml(): string {
  const router = createDashboardRouter(store);
  let html = "";
  const req: any = { method: "GET", url: "/", headers: {} };
  const res: any = {
    send(s: string) { html = String(s); return res; },
    set() { return res; },
    setHeader() { return res; },
    type() { return res; },
    status() { return res; },
    json() { return res; },
    end() { return res; },
  };
  router(req, res, (err?: any) => { if (err) throw err; });
  return html;
}

describe("dashboard page", () => {
  it("renders the page with the Wiki tab", () => {
    const html = renderDashboardHtml();
    expect(html).toContain('data-tab="wiki"');
    expect(html).toContain("<script>");
  });

  it("emits a syntactically valid client script (guards against quoting bugs)", () => {
    const html = renderDashboardHtml();
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const scriptBody = (m as RegExpMatchArray)[1];
    // new Function() COMPILES (not runs) the body — throws SyntaxError on bad
    // syntax (e.g. a single quote that closes a JS string early). It would have
    // caught the `onkeyup="...'Enter'..."` regression.
    expect(() => new Function(scriptBody)).not.toThrow();
  });
});
