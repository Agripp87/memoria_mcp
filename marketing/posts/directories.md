# Lists, directories, Discords and newsletters

Slow channels that compound. Start them five days before launch: list pull
requests take days to merge.

Each list and directory has its own contribution rules and entry format, and
they change. Open the target's CONTRIBUTING file or submission form first and
fit the entry below to it. The target names here are the well-known ones as of
writing; confirm each still exists and accepts submissions.

## Awesome-lists

One pull request per list, one line each, placed alphabetically in the
closest existing category (usually "Memory" or "Knowledge & Memory"). Do not
add a new category for one entry.

**awesome-mcp-servers**

```markdown
- [Agripp87/memoria_mcp](https://github.com/Agripp87/memoria_mcp) - Persistent memory stored as Markdown files you own, with hybrid semantic + keyword search, git sync across devices, and an OAuth 2.1 remote transport.
```

If the list uses language and scope badges, this is a TypeScript server that
runs locally (stdio) or self-hosted (HTTP), on macOS, Linux and Windows.

**awesome-claude-code**

```markdown
- [Memoria](https://github.com/Agripp87/memoria_mcp) - Plugin that gives Claude Code a long-term memory as a Markdown repo you own. Hybrid local search, and SessionStart/Stop hooks that sync the store with git.
```

**Pull request description for either:**

> Adds Memoria, an Apache-2.0 MCP memory server. Memories are Markdown files
> on the user's disk; the SQLite search index is derived from them. It is
> published on npm as `@agrippa87/memoria-mcp` and listed in the official MCP
> Registry as `io.github.Agripp87/memoria-mcp`. I am the maintainer.

Say that you are the maintainer. Most lists ask, and all of them notice.

## MCP directories

The official MCP Registry listing is already done. For community directories
(for example Glama, PulseMCP, mcp.so, Smithery), use these fields:

| Field | Value |
|-------|-------|
| Name | Memoria |
| Tagline | Persistent, plain-text memory for Claude — as a Markdown repo you own. |
| Category | Memory / Knowledge |
| Repository | `https://github.com/Agripp87/memoria_mcp` |
| Package | `@agrippa87/memoria-mcp` (npm) |
| Registry name | `io.github.Agripp87/memoria-mcp` |
| License | Apache-2.0 |
| Transports | stdio; Streamable HTTP with OAuth 2.1 |
| Install | `npx -y @agrippa87/memoria-mcp` |
| Image | `marketing/images/launch.png` |
| Screenshots | `docs/images/dashboard-wiki-backlinks.png`, `dashboard-overview.png`, `dashboard-search.png` |
| Video | `marketing/video/demo-30s.mp4` (30 seconds, narrated); `demo.mp4` for the full 84 |

**Description (about 60 words):**

> Memoria gives Claude Code, claude.ai and other MCP clients one shared
> long-term memory. Memories are Markdown files with YAML frontmatter in a
> directory you control. A derived SQLite index provides hybrid semantic and
> keyword search with local embeddings, and the store syncs across machines
> with plain git. Apache-2.0, installs as a Claude Code plugin in two
> commands.

The Docker MCP Catalog is on the project roadmap and not yet done; it needs
its own packaging work and is outside this campaign.

## GitHub repository settings

Set under the repository's About panel.

**Description:**

```
Persistent, plain-text memory for Claude — as a Markdown repo you own.
```

**Topics:**

```
mcp mcp-server claude claude-code claude-code-plugin memory ai-memory markdown sqlite semantic-search model-context-protocol self-hosted
```

**README:** the top of the README now carries the 30-second demo, four
feature cards, the install card and four dashboard screenshots. They are
referenced by relative path, so they appear once this branch is merged to
`main`.

**Social preview:** `docs/images/social-preview.png` is already the right size
(1280×640). Confirm it is uploaded under Settings → Social preview.

**Pinned discussion, "Start here":**

> Welcome. Memoria is a solo project, so replies are asynchronous, usually
> within a few days.
>
> - **Trying it:** two commands in the README's Quick Start, or the hosted
>   demo on fake data.
> - **Something broke:** open an issue with your OS, Node version and the
>   server's stderr. Install failures are the most useful reports right now.
> - **An idea:** post it here before writing code, so we can agree on
>   direction.
> - **A security problem:** please follow SECURITY.md and do not open a public
>   issue.
>
> Never paste real memory files or keys. `npm run demo:gen` makes fake data
> for reproductions.

## Discord

For showcase or "share your project" channels only, in servers whose rules
allow it (the Anthropic Discord and the MCP community Discord both have had
such channels; check the current rules). One post per server. Attach
`video/demo-30s.mp4`.

> **Memoria: long-term memory for Claude as a Markdown repo you own**
>
> An open-source MCP server I have been running daily since spring. Memories
> are `.md` files in `~/.memoria`, search is hybrid with local embeddings, and
> the store syncs between machines with git (daily logs use `merge=union`, so
> same-day writes never conflict). Works in Claude Code over stdio and in
> claude.ai as a custom connector.
>
> ```
> /plugin marketplace add Agripp87/memoria_mcp
> /plugin install memoria@memoria
> ```
>
> Repo: <https://github.com/Agripp87/memoria_mcp>
> Feedback welcome, especially install failures.

## Newsletter pitch

For newsletters that cover Claude, MCP or developer tools and take
submissions. Find each one's submission address or form; do not guess at
personal addresses. Send two days after launch, when there is a thread to
point at. Three sentences and a link is the right length.

**Subject:** Open-source memory server for Claude that stores everything as Markdown

> Hi [name],
>
> I maintain Memoria, an open-source MCP server that gives Claude Code and
> claude.ai a shared long-term memory, stored as plain Markdown files the user
> owns and syncs with git. Two things your readers might find interesting: the
> one-line git trick that makes same-day writes from two machines merge
> without conflicts, and a retrieval eval that showed my hand-picked ranking
> weights were wrong ([link to the eval post]).
>
> Repo: https://github.com/Agripp87/memoria_mcp
>
> Thanks for considering it.
> [your name]

Send it once. No follow-up.
