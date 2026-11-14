import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

// scripts/release-notes.mjs writes the GitHub Release page from CHANGELOG.md
// (.github/workflows/github-release.yml). A wrong section, a blank page or a
// broken relative link would ship on every release, so it is tested against
// the real CHANGELOG as well as fixtures.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = path.join(ROOT, "scripts", "release-notes.mjs");
const REPO = "https://github.com/o/r";

type Mod = {
  changelogSection(c: string, v: string): string;
  unwrap(m: string): string;
  absolutizeLinks(m: string, repoUrl: string, ref: string): string;
  releaseNotes(o: {
    changelog: string;
    version: string;
    pkgName: string;
    repoUrl: string;
    published: boolean;
  }): string;
};
const load = async (): Promise<Mod> => (await import(pathToFileURL(SCRIPT).href)) as Mod;

const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "## [1.2.0] — 2026-01-02",
  "",
  "Intro that is",
  "wrapped twice.",
  "",
  "### Fixed",
  "",
  "- **One** item that",
  "  wraps, see [the docs](docs/a.md#x).",
  "- Two, [external](https://example.com) and [anchor](#here).",
  "",
  "```",
  "keep",
  "these lines",
  "```",
  "",
  "## [1.1.0] — 2026-01-01",
  "",
  "Old.",
  "",
  "[1.2.0]: https://github.com/o/r/compare/v1.1.0...v1.2.0",
].join("\n");

describe("release notes from CHANGELOG.md", () => {
  it("takes exactly one version's section", async () => {
    const { changelogSection } = await load();
    const s = changelogSection(CHANGELOG, "1.2.0");
    expect(s.startsWith("Intro that is")).toBe(true);
    expect(s).not.toContain("Old.");
    expect(changelogSection(CHANGELOG, "1.1.0")).toBe("Old.");
    expect(changelogSection(CHANGELOG, "1.0.0")).toBe("");
    // Unreleased is not a version and has no body here.
    expect(changelogSection(CHANGELOG, "1.2")).toBe("");
  });

  it("joins wrapped lines, keeps list items and code fences apart", async () => {
    const { unwrap } = await load();
    const out = unwrap("a\nb\n\n- one\n  two\n- three\n\n```\nx\ny\n```\nafter");
    expect(out).toBe("a b\n\n- one two\n- three\n\n```\nx\ny\n```\nafter");
  });

  it("makes relative links absolute at the tag and leaves others alone", async () => {
    const { absolutizeLinks } = await load();
    expect(absolutizeLinks("[d](docs/a.md#x) [e](https://e.com) [h](#h)", REPO, "v1")).toBe(
      `[d](${REPO}/blob/v1/docs/a.md#x) [e](https://e.com) [h](#h)`,
    );
  });

  it("puts the install line on a published page and a draft note otherwise", async () => {
    const { releaseNotes } = await load();
    const base = { changelog: CHANGELOG, version: "1.2.0", pkgName: "@s/p", repoUrl: REPO };
    const pub = releaseNotes({ ...base, published: true });
    expect(pub).toContain("`npm install -g @s/p@1.2.0`");
    expect(pub).toContain("## Fixed");
    expect(pub).toContain(
      "- **One** item that wraps, see [the docs](https://github.com/o/r/blob/v1.2.0/docs/a.md#x).",
    );
    expect(pub).toContain("```\nkeep\nthese lines\n```");
    expect(pub.trimEnd().endsWith(`(${REPO}/blob/v1.2.0/CHANGELOG.md).`)).toBe(true);
    const draft = releaseNotes({ ...base, published: false });
    expect(draft).toMatch(/^\*\*Draft: @s\/p@1\.2\.0 is staged on npm/);
    expect(draft).not.toContain("npm install");
    expect(releaseNotes({ ...base, version: "9.9.9", published: true })).toBe("");
  });

  it("has a section for the version in package.json, and refuses a missing one", () => {
    const version = JSON.parse(
      fs.readFileSync(path.join(ROOT, "mcp-server", "package.json"), "utf-8"),
    ).version as string;
    const out = execFileSync(process.execPath, [SCRIPT, version, "--published"], {
      encoding: "utf-8",
    });
    expect(out).toContain(`@${version}`);
    expect(out.split("\n").length).toBeGreaterThan(5);
    expect(() => execFileSync(process.execPath, [SCRIPT, "0.0.0"], { stdio: "pipe" })).toThrow();
  });
});
