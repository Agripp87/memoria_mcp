/**
 * Splits markdown files into overlapping chunks for vector indexing.
 * Target: ~400 tokens per chunk, ~80 token overlap.
 * Approximation: 1 token ≈ 4 characters.
 */

import yaml from "js-yaml";

export interface Chunk {
  text: string;
  file: string;
  startLine: number;
  endLine: number;
}

const TARGET_CHARS = 1600; // ~400 tokens
const OVERLAP_CHARS = 320; // ~80 tokens

/**
 * Parse YAML frontmatter from a markdown file, returning metadata and body.
 * Uses js-yaml for proper YAML 1.2 parsing (handles quoted strings, escaped
 * colons, multi-line values, nested structures, etc.).
 */
export function parseFrontmatter(content: string): {
  metadata: Record<string, unknown>;
  body: string;
} {
  // Strip BOM and normalize line endings
  let normalized = content;
  if (normalized.charCodeAt(0) === 0xfeff) {
    normalized = normalized.slice(1);
  }
  normalized = normalized.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { metadata: {}, body: normalized };

  let metadata: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(match[1], { schema: yaml.CORE_SCHEMA });
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
      // Normalize Date objects (YAML auto-parses ISO dates) back to ISO strings.
      // The rest of the codebase treats date frontmatter values as strings.
      for (const [k, v] of Object.entries(metadata)) {
        if (v instanceof Date) {
          metadata[k] = v.toISOString().split("T")[0];
        } else if (Array.isArray(v)) {
          // Stringify Date entries inside arrays too
          metadata[k] = v.map((item) =>
            item instanceof Date ? item.toISOString().split("T")[0] : item
          );
        }
      }
    }
  } catch (err) {
    // Malformed YAML — log to stderr but don't break the file
    process.stderr.write(`Memoria: frontmatter parse error: ${(err as Error).message}\n`);
  }

  return { metadata, body: match[2] };
}

/**
 * Split markdown content into overlapping chunks.
 */
export function chunkMarkdown(content: string, filePath: string): Chunk[] {
  const { body } = parseFrontmatter(content);
  const lines = body.split("\n");
  const chunks: Chunk[] = [];

  let currentChunk = "";
  let chunkStartLine = 1;
  let lineNum = 0;

  // Count newlines in the frontmatter region (not split-segments). Using
  // .split("\n").length over-counts by 1 for any string with content after
  // the last newline, which made search results report off-by-one line
  // numbers in indexes.
  const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  const frontmatterLines = frontmatterMatch
    ? (frontmatterMatch[0].match(/\n/g) || []).length
    : 0;

  for (const line of lines) {
    lineNum++;
    currentChunk += (currentChunk ? "\n" : "") + line;

    if (currentChunk.length >= TARGET_CHARS) {
      chunks.push({
        text: currentChunk.trim(),
        file: filePath,
        startLine: chunkStartLine + frontmatterLines,
        endLine: lineNum + frontmatterLines,
      });

      // Overlap: keep the last OVERLAP_CHARS worth of text
      const overlapText = currentChunk.slice(-OVERLAP_CHARS);
      const overlapLines = overlapText.split("\n").length;
      currentChunk = overlapText;
      chunkStartLine = lineNum - overlapLines + 1;
    }
  }

  // Final chunk
  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      file: filePath,
      startLine: chunkStartLine + frontmatterLines,
      endLine: lineNum + frontmatterLines,
    });
  }

  return chunks;
}
