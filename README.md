# sk

One skill that loads every other skill on demand.

Every installed skill puts its description in the agent's context at the start of every session, whether you use it or not. On my machine that was 78 skills and about 23,000 characters of descriptions, roughly 6k tokens, before I typed anything. `sk` is the only skill you install. The rest stay out of the agent's skill folders and get loaded when you ask, through [`npx skills use`](https://github.com/vercel-labs/skills), which prints a skill as a prompt without installing it.

![A pasted skills.sh prompt run through /sk in Claude Code: one shell command links the skill, Skill(minimalist-ui) loads it natively, a second shell command removes the link](docs/native-load.png)

## Install

On Claude Code, as a plugin:

```
/plugin marketplace add ivorpad/sk
/plugin install sk@sk
```

The plugin adds two hooks: `SessionEnd` removes the skill folders `sk` copied in for that session, and `SessionStart` removes any a crashed session left. If you installed `sk` with `npx skills add` before, delete `~/.claude/skills/sk`, or both load (`/sk` and `/sk:sk`).

To also move your other skills into the library, or on any other agent, tell your agent:

```text
Follow https://raw.githubusercontent.com/ivorpad/sk/main/INSTALL.md
```

It installs `sk` only where it's missing, moves your other skills into one library folder after showing you the list and backing them up, and checks the result. On Claude Code it then offers the `/` autocomplete described below. [INSTALL.md](INSTALL.md) has the steps.

By hand: `npx skills add ivorpad/sk -g`, then move your skills into `~/.skills/<name>/SKILL.md`, or `~/.skills/<category>/<name>/SKILL.md` to group them (or the folder `SKILLS_HOME` points at). With no library at all, `sk` searches the [skills.sh](https://skills.sh) registry only.

Needs Node 18 or later, which you already have if `npx` works. macOS, Linux and Windows.

## Use

```
/sk find pdf                     # local library first, then skills.sh
/sk use pdf                      # $SKILLS_HOME/pdf, or $SKILLS_HOME/<category>/pdf
/sk use anthropics/skills@pdf    # straight from the registry
/sk prune                        # remove what loaded skills left on disk (automatic with the plugin)
/sk index                        # write INDEX.md and INDEX.json from the library's frontmatter
/vau                             # Claude Code: pick /lib:vault (MCP) from the / menu (needs the MCP server below)
```

The copy-paste prompts on skills.sh work too. Paste `Run npx skills use "https://github.com/owner/repo" --skill "name" and follow the generated skill instructions now.` and `sk` takes it: it saves the whole skill to a temp file, reads all of it, then follows it.

`find` shows a numbered list. Answer with a number and the skill loads without another prompt. Saying "use the X skill" or "is there a skill for X" works too.

Under the hood the agent runs `scripts/sk.mjs`, a dependency-free Node script, so the same commands work in bash, zsh, PowerShell and cmd:

| You ask for | `node sk.mjs ...` does |
| --- | --- |
| `find <words>` | scores each local skill's name and description against the words, then runs `npx skills find <words>` |
| `use <name>` | `npx skills use <library>/<name>` or `<library>/<category>/<name>`, or the skill in `.claude/skills` when the library has none. Two categories with the same name: pass `<category>/<name>` |
| `use owner/repo@skill` | `npx skills use owner/repo@skill` |
| `link <target>` | Claude Code only: the library folder, or the registry skill fetched with `skills add --copy`, copied into `~/.claude/skills/<session>-<name>` (the first 8 characters of the session id) without `disable-model-invocation`, so sessions loading the same skill don't share a folder. Refuses to replace a skill it didn't make |
| `unlink <name>` | deletes the copy's `SKILL.md`, so it leaves the listing. Its other files stay at the paths the Skill tool gave it until the session ends |
| `prune [--hours N] [--dry-run]` | deletes `sk-*` and `skills-use-*` temp folders older than N hours (default 1), and `link` copies whose Claude Code session (`CLAUDE_PID`) has ended. The plugin's hooks run it with `--hook` |
| `mcp [--resources]` | an MCP server on stdio listing each library skill as a prompt, for `/` autocomplete in Claude Code. `--resources` lists them for the `@` menu too, and `use` and `link` drop the `@lib:` prefix that inserts |
| `index [--check]` | writes `INDEX.md` (by category, with descriptions) and `INDEX.json` at the library root from each SKILL.md's frontmatter; `--check` exits 1 when they're stale |
| `use <url> --skill <name>` | `npx skills use <url> --skill <name>` |
| any `use` with `--out` | the same, saved whole to a temp file whose path it prints |

You can run it yourself too: `node <sk folder>/scripts/sk.mjs find pdf`, where the folder is `~/.claude/skills/sk` after `npx skills add`, or `skills/sk` in the plugin's install folder.

`skills use` copies the skill's `scripts/` and `references/` to a temp folder and says where, so relative paths in the skill still resolve.

### Autocomplete in Claude Code

Claude Code has no argument completion for skills: after `/sk use ` it shows the `argument-hint` and nothing else. It does list MCP prompts in the `/` menu, and it matches what you type anywhere in the name. So `sk mcp` serves each library skill as a prompt, and typing `/vau` offers `/lib:vault (MCP)` with the skill's description. Pick it and the agent loads the skill the way `/sk use vault` does.

```
claude mcp add -s user lib -- node /absolute/path/to/skills/sk/scripts/sk.mjs mcp
```

Your agent can do this for you. The install prompt above has the step, and it asks before it edits your Claude Code config.

Don't name the server `sk`. Every entry carries the server name, so typing `/sk` would list the whole library under the real `/sk`. A plugin install keeps a copy in `plugins/cache/sk/sk/<version>/` that moves on every update, so don't point at it. Point at the plugin's marketplace checkout, `plugins/marketplaces/sk/skills/sk/scripts/sk.mjs` inside your config folder (`~/.claude`, or `$CLAUDE_CONFIG_DIR` when set). It has no version in its path, and `/plugin marketplace update sk` updates it in place. An `npx skills add` copy or your own checkout works too.

Open a new Claude Code session after adding it. `claude mcp add` writes to `$CLAUDE_CONFIG_DIR/.claude.json` when that variable is set and `~/.claude.json` when it isn't, so for a second profile put `CLAUDE_CONFIG_DIR=<its folder>` in front. Until a session has the server, `/vau` answers `Unknown command`.

Text typed after the name is dropped. Claude Code only passes it to arguments a prompt declares, and these declare none, so `/vault fix this pdf` loses `fix this pdf`. Say what you want in the next message.

The server reads the library folders, not `INDEX.json`, and checks them every 5 seconds, so a skill added mid-session shows up without a restart. It leaves out the library's own copy of `sk`, since `/sk` is already there, and tells two skills with the same folder name apart by category (`security-vault`). That the `/` menu matches a bare `vau` against `lib:vault` is what Claude Code 2.1.301 does, not something it documents.

`mcp --resources` also lists the library in the `@` menu, where `/sk use @lib:vau` offers `@lib:vault`. You have to type the `lib:`. Claude Code ranks files by their position in the file list (the best file scores 0) and resources by a separate fuzzy score with 0.15 added, so with a bare `@vault` the files that fuzzy-match sort above the skills and Tab picks the first of them. File matching needs every typed character in the path, and paths have no `:`, so `@lib:vau` returns the library only. It's off by default. While a server that lists resources is connected, Claude Code adds three resource tools to every session (`ListMcpResourcesTool`, `ReadMcpResourceTool`, `ReadMcpResourceDirTool`), and the skill names start turning up in plain `@` searches too.

## Why not just `npx skills use`

`sk` calls `npx skills use` for every load, so the skill still isn't installed. What it adds:

- Finding. `skills use` needs the exact `owner/repo@skill` or path. `/sk find` searches your library and skills.sh and you answer with a number, and "use the pdf skill" works because `sk` is the one description the agent always sees.
- Short names. `/sk use pdf` means `$SKILLS_HOME/pdf`.
- A native load on Claude Code. `skills use` gives the agent the skill as Bash output. `sk` links it, launches it through the Skill tool, then unlinks it.
- Whole skills. `--out` writes the output to a file the agent reads in full, so a long `SKILL.md` isn't cut off in tool output.
- Cleanup. `skills use` leaves `skills-use-*` folders in the temp directory. `sk prune` and the plugin's hooks delete them.
- Hand-offs. A skill that calls another uninstalled skill gets it loaded the same way.

If you already know the source and your agent has no Skill tool, plain `npx skills use` gets you most of the way. `sk` earns its place in finding skills, loading them natively on Claude Code and leaving nothing behind.

## What stays on disk, and when it goes

On Claude Code, `link` copies the skill to `~/.claude/skills/<session>-<name>`, where `<session>` is the first 8 characters of the session id. `unlink` runs right after the Skill tool launches it and deletes only that copy's `SKILL.md`. From then on no session lists the skill, but its `scripts/`, `references/` and other files stay at the paths the skill was given. They stay until a prune removes the folder:

- With the plugin, the `SessionEnd` hook prunes that session's folders when it ends, which covers exiting, `/clear` and switching away with `/resume`. The `SessionStart` hook catches folders from sessions that crashed.
- Installed with `npx skills add`, there are no hooks, so folders stay until you run `/sk prune`. It skips any folder whose session is still running.
- A skill that is only a `SKILL.md` leaves nothing behind: `unlink` removes its folder at once.

A session resumed after its `SessionEnd` hook ran has lost those files. Load the skill again.

The temp folder a registry skill is fetched into is deleted as soon as `link` has copied it. Temp folders from `use` and `--out` (`sk-*`, `skills-use-*`) are pruned once they're an hour old (`--hours N` to change), by the `SessionStart` hook or `/sk prune`.

## Things to know

- On Claude Code, `sk` loads skills natively. It copies the skill into `~/.claude/skills`, which Claude Code watches, calls the Skill tool, then deletes the copy's `SKILL.md`. You see the usual `Skill(name)` launch and nothing stays listed, while `scripts/` and `references/` stay reachable for the session. That the Skill tool accepts a skill added mid-session is observed behavior (Claude Code 2.1.299), not documented. If it stops working, `sk` falls back to the text load.
- As a plugin, the skill is `/sk:sk`, since Claude Code prefixes plugin skills with the plugin name. Asking in words ("use the pdf skill") works either way.
- Other agents (Codex and the rest) have no Skill tool, so the skill arrives as tool output. The instructions still land in context and the agent follows them.
- A skill installed with `disable-model-invocation: true` is one the Skill tool refuses unless you type `/<name>`. Ask for it in words ("use the deploy skill") and `sk` loads it anyway, since you asked: a bare name resolves from the library, then `./.claude/skills`, then `~/.claude/skills`, and the linked copy drops the flag. A plugin's skill needs its folder path.
- A skill that hands off to another one ("call the Skill tool with X") can't reach X through the native loader, because X isn't installed. `sk` tells the agent to load X the same way.
- Registry skills are other people's instructions. `sk` names the source repo before following one and asks before running any script it ships.
- In a repo whose instructions ban `npx`, the agent passes `--runner pnpm` or `--runner bun`. `SK_RUNNER` sets a default.
- The description says to load skills only when you ask. Agents mostly respect that, but it's a description, not a lock.
- Tested on macOS with Claude Code 2.1.299 and 2.1.301 (the `/` menu autocomplete on 2.1.301 only) and skills CLI from npm. Windows support is written but untested; issues welcome.

## License

MIT
