# LinkedIn

One post, the day after launch. Attach `video/demo.mp4` (the full 84 seconds,
with narration; upload the file), or `launch-linkedin.png` (1200×627) if you
would rather post a still. Put the link in the first comment as well as the post: LinkedIn
shows link posts to fewer people.

---

For most of this year I have been building a memory for the AI assistant I
work with every day, and today it is ready for other people to use.

The problem is a small one that adds up. I use Claude Code for hours a day
across two machines. Each session starts with no knowledge of the last. A
decision made on Monday gets re-argued on Thursday, and nothing I work out in
the terminal is there when I open Claude on my phone.

Memoria is my answer. It is an open-source server that gives Claude a
long-term memory, and the design choice I care most about is where that memory
lives: in a folder of plain Markdown files that you own.

That one choice has consequences I like:

→ You can read what your assistant remembers about you, and correct it.
→ Syncing between machines is git. There is no service to trust.
→ If you stop using the tool, you keep the notes.
→ Search runs on your machine. Nothing is sent anywhere unless you opt in.

Three things I learned building it:

1. Measure what you tune. I chose the search ranking weights by hand and they
felt right. When I finally built an evaluation, they lost clearly to the
simplest baseline. The eval, and the list of things it cannot prove, are in
the repository.

2. Write the limitations down. The README has a section listing what is not
hardened or tested yet. It was uncomfortable to write, and it is the
section I would read first in anyone else's project.

3. Boring formats last. Markdown and git were available when I started and
will be when I am done.

It installs as a Claude Code plugin in two commands, and it is Apache-2.0
licensed. If your team uses Claude Code, I would like to hear whether shared
memory is something you would want, because Memoria today is deliberately
single-user.

https://github.com/Agripp87/memoria_mcp

#OpenSource #ClaudeCode #MCP #DeveloperTools

---

**First comment:**

Repo: https://github.com/Agripp87/memoria_mcp
Live demo on fake data (key: memoria-demo):
https://memoria-demo-hpb4luig7q-uc.a.run.app/dashboard
