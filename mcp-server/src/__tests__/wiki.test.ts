import { describe, it, expect } from "vitest";
import {
  escHtml,
  extractWikiLinks,
  normalizeRelated,
  resolveLink,
  renderMemoryHtml,
  type StoreEntry,
} from "../wiki.js";

const STORE: StoreEntry[] = [
  { file: "user/profile.md", name: "Profile", type: "user", importance: 9, related: [], wikilinks: [] },
  { file: "project/talk.md", name: "Talk & Play", type: "project", importance: 8, related: ["user/profile.md"], wikilinks: [] },
];

describe("escHtml", () => {
  it("escapes HTML-significant characters incl. quotes", () => {
    expect(escHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });
});

describe("extractWikiLinks", () => {
  it("pulls [[tokens]] from text", () => {
    expect(extractWikiLinks("see [[A]] and [[B C]] end")).toEqual(["A", "B C"]);
    expect(extractWikiLinks("none here")).toEqual([]);
  });
});

describe("normalizeRelated", () => {
  it("handles array / string / missing", () => {
    expect(normalizeRelated(["a", "b"])).toEqual(["a", "b"]);
    expect(normalizeRelated("x")).toEqual(["x"]);
    expect(normalizeRelated(undefined)).toEqual([]);
    expect(normalizeRelated(null)).toEqual([]);
  });
});

describe("resolveLink", () => {
  it("resolves by file, name, and basename (case-insensitive)", () => {
    expect(resolveLink("user/profile.md", STORE)).toBe("user/profile.md");
    expect(resolveLink("Profile", STORE)).toBe("user/profile.md");
    expect(resolveLink("profile", STORE)).toBe("user/profile.md");
    expect(resolveLink("talk & play", STORE)).toBe("project/talk.md");
  });
  it("returns null for unknown tokens", () => {
    expect(resolveLink("nope", STORE)).toBeNull();
  });
});

describe("renderMemoryHtml — sanitization (no stored XSS)", () => {
  it("escapes raw HTML instead of passing it through", () => {
    const html = renderMemoryHtml("<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>", STORE);
    // No raw HTML elements survive — everything becomes escaped text. (The
    // literal substring "onerror=" may appear, but only inside &lt;img...&gt;,
    // which is inert text, not an attribute.)
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not emit javascript: link/image URLs", () => {
    const html = renderMemoryHtml("[click](javascript:alert(1)) ![x](javascript:alert(2))", STORE);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/src="javascript:/i);
  });

  it("renders ordinary markdown", () => {
    const html = renderMemoryHtml("# Title\n\n**bold** and a [link](https://example.com)", STORE);
    expect(html).toMatch(/<h1>.*Title.*<\/h1>/);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.com"');
  });
});

describe("renderMemoryHtml — [[wikilinks]]", () => {
  it("turns a resolvable [[link]] into a navigable anchor", () => {
    const html = renderMemoryHtml("see [[Profile]] now", STORE);
    expect(html).toContain('class="wikilink"');
    expect(html).toContain('data-wikilink-file="user/profile.md"');
    expect(html).toContain(">Profile</a>");
  });

  it("renders an unresolvable [[link]] as a muted missing span", () => {
    const html = renderMemoryHtml("see [[Ghost Note]]", STORE);
    expect(html).toContain('class="wikilink-missing"');
    expect(html).toContain("Ghost Note");
  });

  it("escapes the link label (no markup injection via the token)", () => {
    const html = renderMemoryHtml("[[<img src=x onerror=alert(1)>]]", STORE);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;img");
  });

  it("does NOT linkify [[tokens]] inside an inline code span", () => {
    const html = renderMemoryHtml("use `[[Profile]]` as a literal", STORE);
    expect(html).not.toContain("data-wikilink-file");
    expect(html).toContain("[[Profile]]"); // rendered literally inside <code>
  });

  it("does NOT linkify [[tokens]] inside a fenced code block", () => {
    const html = renderMemoryHtml("```\nconst x = [[Profile]];\n```", STORE);
    expect(html).not.toContain("data-wikilink-file");
    expect(html).toContain("[[Profile]]");
  });

  it("does NOT corrupt a markdown link whose label contains [[...]]", () => {
    const html = renderMemoryHtml("[see [[Profile]] here](https://example.com)", STORE);
    // The markdown link renders intact; the inner [[Profile]] stays literal text
    // (no nested anchor) rather than being turned into a wikilink that breaks the
    // surrounding <a>. See the dual silent/linkLevel guards in wiki.ts.
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("see [[Profile]] here</a>");
    expect(html).not.toContain("data-wikilink-file"); // not turned into a wikilink
  });
});
