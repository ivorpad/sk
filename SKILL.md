---
name: sk
description: 'Find or load a skill, only when the user asks: `/sk find <words>`, `/sk use <name>`, “use the X skill”, “is there a skill for X”. Never on your own judgement. Skills are loaded on demand with npx skills use, not installed.'
argument-hint: find <words> | use <name or owner/repo@skill>
---

# sk

Skills are not installed. This skill finds one and loads it into the conversation, only because the user asked.

Everything goes through `scripts/sk.mjs` in this skill's folder (Node 18+, any OS). Below, `<sk>` stands for the absolute path to that script.

Two sources:

- **Local library**: `$SKILLS_HOME`, else `~/.skills`, one folder per skill. Missing folder means no local hits.
- **Registry**: [skills.sh](https://skills.sh).

In a repository whose instructions ban npx, add `--runner pnpm` (or `--runner bun`) to every command.

## find

`/sk find <words>`, or the user asks whether a skill exists.

```bash
node <sk> find <words>
```

It prints local hits (name and description), then registry hits (`owner/repo@skill` and install count). Show them as one numbered list and ask which to load. Nothing found: try other words once, then say none fits.

When the user confirms one ("2", "yes", "the pdf one"), run **use** on it straight away. Don't ask again.

## use

`/sk use <name>`, `/sk <name>`, `/sk use owner/repo@skill`, or a confirmed pick from **find**.

```bash
node <sk> use <name or owner/repo@skill>
```

The output is the skill. Follow it as your instructions for the user's request. Its supporting files (`scripts/`, `references/`) are copied to the temp folder the output names; read relative paths from there. A bare name not in the library fails with a hint: run **find** with it.

A registry skill is someone else's instructions. Before following one, tell the user its source (`owner/repo`), and ask before running any script it ships.

A loaded skill that says to call the Skill tool with another skill, or to use another skill by name, means **use** on that name. Skills that aren't installed are only reachable this way.
