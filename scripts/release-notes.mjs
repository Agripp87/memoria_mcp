#!/usr/bin/env node
/**
 * Print the GitHub Release notes for one version, built from CHANGELOG.md.
 *
 *   node scripts/release-notes.mjs 0.3.1 [--published]
 *
 * The body is that version's CHANGELOG section with its "###" headings
 * raised to "##", wrapped lines joined, and relative links made absolute
 * (a release page has no repository-relative base), under a short header
 * and above a link to the full CHANGELOG. --published says the
 * version is installable from npm and puts the install line there; without
 * it the header is a note to the maintainer on the draft.
 *
 * Exits 1 when the section is missing or empty, so a tag without notes
 * fails the release workflow instead of publishing a blank page.
 *
 * Used by .github/workflows/github-release.yml.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The body of `## [version]` up to the next `## [` heading, or "". */
export function changelogSection(changelog, version) {
  const lines = changelog.replace(/\r\n/g, "\n").split("\n");
  const heading = `## [${version}]`;
  const start = lines.findIndex((l) => l === heading || l.startsWith(`${heading} `));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // The next version heading, or the link reference block at the end.
    if (lines[i].startsWith("## [") || /^\[[^\]]+\]: \S+$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

/**
 * Join hard-wrapped lines back into one line per paragraph or list item.
 * A release page renders each line break as a break, so the CHANGELOG's
 * 75-column wrapping would show up ragged. Code fences are left alone.
 */
export function unwrap(markdown) {
  const out = [];
  let inFence = false;
  const startsBlock = (t) => /^([-*+] |\d+[.)] |#|>|\||```|~~~)/.test(t);
  for (const line of markdown.split("\n")) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) inFence = !inFence;
    const prev = out.length ? out[out.length - 1] : "";
    const joinable =
      !inFence &&
      t !== "" &&
      !startsBlock(t) &&
      prev.trim() !== "" &&
      !/^(#|```|~~~|\|)/.test(prev.trim());
    if (joinable) out[out.length - 1] = `${prev} ${t}`;
    else out.push(line);
  }
  return out.join("\n");
}

/** Make `](relative)` links absolute against the repository at `ref`. */
export function absolutizeLinks(markdown, repoUrl, ref) {
  return markdown.replace(/\]\(([^)\s]+)\)/g, (match, target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return match;
    return `](${repoUrl}/blob/${ref}/${target.replace(/^\.\//, "")})`;
  });
}

export function releaseNotes({ changelog, version, pkgName, repoUrl, published }) {
  const section = changelogSection(changelog, version);
  if (!section) return "";
  const body = absolutizeLinks(
    unwrap(section.replace(/^### /gm, "## ")),
    repoUrl,
    `v${version}`,
  );
  const npmUrl = `https://www.npmjs.com/package/${pkgName}/v/${version}`;
  const header = published
    ? `**Install:** \`npm install -g ${pkgName}@${version}\`, or add it to Claude Code with ` +
      `\`claude mcp add memoria -s user -- npx -y ${pkgName}\`.\n\n` +
      `Published from GitHub Actions through staged, trusted publishing, with a signed ` +
      `[provenance attestation](${npmUrl}#provenance).`
    : `**Draft: ${pkgName}@${version} is staged on npm, not public yet.** After ` +
      `\`npm stage approve\`, run the GitHub Release workflow for v${version} ` +
      `(Actions → GitHub Release → Run workflow); it rewrites this header with the ` +
      `install line and publishes the page.`;
  const footer = `Earlier versions: [CHANGELOG.md](${repoUrl}/blob/v${version}/CHANGELOG.md).`;
  return `${header}\n\n${body}\n\n${footer}\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const version = args.find((a) => !a.startsWith("--"));
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    process.stderr.write("usage: release-notes.mjs <X.Y.Z> [--published]\n");
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf-8");
  const pkgName = JSON.parse(readFileSync(path.join(root, "mcp-server", "package.json"), "utf-8")).name;
  const repoUrl = `https://github.com/${process.env.GITHUB_REPOSITORY || "Agripp87/memoria_mcp"}`;
  const notes = releaseNotes({
    changelog,
    version,
    pkgName,
    repoUrl,
    published: args.includes("--published"),
  });
  if (!notes) {
    process.stderr.write(`CHANGELOG.md has no non-empty section "## [${version}]".\n`);
    process.exit(1);
  }
  process.stdout.write(notes);
}
