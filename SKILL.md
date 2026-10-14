---
name: sk
description: 'Find or load a skill, only when the user asks: `/sk find <words>`, `/sk use <name>`, “use the X skill”, “is there a skill for X”, or a pasted “Run `npx skills use …` and follow the generated skill instructions” prompt. Never on your own judgement. Skills load on demand, not installed.'
argument-hint: find <words> | use <name | owner/repo@skill> | prune | <pasted skills.sh prompt>
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

Any of these is a request to load a skill now:

- `/sk use <name>` or `/sk <name>`: a skill in the local library.
- `/sk use owner/repo@skill`: a registry skill.
- `/sk use path/to/skill`: a skill folder on disk.
- `/sk https://github.com/owner/repo/tree/main/skills/name`: a repo URL pointing at one skill. A repo with several skills fails with their names; ask which, then pass `--skill <name>`.
- A confirmed pick from **find**.
- A prompt pasted from skills.sh, with or without `/sk` in front:

  > Run `npx skills use "https://github.com/leonxlnx/taste-skill" --skill "minimalist-ui"` and follow the generated skill instructions now. Read its complete output, redirecting it to a temporary file first if necessary. Resolve relative paths from the supporting-files directory it provides.

  Take the source and `--skill` from it as they are: `<target>` is `"https://github.com/leonxlnx/taste-skill" --skill "minimalist-ui"`.

For a registry skill, tell the user its source repo before following it, and ask before running any script it ships.

### With a Skill tool (Claude Code)

Load it natively:

```bash
node <sk> link <target>
```

It puts the skill in Claude Code's skills folder, where it shows up within seconds, and prints its name. Call the Skill tool with that name and follow the skill. Once it has launched, remove the link so it doesn't stay listed:

```bash
node <sk> unlink <name>
```

`link` refuses to replace an existing skill of the same name and says so. If it fails, or the Skill tool refuses the skill (an author can mark a skill user-only; then tell the user to type `/<name>`), unlink and load it as text instead.

### Without one (Codex and others), or as the fallback

```bash
node <sk> use <target> --out
```

It saves the whole skill to a temp file and prints the path. Read all of it before acting; a skill read halfway is followed wrong. The file is the skill: follow it as your instructions for the user's request. Supporting files (`scripts/`, `references/`) are copied to the temp folder the output names; read relative paths from there.

## prune

`/sk prune`, or the user asks to clean up after loaded skills.

```bash
node <sk> prune --dry-run
node <sk> prune
```

It deletes the temp folders that `use`, `link` and `--out` leave (`sk-*`, and `skills-use-*` from `skills use`) once they're an hour old (`--hours N` to change), keeps any folder a live link still points into, and removes links in Claude Code's skills folder whose temp folder is gone. Show the user the dry run first.

## Hand-offs

A loaded skill that says to call the Skill tool with another skill, or to use another skill by name, means **use** on that name. Skills that aren't installed are only reachable this way.
