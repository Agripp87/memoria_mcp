import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// resolveMemoryPath reads MEMORIA_DIR at module-load time, so point it at an
// isolated temp dir BEFORE importing tools.js. This exercises the REAL
// validator (not a duplicated regex copy), including the symlink-leaf defense.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-pathsafety-"));
process.env.MEMORIA_DIR = ROOT;

let resolveMemoryPath: (file: string) => string;
let isValidMemoryFilename: (file: string) => boolean;
let MEMORIES_DIR: string;

beforeAll(async () => {
  fs.mkdirSync(path.join(ROOT, "memories", "project"), { recursive: true });
  const mod = await import("../tools.js");
  resolveMemoryPath = mod.resolveMemoryPath;
  isValidMemoryFilename = mod.isValidMemoryFilename;
  MEMORIES_DIR = mod.MEMORIES_DIR;
});

afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

/** Try to create a symlink; return false if the platform forbids it (e.g.
 *  Windows without Developer Mode) so the test skips rather than flakes. */
function trySymlink(target: string, linkPath: string): boolean {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch {
    return false;
  }
}

describe("resolveMemoryPath (real validator)", () => {
  it("resolves a normal in-tree path inside memories/", () => {
    const p = resolveMemoryPath("project/notes.md");
    expect(p).toBe(path.join(MEMORIES_DIR, "project", "notes.md"));
  });

  it("allows a regular existing leaf file", () => {
    const rel = "project/regular.md";
    fs.writeFileSync(path.join(MEMORIES_DIR, rel), "# hi");
    expect(() => resolveMemoryPath(rel)).not.toThrow();
  });

  it("rejects ../ path traversal", () => {
    expect(() => resolveMemoryPath("../escape.md")).toThrow(/traversal/i);
    expect(() => resolveMemoryPath("../../etc/passwd")).toThrow(/traversal/i);
    expect(() => resolveMemoryPath("project/../../escape.md")).toThrow(/traversal/i);
  });

  it("rejects absolute paths that escape memories/", () => {
    const outside = process.platform === "win32" ? "C:/Windows/win.ini" : "/etc/passwd";
    expect(() => resolveMemoryPath(outside)).toThrow(/traversal/i);
  });

  it("rejects a symlinked leaf pointing outside memories/ (the leaf-gap fix)", () => {
    const secret = path.join(ROOT, "secret.txt");
    fs.writeFileSync(secret, "TOP SECRET CONTENTS");
    const link = path.join(MEMORIES_DIR, "leak.md");
    if (!trySymlink(secret, link)) return; // platform can't symlink — skip
    try {
      expect(() => resolveMemoryPath("leak.md")).toThrow(/symlink/i);
    } finally {
      try { fs.unlinkSync(link); } catch {}
    }
  });

  it("rejects a dangling symlinked leaf (would otherwise materialize off-tree on write)", () => {
    const danglingTarget = path.join(ROOT, "does-not-exist.txt");
    const link = path.join(MEMORIES_DIR, "dangling.md");
    if (!trySymlink(danglingTarget, link)) return; // platform can't symlink — skip
    try {
      expect(() => resolveMemoryPath("dangling.md")).toThrow(/symlink/i);
    } finally {
      try { fs.unlinkSync(link); } catch {}
    }
  });
});

describe("isValidMemoryFilename (real validator — shape only)", () => {
  it("accepts well-formed memory paths", () => {
    expect(isValidMemoryFilename("project/notes.md")).toBe(true);
    expect(isValidMemoryFilename("daily/2026-06-03.md")).toBe(true);
    expect(isValidMemoryFilename("simple.md")).toBe(true);
  });

  it("rejects wrong extensions, spaces, and shell metacharacters", () => {
    expect(isValidMemoryFilename("notes.txt")).toBe(false);
    expect(isValidMemoryFilename("file with spaces.md")).toBe(false);
    expect(isValidMemoryFilename("file;rm -rf.md")).toBe(false);
    expect(isValidMemoryFilename("C:\\Windows\\file.md")).toBe(false);
    expect(isValidMemoryFilename("")).toBe(false);
  });

  it("rejects traversal/normalization tricks at the input layer (defense in depth)", () => {
    expect(isValidMemoryFilename("../../etc/passwd.md")).toBe(false); // .. segment
    expect(isValidMemoryFilename("a/./b.md")).toBe(false); // . segment
    expect(isValidMemoryFilename("a//b.md")).toBe(false); // empty segment
    expect(isValidMemoryFilename("/etc/passwd.md")).toBe(false); // absolute
    // resolveMemoryPath is still the authoritative containment guard:
    expect(() => resolveMemoryPath("../../etc/passwd.md")).toThrow(/traversal/i);
  });
});
