# sk

One skill that loads every other skill on demand.

Every installed skill puts its description in the agent's context at the start of every session, whether you use it or not. On my machine that was 78 skills and about 23,000 characters of descriptions, roughly 6k tokens, before I typed anything. `sk` is the only skill you install. The rest stay out of the agent's skill folders and get loaded when you ask, through [`npx skills use`](https://github.com/vercel-labs/skills), which prints a skill as a prompt without installing it.

## Install

```bash
npx skills add ivorpad/sk -g
```

Then move your other skills out of `~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills` and the like, into `~/.skills`, one folder per skill (`~/.skills/<name>/SKILL.md`). Set `SKILLS_HOME` to use another folder. With no library at all, `sk` searches the [skills.sh](https://skills.sh) registry only.

Needs Node 18 or later, which you already have if `npx` works. macOS, Linux and Windows.

## Use

```
/sk find pdf                     # local library first, then skills.sh
/sk use pdf                      # $SKILLS_HOME/pdf
/sk use anthropics/skills@pdf    # straight from the registry
```

The copy-paste prompts on skills.sh work too. Paste `Run npx skills use "https://github.com/owner/repo" --skill "name" and follow the generated skill instructions now.` and `sk` takes it: it saves the whole skill to a temp file, reads all of it, then follows it.

`find` shows a numbered list. Answer with a number and the skill loads without another prompt. Saying "use the X skill" or "is there a skill for X" works too.

Under the hood the agent runs `scripts/sk.mjs`, a dependency-free Node script, so the same commands work in bash, zsh, PowerShell and cmd:

| You ask for | `node sk.mjs ...` does |
| --- | --- |
| `find <words>` | scores each local skill's name and description against the words, then runs `npx skills find <words>` |
| `use <name>` | `npx skills use <library>/<name>` |
| `use owner/repo@skill` | `npx skills use owner/repo@skill` |
| `use <url> --skill <name>` | `npx skills use <url> --skill <name>` |
| any `use` with `--out` | the same, saved whole to a temp file whose path it prints |

You can run it yourself too: `node ~/.claude/skills/sk/scripts/sk.mjs find pdf`.

`skills use` copies the skill's `scripts/` and `references/` to a temp folder and says where, so relative paths in the skill still resolve.

## Things to know

- The skill arrives as tool output, not through the agent's native skill loader. Claude Code won't show it as a launched skill. The instructions still land in context and the agent follows them.
- A skill that hands off to another one ("call the Skill tool with X") can't reach X through the native loader, because X isn't installed. `sk` tells the agent to load X the same way.
- Registry skills are other people's instructions. `sk` names the source repo before following one and asks before running any script it ships.
- In a repo whose instructions ban `npx`, the agent passes `--runner pnpm` or `--runner bun`. `SK_RUNNER` sets a default.
- The description says to load skills only when you ask. Agents mostly respect that, but it's a description, not a lock.
- Tested on macOS with Claude Code 2.1.299 and skills CLI from npm. Windows support is written but untested; issues welcome.

## License

MIT
