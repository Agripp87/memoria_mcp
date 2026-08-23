/**
 * Pure wiki-rendering helpers for the dashboard's wiki view. No filesystem or
 * tools.ts dependency, so they unit-test in isolation. dashboard.ts owns the
 * store scan (scanStore) and the HTTP routes.
 */
import MarkdownIt from "markdown-it";

/** Server-side HTML escape (for names spliced into wiki-link anchors). */
export function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Extract `[[wiki link]]` tokens from raw markdown (best-effort, used for the
 *  backlink graph — not for rendering). */
export function extractWikiLinks(text: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1].trim());
  return out;
}

/** Normalize a frontmatter `related` value (array | string | undefined). */
export function normalizeRelated(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

export interface StoreEntry {
  file: string; // forward-slash relative path
  name: string;
  type: string;
  importance: number;
  related: string[];
  wikilinks: string[];
}

/** Resolve a `[[token]]` (a name, relpath, or basename) to a store file, or null. */
export function resolveLink(token: string, store: StoreEntry[]): string | null {
  const t = token.trim().toLowerCase();
  const norm = (s: string) => s.toLowerCase();
  const base = (f: string) => f.replace(/\.md$/i, "").split("/").pop() || f;
  const byFile = store.find((e) => norm(e.file) === t);
  if (byFile) return byFile.file;
  const byName = store.find((e) => norm(e.name) === t);
  if (byName) return byName.file;
  const byBase = store.find((e) => norm(base(e.file)) === t);
  return byBase ? byBase.file : null;
}

// ── markdown-it with a code-safe [[wikilink]] inline rule ────
//
// html:false escapes any raw HTML in a memory body (no stored-XSS passthrough);
// markdown-it's default validateLink blocks javascript:/vbscript:/file: URLs.
// So renderMemoryHtml() output is safe to inject via innerHTML.
//
// `[[links]]` are handled as a markdown-it INLINE RULE rather than a pre-pass
// regex. markdown-it never runs inline rules inside code spans or fenced code
// blocks, so this can't corrupt `[[...]]` that appears literally in code (the
// old pre-pass regex did). The per-request store is threaded through the render
// `env` so the renderer rule can resolve names → files.

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Inline rule: consume `[[name]]` and emit a self-contained `wikilink` token.
md.inline.ruler.before("link", "wikilink", (state, silent) => {
  // Two guards keep `[[x]]` from corrupting markdown links like `[a [[x]] b](url)`:
  //   1. `silent` — link parsing scans the label with skipToken() in silent mode
  //      to find the closing `]`. If we consumed `[[x]]` there, the bracket count
  //      would break and the link would fail to form. Skipping silent calls lets
  //      markdown-it count the brackets and build the link normally.
  //   2. `linkLevel > 0` — when the label is then tokenized for real, we're inside
  //      a link (no nested anchors allowed), so leave `[[x]]` as literal text.
  // `linkLevel` is a real StateInline runtime field absent from markdown-it's types.
  if (silent) return false;
  if ((state as unknown as { linkLevel: number }).linkLevel > 0) return false;
  const start = state.pos;
  const src = state.src;
  if (src.charCodeAt(start) !== 0x5b /* [ */ || src.charCodeAt(start + 1) !== 0x5b) {
    return false;
  }
  const end = src.indexOf("]]", start + 2);
  if (end < 0) return false;
  const name = src.slice(start + 2, end).trim();
  if (!name) return false;
  if (!silent) {
    const token = state.push("wikilink", "", 0);
    token.meta = { name };
  }
  state.pos = end + 2;
  return true;
});

// Renderer: resolve the raw name against env.store and emit a safe anchor.
md.renderer.rules.wikilink = (tokens, idx, _opts, env: any) => {
  const name: string = tokens[idx].meta?.name ?? "";
  const store: StoreEntry[] = (env && env.store) || [];
  const target = resolveLink(name, store);
  if (target) {
    return `<a href="#" class="wikilink" data-wikilink-file="${escHtml(target)}">${escHtml(name)}</a>`;
  }
  return `<span class="wikilink-missing" title="No matching memory">${escHtml(name)}</span>`;
};

/**
 * Render a memory body to safe HTML, turning `[[links]]` into in-wiki anchors.
 * Resolved links navigate; unresolved ones render as a muted "missing" span.
 * `[[...]]` inside code spans/fences is left untouched (rendered literally).
 */
export function renderMemoryHtml(body: string, store: StoreEntry[]): string {
  return md.render(body, { store });
}
