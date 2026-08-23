import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { createHash, randomBytes } from "node:crypto";

// http.ts reads MEMORIA_API_KEY + MEMORIA_DIR at module load and exits if the
// key is unset — set both BEFORE importing it. Importing does NOT start a
// server (the listen is guarded to the entry-point only).
const KEY = "test-key-abcdefghijklmnop";
// A DISTINCT OAuth client secret (≠ API key). This proves the two credentials
// are decoupled: rotating the API key must not silently rotate OAuth, and the
// API key must NOT be accepted as the OAuth client_secret (asserted below).
const OAUTH_SECRET = "oauth-client-secret-distinct-zyxwv";
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-http-"));
process.env.MEMORIA_API_KEY = KEY;
process.env.MEMORIA_OAUTH_CLIENT_SECRET = OAUTH_SECRET;
process.env.MEMORIA_DIR = ROOT;
process.env.MEMORIA_EMBEDDINGS = "hash";
process.env.MEMORIA_TOKEN_DB_DIR = path.join(ROOT, "tok");

let request: any;
let app: any;
const auth = { Authorization: `Bearer ${KEY}` };

beforeAll(async () => {
  fs.mkdirSync(path.join(ROOT, "memories", "user"), { recursive: true });
  fs.mkdirSync(path.join(ROOT, "tok"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "memories", "user", "demo.md"),
    "---\nname: Demo\ntype: user\nimportance: 7\n---\n\n# Demo\nHello **world** and [[Demo]].\n"
  );
  request = (await import("supertest")).default;
  app = (await import("../http.js")).app;
});

afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

describe("http app — smoke + routing", () => {
  it("GET /health -> 200", async () => {
    const r = await request(app).get("/health");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok" });
  });

  it("GET / -> 302 redirect to /dashboard", async () => {
    const r = await request(app).get("/");
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("/dashboard");
  });

  it("GET /dashboard -> 200 page with the Wiki tab (unauthenticated)", async () => {
    const r = await request(app).get("/dashboard");
    expect(r.status).toBe(200);
    expect(r.text).toContain('data-tab="wiki"');
  });
});

describe("http app — the /dashboard/api auth gate (the untested critical path)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const r = await request(app).get("/dashboard/api/stats");
    expect(r.status).toBe(401);
  });

  it("rejects a wrong bearer token with 401", async () => {
    const r = await request(app).get("/dashboard/api/stats").set("Authorization", "Bearer nope");
    expect(r.status).toBe(401);
  });

  it("accepts the correct bearer token with 200", async () => {
    const r = await request(app).get("/dashboard/api/stats").set(auth);
    expect(r.status).toBe(200);
  });

  it("gates the write endpoints too (annotate 401 without auth)", async () => {
    const r = await request(app)
      .post("/dashboard/api/memory/annotate")
      .send({ file: "user/demo.md", text: "x" });
    expect(r.status).toBe(401);
  });
});

describe("http app — wiki endpoints (authenticated)", () => {
  it("GET /api/wiki/index returns categories", async () => {
    const r = await request(app).get("/dashboard/api/wiki/index").set(auth);
    expect(r.status).toBe(200);
    expect(r.body.categories).toBeTruthy();
    expect(Object.keys(r.body.categories)).toContain("user");
  });

  it("GET /api/memory renders a memory to sanitized HTML", async () => {
    const r = await request(app).get("/dashboard/api/memory?file=user/demo.md").set(auth);
    expect(r.status).toBe(200);
    expect(r.body.html).toContain("<strong>world</strong>");
  });

  it("GET /api/memory rejects path traversal with 400", async () => {
    const r = await request(app).get("/dashboard/api/memory?file=../../etc/passwd").set(auth);
    expect(r.status).toBe(400);
  });

  it("GET /api/memory returns 404 for a missing file", async () => {
    const r = await request(app).get("/dashboard/api/memory?file=user/nope.md").set(auth);
    expect(r.status).toBe(404);
  });

  it("POST /api/memory/annotate appends a note (append-only)", async () => {
    const before = fs.readFileSync(path.join(ROOT, "memories", "user", "demo.md"), "utf-8");
    const r = await request(app)
      .post("/dashboard/api/memory/annotate")
      .set(auth)
      .send({ file: "user/demo.md", text: "a smoke-test note" });
    expect(r.status).toBe(200);
    const after = fs.readFileSync(path.join(ROOT, "memories", "user", "demo.md"), "utf-8");
    expect(after.startsWith(before)).toBe(true); // append-only: never rewrites
    expect(after).toContain("a smoke-test note");
  });

  it("POST /api/memory/annotate refuses MEMORY_INDEX.md", async () => {
    const r = await request(app)
      .post("/dashboard/api/memory/annotate")
      .set(auth)
      .send({ file: "MEMORY_INDEX.md", text: "x" });
    expect(r.status).toBe(400);
  });
});

describe("http app — OAuth token endpoint", () => {
  it("rejects client_credentials with a wrong client_secret", async () => {
    const r = await request(app)
      .post("/token")
      .type("form")
      .send({ grant_type: "client_credentials", client_id: "memoria", client_secret: "wrong" });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("invalid_client");
  });

  it("accepts client_credentials with the configured OAuth secret", async () => {
    const r = await request(app)
      .post("/token")
      .type("form")
      .send({ grant_type: "client_credentials", client_id: "memoria", client_secret: OAUTH_SECRET });
    expect(r.status).toBe(200);
    expect(r.body.access_token).toBeTruthy();
    expect(r.body.token_type).toBe("Bearer");
  });

  // Decoupling: the bearer API key is NOT the OAuth client_secret. Using the API
  // key where the OAuth secret belongs must be rejected — otherwise rotating one
  // credential silently rotates the other (the bug this guards against).
  it("REJECTS the API key used as the OAuth client_secret", async () => {
    const r = await request(app)
      .post("/token")
      .type("form")
      .send({ grant_type: "client_credentials", client_id: "memoria", client_secret: KEY });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("invalid_client");
  });

  it("unsupported grant_type -> 400", async () => {
    const r = await request(app)
      .post("/token")
      .type("form")
      .send({ grant_type: "password", client_id: "memoria", client_secret: OAUTH_SECRET });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("unsupported_grant_type");
  });
});

describe("http app — OAuth authorization_code + PKCE flow", () => {
  const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  // Pull a fresh authorization code out of the /authorize 302 redirect.
  async function getCode(): Promise<string> {
    const r = await request(app).get("/authorize").query({
      response_type: "code",
      client_id: "memoria",
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
    });
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.location);
    expect(loc.searchParams.get("state")).toBe("xyz");
    const code = loc.searchParams.get("code");
    expect(code).toBeTruthy();
    return code!;
  }

  it("GET /authorize requires PKCE S256 (no challenge -> 400)", async () => {
    const r = await request(app).get("/authorize").query({
      response_type: "code",
      client_id: "memoria",
      redirect_uri: REDIRECT,
    });
    expect(r.status).toBe(400);
  });

  it("GET /authorize rejects a non-allowlisted redirect_uri -> 400", async () => {
    const r = await request(app).get("/authorize").query({
      response_type: "code",
      client_id: "memoria",
      redirect_uri: "https://evil.example.com/cb",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    expect(r.status).toBe(400);
  });

  it("exchanges code+verifier for a token that actually authorizes the API", async () => {
    const code = await getCode();
    const r = await request(app).post("/token").type("form").send({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: "memoria",
      client_secret: OAUTH_SECRET,
    });
    expect(r.status).toBe(200);
    const token = r.body.access_token;
    expect(token).toBeTruthy();

    // The issued token must work as a Bearer credential on the gated API.
    const gated = await request(app).get("/dashboard/api/stats").set("Authorization", `Bearer ${token}`);
    expect(gated.status).toBe(200);
  });

  it("rejects the code exchange when the PKCE verifier is wrong -> 400", async () => {
    const code = await getCode();
    const r = await request(app).post("/token").type("form").send({
      grant_type: "authorization_code",
      code,
      code_verifier: randomBytes(32).toString("base64url"), // not the real verifier
      redirect_uri: REDIRECT,
      client_id: "memoria",
      client_secret: OAUTH_SECRET,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_grant");
  });

  it("rejects the code exchange without client authentication -> 401", async () => {
    const code = await getCode();
    const r = await request(app).post("/token").type("form").send({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: "memoria",
      client_secret: "wrong",
    });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("invalid_client");
  });
});

// ─── Phase 3 (critical-review remediation): security hardening ───

describe("prod-posture fail-closed gating (C2/C8)", () => {
  let prodPostureFatal: (env: Record<string, string | undefined>) => string | null;
  beforeAll(async () => {
    ({ prodPostureFatal } = await import("../http.js"));
  });

  it("refuses prod posture without a distinct OAuth client secret", () => {
    const fatal = prodPostureFatal({ BIND_ALL: "true", MEMORIA_ENCRYPTION_KEY: "x".repeat(64) });
    expect(fatal).toContain("MEMORIA_OAUTH_CLIENT_SECRET");
  });

  it("refuses prod posture without a pinned encryption key", () => {
    const fatal = prodPostureFatal({ BIND_ALL: "true", MEMORIA_OAUTH_CLIENT_SECRET: "s" });
    expect(fatal).toContain("MEMORIA_ENCRYPTION_KEY");
  });

  it("refuses prod posture without a pinned public URL", () => {
    const fatal = prodPostureFatal({
      BIND_ALL: "true",
      MEMORIA_OAUTH_CLIENT_SECRET: "s",
      MEMORIA_ENCRYPTION_KEY: "x".repeat(64),
    });
    expect(fatal).toContain("MEMORIA_PUBLIC_URL");
  });

  it("boots prod posture when both secrets and the public URL are pinned", () => {
    expect(
      prodPostureFatal({
        BIND_ALL: "true",
        MEMORIA_OAUTH_CLIENT_SECRET: "s",
        MEMORIA_ENCRYPTION_KEY: "x".repeat(64),
        MEMORIA_PUBLIC_URL: "https://memoria.example.run.app",
      })
    ).toBeNull();
  });

  it("localhost posture keeps warn-and-continue (no fatal)", () => {
    expect(prodPostureFatal({})).toBeNull();
  });

  it("the explicit escape hatch disables the gate", () => {
    expect(
      prodPostureFatal({ BIND_ALL: "true", MEMORIA_INSECURE_ALLOW_FALLBACKS: "true" })
    ).toBeNull();
  });
});

describe("dashboard httpOnly cookie session (C6)", () => {
  it("rejects a wrong key at /dashboard/login -> 401, no cookie", async () => {
    const r = await request(app).post("/dashboard/login").send({ key: "wrong" });
    expect(r.status).toBe(401);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });

  it("exchanges the API key for an httpOnly SameSite=Strict cookie scoped to /dashboard", async () => {
    const r = await request(app).post("/dashboard/login").send({ key: KEY });
    expect(r.status).toBe(200);
    const cookie = (r.headers["set-cookie"] || [])[0] || "";
    expect(cookie).toContain("memoria_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/dashboard");
  });

  it("the session cookie authorizes /dashboard/api without a bearer token", async () => {
    const login = await request(app).post("/dashboard/login").send({ key: KEY });
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const r = await request(app).get("/dashboard/api/stats").set("Cookie", cookie);
    expect(r.status).toBe(200);
  });

  it("the dashboard session cookie does NOT authorize /mcp or /ingest (scope confinement)", async () => {
    // A leaked dashboard cookie must not grant MCP tool access. The cookie
    // fallback is honored only on the /dashboard subtree; /mcp and /ingest
    // require a real Bearer token.
    const login = await request(app).post("/dashboard/login").send({ key: KEY });
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const ingest = await request(app)
      .post("/ingest")
      .set("Cookie", cookie)
      .send({ events: [{ id: "a", source: "s", content: "c" }] });
    expect(ingest.status).toBe(401);
    const mcp = await request(app)
      .post("/mcp")
      .set("Cookie", cookie)
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });
    expect(mcp.status).toBe(401);
  });

  it("a bogus session cookie is still 401", async () => {
    const r = await request(app)
      .get("/dashboard/api/stats")
      .set("Cookie", "memoria_session=not-a-real-session");
    expect(r.status).toBe(401);
  });

  it("trims surrounding whitespace on the submitted key (terminal copy-paste)", async () => {
    // The secret is stored without a trailing newline, so terminal copies
    // routinely pick up a stray newline/space. Login must tolerate that.
    const r = await request(app).post("/dashboard/login").send({ key: `  ${KEY}\n` });
    expect(r.status).toBe(200);
    expect((r.headers["set-cookie"] || [])[0] || "").toContain("memoria_session=");
  });

  it("does NOT accept a key with non-whitespace text glued on (only trims)", async () => {
    const r = await request(app)
      .post("/dashboard/login")
      .send({ key: `${KEY}alex@cloudshell:~$` });
    expect(r.status).toBe(401);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });
});

describe("pinned public URL (C7)", () => {
  it("derives issuer from headers only when MEMORIA_PUBLIC_URL is unset (test env)", async () => {
    // In this suite MEMORIA_PUBLIC_URL is unset, so the metadata reflects the
    // request host — the localhost/dev fallback. The pinning behavior itself
    // is a one-line guard (PUBLIC_URL short-circuit) exercised in prod config.
    const r = await request(app)
      .get("/.well-known/oauth-authorization-server")
      .set("Host", "example.test");
    expect(r.status).toBe(200);
    expect(r.body.issuer).toContain("example.test");
  });
});
