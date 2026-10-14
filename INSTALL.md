# Install sk

Instructions for an agent. Set up [sk](https://github.com/ivorpad/sk) so that it is the only skill the user's agents load, and every other skill loads on demand.

1. Check `node --version` is 18 or later. Stop and tell the user if not.
2. Install it globally. For Claude Code, as a plugin: `claude plugin marketplace add ivorpad/sk`, then `claude plugin install sk@sk`. For any other agent: `npx skills add ivorpad/sk -g -y`.
3. Use `~/.skills` as the skill library, unless SKILLS_HOME is already set; then use that. Create the folder if it's missing.
4. Find every skill installed outside the library: each folder holding a SKILL.md directly under ~/.claude/skills, ~/.agents/skills, ~/.codex/skills, ~/.cursor/skills and ~/.copilot/skills, following symlinks. Skip sk itself. Skip anything managed elsewhere: plugin caches, ~/.codex/skills/.system, and ~/.claude/skills/synced (claude.ai sync). Skip skills committed inside project repositories.
5. Show the user the list: name, where it is, and whether the library already has a skill of that name. Ask before moving anything.
6. Back up every folder you will change into one dated tar.gz under the user's home directory, and tell them its path.
7. Copy each skill into the library as <library>/<name>/, following symlinks and skipping .git, node_modules, .venv and __pycache__. When the library already has that name with different content, keep the copy whose SKILL.md was modified most recently, and list what you dropped.
8. Only after every copy is verified, remove the originals from the agent folders, leaving sk.
9. If the library isn't ~/.skills, make SKILLS_HOME stick: add `export SKILLS_HOME="<library>"` to the user's shell profile (~/.zshenv for zsh, ~/.bashrc for bash, `setx SKILLS_HOME "<library>"` on Windows), and add it under "env" in ~/.claude/settings.json if they use Claude Code.
10. If ~/.claude/settings.json has "skillOverrides" entries for skills you moved, tell the user. They can stop sk loading those skills natively, and removing them is the user's call.
11. Verify: list each agent skill folder (it should hold only sk, or nothing besides plugin-managed folders when sk is the plugin), then run `node <sk folder>/scripts/sk.mjs find <a word from one moved skill>` and show the user the output.
12. Report what moved, what you skipped and why, the backup path, and anything still loading that you couldn't move.
