import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Memoria is described in six places a newcomer can land on: the two READMEs,
// npm, the Claude Code plugin and its marketplace entry, and the MCP Registry.
// They drifted apart once (four wordings, one of which did not name Claude),
// and each carries the version by hand. The root README's bold first line is
// the source; every other surface must open with it.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel: string): any => JSON.parse(read(rel));

const boldLine = (markdown: string): string => {
  const m = markdown.match(/^\*\*(.+)\*\*\r?$/m);
  if (!m) throw new Error("no bold one-line description found");
  return m[1];
};

const ONE_LINER = boldLine(read("README.md"));
const pkg = json("mcp-server/package.json");
const plugin = json(".claude-plugin/plugin.json");
const marketplace = json(".claude-plugin/marketplace.json");
const server = json("server.json");

describe("public descriptions", () => {
  it("the one-liner is a sentence short enough for the MCP Registry", () => {
    expect(ONE_LINER.endsWith(".")).toBe(true);
    expect(ONE_LINER.length).toBeLessThanOrEqual(100);
  });

  it.each([
    ["mcp-server/README.md", boldLine(read("mcp-server/README.md"))],
    ["mcp-server/package.json", pkg.description],
    [".claude-plugin/plugin.json", plugin.description],
    [".claude-plugin/marketplace.json", marketplace.description],
    [".claude-plugin/marketplace.json plugin entry", marketplace.plugins[0].description],
    ["server.json", server.description],
  ])("%s opens with the README one-liner", (_where, description) => {
    expect(description.startsWith(ONE_LINER)).toBe(true);
  });
});

describe("version strings", () => {
  it.each([
    [".claude-plugin/plugin.json", plugin.version],
    [".claude-plugin/marketplace.json", marketplace.plugins[0].version],
    ["server.json", server.version],
    ...server.packages.map((p: { version: string }, i: number) => [
      `server.json package ${i}`,
      p.version,
    ]),
    ["src/index.ts", read("mcp-server/src/index.ts").match(/version: "([^"]+)"/)?.[1]],
    ["src/http.ts", read("mcp-server/src/http.ts").match(/version: "([^"]+)"/)?.[1]],
  ])("%s matches package.json", (_where, version) => {
    expect(version).toBe(pkg.version);
  });
});
