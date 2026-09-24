import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { createOrAppend, writeFileAtomic } from "../atomic-fs.js";
import { bumpFileImportance } from "../collector/ingestion.js";

// 2026-09 review, M1: writes that a crash, a full disk or a concurrent writer
// could leave truncated or lost.

let DIR: string;

beforeEach(() => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-atomic-"));
});

afterEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

const leftovers = () => fs.readdirSync(DIR).filter((f) => f.endsWith(".tmp"));

describe("writeFileAtomic", () => {
  it("creates and replaces a file, leaving no temp file behind", () => {
    const f = path.join(DIR, "a.md");
    expect(writeFileAtomic(f, "one")).toBe(true);
    expect(writeFileAtomic(f, "two")).toBe(true);
    expect(fs.readFileSync(f, "utf-8")).toBe("two");
    expect(leftovers()).toEqual([]);
  });

  it("leaves the old content intact when the write itself fails", () => {
    const f = path.join(DIR, "a.md");
    fs.writeFileSync(f, "original");
    // A value fs cannot write stands in for a crash or a full disk mid-write.
    expect(() => writeFileAtomic(f, Symbol("boom") as unknown as string)).toThrow();
    expect(fs.readFileSync(f, "utf-8")).toBe("original");
    expect(leftovers()).toEqual([]);
  });

  it("abandons the write when the precondition fails", () => {
    const f = path.join(DIR, "a.md");
    fs.writeFileSync(f, "original");
    expect(writeFileAtomic(f, "new", { precondition: () => false })).toBe(false);
    expect(fs.readFileSync(f, "utf-8")).toBe("original");
    expect(leftovers()).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "keeps an existing file's mode, applies an explicit one",
    () => {
      const kept = path.join(DIR, "kept");
      fs.writeFileSync(kept, "x", { mode: 0o640 });
      fs.chmodSync(kept, 0o640);
      writeFileAtomic(kept, "y");
      expect(fs.statSync(kept).mode & 0o777).toBe(0o640);

      const secret = path.join(DIR, "secret");
      writeFileAtomic(secret, "y", { mode: 0o600 });
      expect(fs.statSync(secret).mode & 0o777).toBe(0o600);
    },
  );
});

describe("createOrAppend", () => {
  it("creates with the initial content, then appends", () => {
    const f = path.join(DIR, "log.md");
    expect(createOrAppend(f, "HEADER\nfirst", "\nsecond")).toBe("created");
    expect(createOrAppend(f, "HEADER\nignored", "\nthird")).toBe("appended");
    expect(fs.readFileSync(f, "utf-8")).toBe("HEADER\nfirst\nthird");
  });

  it("never truncates: a writer that also saw the file missing appends instead", () => {
    // The old pattern was `existsSync ? append : writeFileSync(header+entry)`.
    // When two writers both saw "missing", the second writeFileSync wiped the
    // first writer's entry. createOrAppend's exclusive create turns the second
    // into an append.
    const f = path.join(DIR, "log.md");
    createOrAppend(f, "HEADER\nfrom writer A", "\nfrom writer A");
    createOrAppend(f, "HEADER\nfrom writer B", "\nfrom writer B");
    const text = fs.readFileSync(f, "utf-8");
    expect(text).toContain("from writer A");
    expect(text).toContain("from writer B");
    expect(text.match(/HEADER/g)).toHaveLength(1);
  });
});

describe("bumpFileImportance", () => {
  const log = (importance: number) =>
    `---\nname: Daily log\nimportance: ${importance}\ntags: [daily]\n---\n\n# Log\n\n## 10:00 UTC — a\n\nentry\n`;

  it("raises a same-width value in place, leaving every other byte alone", () => {
    const f = path.join(DIR, "d.md");
    fs.writeFileSync(f, log(5));
    bumpFileImportance(f, 8);
    expect(fs.readFileSync(f, "utf-8")).toBe(log(8));
  });

  it("handles a width change (9 -> 10) by an atomic replace", () => {
    const f = path.join(DIR, "d.md");
    fs.writeFileSync(f, log(9));
    bumpFileImportance(f, 10);
    expect(fs.readFileSync(f, "utf-8")).toBe(log(10));
    expect(leftovers()).toEqual([]);
  });

  it("never lowers the value, and ignores files without frontmatter importance", () => {
    const f = path.join(DIR, "d.md");
    fs.writeFileSync(f, log(9));
    bumpFileImportance(f, 7);
    expect(fs.readFileSync(f, "utf-8")).toBe(log(9));

    const plain = path.join(DIR, "plain.md");
    fs.writeFileSync(plain, "# no frontmatter\n");
    bumpFileImportance(plain, 9);
    expect(fs.readFileSync(plain, "utf-8")).toBe("# no frontmatter\n");
  });
});

describe("on-disk master key (2026-09 review, M1/L6)", () => {
  const saved = {
    key: process.env.MEMORIA_ENCRYPTION_KEY,
    require: process.env.MEMORIA_REQUIRE_ENCRYPTION_KEY,
  };

  beforeEach(() => {
    delete process.env.MEMORIA_ENCRYPTION_KEY;
    delete process.env.MEMORIA_REQUIRE_ENCRYPTION_KEY;
    vi.resetModules(); // the key is cached per module instance
  });

  afterEach(() => {
    for (const [name, value] of [
      ["MEMORIA_ENCRYPTION_KEY", saved.key],
      ["MEMORIA_REQUIRE_ENCRYPTION_KEY", saved.require],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const freshCrypto = () => import("../collector/crypto.js");

  it("uses a key file another process already created instead of overwriting it", async () => {
    const theirs = "ab".repeat(32);
    fs.writeFileSync(path.join(DIR, "collector.key"), theirs + "\n");
    const { initMasterKey } = await freshCrypto();
    expect(initMasterKey(DIR).toString("hex")).toBe(theirs);
    expect(fs.readFileSync(path.join(DIR, "collector.key"), "utf-8").trim()).toBe(theirs);
  });

  it("generates a 32-byte key that a second process then reads back", async () => {
    const first = (await freshCrypto()).initMasterKey(DIR);
    vi.resetModules();
    const second = (await freshCrypto()).initMasterKey(DIR);
    expect(first).toHaveLength(32);
    expect(second.equals(first)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("creates the key file owner-only (0600)", async () => {
    (await freshCrypto()).initMasterKey(DIR);
    expect(fs.statSync(path.join(DIR, "collector.key")).mode & 0o777).toBe(0o600);
  });

  it("refuses a corrupt key file loudly instead of using a short key", async () => {
    // Buffer.from(hex, "hex") silently stops at the first non-hex character;
    // this used to become a 3-byte key and a baffling error at first decrypt.
    fs.writeFileSync(path.join(DIR, "collector.key"), "abcdefzz\n");
    const { initMasterKey } = await freshCrypto();
    expect(() => initMasterKey(DIR)).toThrow(/not a valid key/);
  });
});

describe("bumpFileImportance on unusual files (2026-09 re-review)", () => {
  it("writes the digit at the right byte after invalid UTF-8 earlier in the frontmatter", () => {
    // Offsets came from UTF-8-decoded text, where each invalid byte became a
    // 3-byte U+FFFD: the digit landed two bytes late per bad byte, over the
    // next key.
    const f = path.join(DIR, "latin1.md");
    const before = Buffer.concat([
      Buffer.from("---\nname: Caf"),
      Buffer.from([0xe9]), // Latin-1 é: not valid UTF-8
      Buffer.from("\nimportance: 5\ntags: [daily]\n---\n\nbody\n"),
    ]);
    fs.writeFileSync(f, before);
    bumpFileImportance(f, 8);
    const after = fs.readFileSync(f);
    expect(after.length).toBe(before.length);
    expect(after.toString("latin1")).toBe(
      before.toString("latin1").replace("importance: 5", "importance: 8"),
    );
  });

  it("keeps bytes intact on a width change too", () => {
    const f = path.join(DIR, "latin1-10.md");
    const before = Buffer.concat([
      Buffer.from("---\nname: Caf"),
      Buffer.from([0xe9]),
      Buffer.from("\nimportance: 9\n---\n"),
    ]);
    fs.writeFileSync(f, before);
    bumpFileImportance(f, 10);
    expect(fs.readFileSync(f).toString("latin1")).toBe(
      before.toString("latin1").replace("importance: 9", "importance: 10"),
    );
  });

  it("never edits an `importance:` line in the body when the frontmatter has none", () => {
    const f = path.join(DIR, "no-fm-importance.md");
    const text = "---\nname: Log\n---\n\nimportance: 5 in the body\n\n---\n";
    fs.writeFileSync(f, text);
    bumpFileImportance(f, 8);
    expect(fs.readFileSync(f, "utf-8")).toBe(text);
  });
});

describe("writeFileAtomic onto a directory (2026-09 re-review)", () => {
  it("fails at once, without the retry delay, and leaves no temp file", () => {
    const target = path.join(DIR, "a-directory");
    fs.mkdirSync(target);
    const t0 = Date.now();
    expect(() => writeFileAtomic(target, "x")).toThrow();
    expect(Date.now() - t0).toBeLessThan(500);
    expect(leftovers()).toEqual([]);
  });
});
