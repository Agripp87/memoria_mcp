import { describe, it, expect } from "vitest";
import { parseFrontmatter, chunkMarkdown } from "../chunker.js";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter with string, number, and array values", () => {
    const content = `---
name: Test Memory
importance: 8
tags: [alpha, beta, gamma]
---

Body content here.`;

    const { metadata, body } = parseFrontmatter(content);
    expect(metadata.name).toBe("Test Memory");
    expect(metadata.importance).toBe(8);
    expect(metadata.tags).toEqual(["alpha", "beta", "gamma"]);
    expect(body.trim()).toBe("Body content here.");
  });

  it("returns empty metadata when no frontmatter present", () => {
    const content = "Just some plain text without frontmatter.";
    const { metadata, body } = parseFrontmatter(content);
    expect(metadata).toEqual({});
    expect(body).toBe(content);
  });

  it("strips BOM character", () => {
    const content = "\uFEFF---\nname: BOM test\n---\nContent";
    const { metadata } = parseFrontmatter(content);
    expect(metadata.name).toBe("BOM test");
  });

  it("normalizes CRLF line endings", () => {
    const content = "---\r\nname: CRLF\r\n---\r\nBody";
    const { metadata, body } = parseFrontmatter(content);
    expect(metadata.name).toBe("CRLF");
    expect(body).toBe("Body");
  });

  it("parses float numbers", () => {
    const content = "---\nscore: 7.5\n---\nBody";
    const { metadata } = parseFrontmatter(content);
    expect(metadata.score).toBe(7.5);
  });

  it("handles content with only frontmatter (empty body)", () => {
    const content = "---\nname: Empty\n---\n";
    const { metadata, body } = parseFrontmatter(content);
    expect(metadata.name).toBe("Empty");
    expect(body.trim()).toBe("");
  });

  it("handles colons in quoted values (proper YAML)", () => {
    const content = `---\ndescription: "Key: value pair inside"\n---\nBody`;
    const { metadata } = parseFrontmatter(content);
    expect(metadata.description).toBe("Key: value pair inside");
  });

  it("handles tags with special characters when quoted", () => {
    const content = `---\ntags: ["a, b", "c:d", "normal"]\n---\nBody`;
    const { metadata } = parseFrontmatter(content);
    expect(metadata.tags).toEqual(["a, b", "c:d", "normal"]);
  });

  it("preserves multi-line strings", () => {
    const content = `---\ndescription: |\n  line one\n  line two\n---\nBody`;
    const { metadata } = parseFrontmatter(content);
    expect(metadata.description).toBe("line one\nline two\n");
  });

  it("returns empty metadata for malformed YAML (does not throw)", () => {
    const content = `---\nname: [unclosed array\nimportance: 5\n---\nBody`;
    const { metadata, body } = parseFrontmatter(content);
    // js-yaml throws on this, we catch and return empty metadata
    expect(metadata).toEqual({});
    expect(body).toBe("Body");
  });

  it("normalizes Date objects (from auto-parsed ISO dates) to ISO strings", () => {
    const content = `---\ncreated: 2026-04-19\nupdated: 2026-04-20\n---\nBody`;
    const { metadata } = parseFrontmatter(content);
    expect(typeof metadata.created).toBe("string");
    expect(metadata.created).toBe("2026-04-19");
    expect(metadata.updated).toBe("2026-04-20");
  });

  it("normalizes dates inside arrays", () => {
    const content = `---\nmilestones: [2026-01-01, 2026-12-31]\n---\nBody`;
    const { metadata } = parseFrontmatter(content);
    expect(Array.isArray(metadata.milestones)).toBe(true);
    expect((metadata.milestones as string[]).every((d) => typeof d === "string")).toBe(true);
  });
});

describe("chunkMarkdown", () => {
  it("returns empty array for empty content", () => {
    const chunks = chunkMarkdown("", "test.md");
    expect(chunks).toEqual([]);
  });

  it("returns single chunk for small content", () => {
    const content = "---\nname: Small\n---\n\nA short memory.";
    const chunks = chunkMarkdown(content, "test.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].file).toBe("test.md");
    expect(chunks[0].text).toContain("short memory");
  });

  it("produces multiple chunks for large content", () => {
    const longParagraph = "Lorem ipsum dolor sit amet. ".repeat(200);
    const content = `---\nname: Large\n---\n\n${longParagraph}`;
    const chunks = chunkMarkdown(content, "big.md");
    expect(chunks.length).toBeGreaterThan(1);

    // Verify chunks have correct file reference
    for (const chunk of chunks) {
      expect(chunk.file).toBe("big.md");
      expect(chunk.startLine).toBeLessThanOrEqual(chunk.endLine);
    }
  });

  it("preserves correct line number offsets accounting for frontmatter", () => {
    const content = "---\nname: Lines\ntype: test\n---\n\nLine one.\nLine two.\nLine three.";
    const chunks = chunkMarkdown(content, "lines.md");
    expect(chunks).toHaveLength(1);
    // Frontmatter is 4 lines (---, name, type, ---), so body starts at line 5
    expect(chunks[0].startLine).toBeGreaterThanOrEqual(5);
  });
});
