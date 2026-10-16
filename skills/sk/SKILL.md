---
name: sk
description: 'Find or load a skill, only when the user asks: `/sk find <words>`, `/sk use <name>`, “use the X skill”, “is there a skill for X”, a pasted “Run `npx skills use …` and follow the generated skill instructions” prompt, or a skill the user asked for that the Skill tool refuses or does not list (disable-model-invocation). Never on your own judgement. Skills load on demand, not installed.'
argument-hint: find <words> | use <name | owner/repo@skill> | prune | <pasted skills.sh prompt>
---

# sk

Skills are not installed. This skill finds one and loads it into the conversation, only because the user asked.

Everything goes through `scripts/sk.mjs` in this skill's folder (Node 18+, any OS). Below, `<sk>` stands for the absolute path to that script.

Two sources:

- **Local library**: `$SKILLS_HOME`, else `~/.skills`, one folder per skill, loose (`<library>/vault`) or in a category folder (`<library>/security/vault`). A bare name finds it in any category. Missing folder means no local hits.
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

- `/sk use <name>` or `/sk <name>`: a skill in the local library, in whatever category it sits. `/sk use security/vault` names the path when two categories hold the same name.
- `/sk use @lib:<name>`: the same, picked from Claude Code's `@` menu, which `sk mcp --resources` fills with the library. Pass the target as typed; `sk.mjs` drops the `@<server>:` (or `@plugin:<plugin>:<server>:`) prefix. Any attached resource from that server is only that pointer, not the skill.
- `/sk use owner/repo@skill`: a registry skill.
- `/sk use path/to/skill`: a skill folder on disk.
- `/sk https://github.com/owner/repo/tree/main/skills/name`: a repo URL pointing at one skill. A repo with several skills fails with their names; ask which, then pass `--skill <name>`.
- A confirmed pick from **find**.
- The user asked for a skill by name and the Skill tool refused it or doesn't list it, because its author set `disable-model-invocation: true`. The user asking is what that setting waits for, so switch: `use <name>` finds it in `.claude/skills` too. For a plugin's skill, pass its folder path.
- A prompt pasted from skills.sh, with or without `/sk` in front:

  > Run `npx skills use "https://github.com/leonxlnx/taste-skill" --skill "minimalist-ui"` and follow the generated skill instructions now. Read its complete output, redirecting it to a temporary file first if necessary. Resolve relative paths from the supporting-files directory it provides.

  Take the source and `--skill` from it as they are: `<target>` is `"https://github.com/leonxlnx/taste-skill" --skill "minimalist-ui"`.

For a registry skill, tell the user its source repo before following it, and ask before running any script it ships.

### With a Skill tool (Claude Code)

Load it natively:

```bash
node <sk> link <target>
```

It copies the skill into Claude Code's skills folder as `<session>-<name>`, where it shows up within seconds, and prints that name. Call the Skill tool with that name, not the skill's own, and follow the skill. Once it has launched, take it out of the listing:

```bash
node <sk> unlink <name>
```

This removes only the copy's `SKILL.md`. The skill's base directory and its `scripts/`, `references/` and other files stay where the skill says for the rest of the session, so run and read them from there.

`link` refuses to replace a skill of the same name it didn't make, and says so. The copy drops `disable-model-invocation`, so a skill its author kept for `/<name>` loads too: the user asked for it. If `link` fails or the Skill tool still refuses the skill, unlink and load it as text instead.

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

It deletes the temp folders that `use` and `--out` leave (`sk-*`, and `skills-use-*` from `skills use`) once they're an hour old (`--hours N` to change), and the skill folders `link` made once the Claude Code session that made them has ended. Installed as a plugin, `sk` already runs this when a session starts and ends. Show the user the dry run first.

## index

`/sk index`, or the user asks to rebuild or check the library index.

```bash
node <sk> index
node <sk> index --check
```

It reads every SKILL.md's frontmatter and writes `INDEX.md` (skills grouped by category, with descriptions) and `INDEX.json` (the format `sr` reads) at the library root. `--check` writes nothing and exits 1 when either is out of date. It refuses when two categories hold a folder of the same name, since `use <name>` would be ambiguous. `find` and `use` read the folders themselves, so a stale index never hides a skill.

## mcp

Not for you to run. `node <sk> mcp` is an MCP server Claude Code starts once the user adds it (`claude mcp add -s user lib -- node <sk> mcp`). It lists each library skill as a prompt, so typing `/vau` in the `/` menu offers `/lib:vault (MCP)`, and picking one sends you a message to call this skill with `use vault`. With `--resources` it also fills the `@` menu, so `/sk use @lib:vau` autocompletes to `@lib:vault`.

## Hand-offs

A loaded skill that says to call the Skill tool with another skill, or to use another skill by name, means **use** on that name. Skills that aren't installed are only reachable this way.
