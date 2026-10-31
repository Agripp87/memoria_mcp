import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

// A dashboard whose server opened the store second (a Claude Code stdio
// session got there first) cannot reach the collector. Its source routes
// used to answer a bare 500, which the page rendered as "No sources
// registered" (2026-10 re-review F6).
const KEY = "test-key-abcdefghijklmnop";
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-dash-sec-"));
process.env.MEMORIA_API_KEY = KEY;
process.env.MEMORIA_OAUTH_CLIENT_SECRET = "oauth-client-secret-distinct-zyxwv";
process.env.MEMORIA_DIR = ROOT;
process.env.MEMORIA_EMBEDDINGS = "hash";
process.env.MEMORIA_TOKEN_DB_DIR = path.join(ROOT, "tok");

let request: any;
let app: any;
let primary: any;
const auth = { Authorization: `Bearer ${KEY}` };

beforeAll(async () => {
  fs.mkdirSync(path.join(ROOT, "memories"), { recursive: true });
  fs.mkdirSync(path.join(ROOT, "tok"), { recursive: true });
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  const { MemoryStore } = await import("../store.js");
  primary = new MemoryStore(path.join(ROOT, "data", "memoria.sqlite"), { shared: true });
  request = (await import("supertest")).default;
  app = (await import("../http.js")).app;
});

afterAll(() => {
  try {
    primary.close();
  } catch {}
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("dashboard in a secondary (F6)", () => {
  it("answers the source and collector routes with 503 and an explanation", async () => {
    const calls: Array<["get" | "post", string]> = [
      ["get", "/dashboard/api/sources"],
      ["get", "/dashboard/api/collector/status"],
      ["post", "/dashboard/api/sources/imessage/agree"],
      ["post", "/dashboard/api/sources/imessage/enable"],
    ];
    let ip = 0;
    for (const [method, url] of calls) {
      const r = await request(app)
        [method](url)
        .set(auth)
        .set("X-Forwarded-For", `10.77.0.${++ip}`)
        .send({});
      expect(r.status, url).toBe(503);
      expect(r.body.secondary).toBe(true);
      expect(r.body.error).toContain(`pid ${process.pid}`);
      // The dashboard is what cannot help here; it must not send the user to it.
      expect(r.body.error).not.toMatch(/use the dashboard/i);
    }
  });

  it("still serves the memory routes", async () => {
    const r = await request(app).get("/dashboard/api/stats").set(auth);
    expect(r.status).toBe(200);
  });
});
