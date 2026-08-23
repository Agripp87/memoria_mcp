import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Force the deterministic n-gram provider in tests so the suite never
    // downloads or loads the MiniLM model. setup.ts must run before any module
    // imports embeddings.ts.
    setupFiles: ["./src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/**/*.d.ts"],
      // Floors set a few points below current coverage so a real regression
      // FAILS CI (the suite was previously green through two prod outages on
      // uncovered code) without small v8 line-counting wobble false-failing.
      // Ratchet these up as coverage grows; never lower them.
      // 2026-07 (Phase 4): global raised 33 -> 50 and per-file floors added for
      // every high-risk module after tools.test.ts + the phase 1-3 suites
      // lifted overall lines 37% -> ~55% (tools.ts 9% -> 56%).
      thresholds: {
        lines: 50,
        statements: 50,
        functions: 58,
        branches: 65,
        // Per-file floors, buffered ~4-5pts below measured coverage.
        "src/http.ts": { lines: 52, statements: 52 },
        "src/dashboard.ts": { lines: 40, statements: 40 },
        "src/wiki.ts": { lines: 95, statements: 95 },
        "src/tools.ts": { lines: 50, statements: 50 },
        "src/embeddings.ts": { lines: 44, statements: 44 },
        "src/store.ts": { lines: 88, statements: 88 },
        "src/entities.ts": { lines: 90, statements: 90 },
        "src/lint.ts": { lines: 75, statements: 75 },
        "src/collector/ingestion.ts": { lines: 85, statements: 85 },
        "src/collector/buffer.ts": { lines: 74, statements: 74 },
        "src/collector/daemon.ts": { lines: 35, statements: 35 },
        "src/collector/provenance.ts": { lines: 80, statements: 80 },
      },
    },
  },
});
