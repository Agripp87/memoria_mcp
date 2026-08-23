/**
 * Phase 2 (critical-review remediation): labeled relevance fixture.
 *
 * A small ground-truth set of query → expected-memory pairs over a seeded
 * store, modelled on a real single-user store (projects,
 * decisions, debugging principles, orchestrator ops). Ranking changes must
 * keep this passing — it is the guard against invisible retrieval regressions.
 *
 * Runs on the hash (lexical) provider, i.e. exactly what the hosted service
 * ran until Phase 2 — so expectations are calibrated to lexical matching, with
 * distractors that share surface vocabulary.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { MemoryStore } from "../store.js";
import { chunkMarkdown } from "../chunker.js";

let root: string;
let store: MemoryStore;

interface Doc {
  file: string;
  importance: number;
  updated: string;
  body: string;
}

// A miniature but realistic store: core pages + noisy daily logs.
const DOCS: Doc[] = [
  {
    file: "user/profile.md", importance: 9, updated: "2026-06-20",
    body: "The user is Alex. They build the Talk & Play toddler speech app and the Memoria memory system. Prefers terse, evidence-first answers.",
  },
  {
    file: "project/talk-and-play.md", importance: 8, updated: "2026-06-01",
    body: "Talk & Play is a React Native app helping toddlers learn to speak. Offline-first is a hard requirement. Uses on-device speech models.",
  },
  {
    file: "decisions/gcp-cloud-run.md", importance: 7, updated: "2026-05-20",
    body: "Decision: deploy Memoria on GCP Cloud Run with a GCS FUSE volume for durable persistence. max-instances 1 because SQLite WAL corrupts with concurrent writers on FUSE.",
  },
  {
    file: "feedback/core_debugging_principles.md", importance: 9, updated: "2026-05-10",
    body: "Debugging principle: ask for evidence before proposing fixes. Request screenshots or logs. Never assume the cause from the symptom description alone.",
  },
  {
    file: "decisions/embeddings-provider.md", importance: 6, updated: "2026-06-10",
    body: "Decision: embedding provider order is OpenAI text-embedding-3-small, then local MiniLM all-MiniLM-L6-v2, then n-gram hash fallback for search.",
  },
  {
    file: "references/orchestrator-ops.md", importance: 5, updated: "2026-04-15",
    body: "The Orchestrator runs 13 agents on a GCE VM. Agent results flow to Memoria via the /ingest endpoint with a bearer key. Marketing-agent runs hourly.",
  },
  // Old, LOW-importance but on-topic memory — the archival long-tail case (B3):
  // must remain retrievable even though it is neither recent nor important.
  {
    file: "references/ngrok-tunnel-setup.md", importance: 2, updated: "2026-03-27",
    body: "To expose the local MCP server to claude.ai use an ngrok tunnel: start-tunnel.sh runs ngrok http 3100 and prints the public forwarding URL for the connector.",
  },
  // Distractors: daily-log noise sharing vocabulary with the queries.
  {
    file: "daily/2026-06-04.md", importance: 5, updated: "2026-06-04",
    body: "## 09:00 — orchestrator\n\nmarketing-agent: success. research-agent: success. Deployed new revision to cloud run. Agent results recorded.\n\n*importance: 4 | privacy: send*",
  },
  {
    file: "daily/2026-06-05.md", importance: 5, updated: "2026-06-05",
    body: "## 10:00 — calendar\n\nDentist appointment tomorrow. Toddler speech therapy session moved to Friday.\n\n*importance: 5 | privacy: send*",
  },
];

// query → file that must appear in the top-K results.
const FIXTURE: Array<{ query: string; expect: string; k: number }> = [
  { query: "who is the user and what does he prefer", expect: "user/profile.md", k: 3 },
  { query: "toddler speech app offline requirement", expect: "project/talk-and-play.md", k: 3 },
  { query: "why is cloud run limited to a single instance", expect: "decisions/gcp-cloud-run.md", k: 3 },
  { query: "how should I debug — what to ask for first", expect: "feedback/core_debugging_principles.md", k: 3 },
  { query: "which embedding model is used for search", expect: "decisions/embeddings-provider.md", k: 3 },
  { query: "how do agent results reach memoria", expect: "references/orchestrator-ops.md", k: 3 },
  // The B3 acceptance case: old + importance 2, must still surface.
  { query: "ngrok tunnel public url for the connector", expect: "references/ngrok-tunnel-setup.md", k: 3 },
];

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-relfix-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  store = new MemoryStore(path.join(root, "data", "rel.sqlite"));
  for (const doc of DOCS) {
    const content = `---\nname: ${path.basename(doc.file, ".md")}\nimportance: ${doc.importance}\nupdated: ${doc.updated}\n---\n\n${doc.body}\n`;
    const chunks = chunkMarkdown(content, doc.file);
    await store.indexChunks(chunks, doc.importance, content);
  }
});

afterAll(() => {
  try { store?.close(); } catch {}
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
});

describe("relevance fixture (ground truth for ranking changes)", () => {
  for (const { query, expect: expected, k } of FIXTURE) {
    it(`"${query}" surfaces ${expected} in top ${k}`, async () => {
      const results = await store.search(query, k);
      const files = results.map((r) => r.file);
      expect(files).toContain(expected);
    });
  }

  it("reports scan coverage so recall loss is visible, not silent", async () => {
    const results = await store.search("anything at all", 3);
    // Phase 2 adds scannedChunks/totalChunks to results; on a small store they
    // must be equal (full coverage) and actually present.
    expect(results.length).toBeGreaterThan(0);
    expect(typeof results[0].scannedChunks).toBe("number");
    expect(typeof results[0].totalChunks).toBe("number");
    expect(results[0].scannedChunks).toBe(results[0].totalChunks);
    expect(results[0].totalChunks).toBeGreaterThan(0);
  });
});
