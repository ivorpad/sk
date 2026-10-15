#!/usr/bin/env node
// sk: find and load skills on demand. Node 18+, no dependencies, any OS.
//
//   node sk.mjs find <words...>                 local library, then skills.sh
//   node sk.mjs use <name | owner/repo@skill | url --skill <name>>   print the skill as a prompt
//   node sk.mjs link <same targets>             Claude Code: copy it into the skills folder for the Skill tool
//   node sk.mjs unlink <name>                   take it out of the listing, keeping its other files for the session
//   node sk.mjs prune [--hours N] [--dry-run] [--hook]   delete temp folders and copies whose session has ended
//
// Library: $SKILLS_HOME, else ~/.skills. One folder per skill: <library>/<name>/SKILL.md
// Runner: --runner npx|pnpm|bun, else $SK_RUNNER, else npx.
// --out writes the output to a temp file and prints the path instead.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  rmSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

const args = process.argv.slice(2);
let runner = process.env.SK_RUNNER || "npx";
const ri = args.indexOf("--runner");
if (ri !== -1) {
  runner = args[ri + 1] || runner;
  args.splice(ri, 2);
}
// --out: save the full output to a temp file and print its path, so a long
// skill is read whole instead of cut off by the agent's tool output limit.
const oi = args.indexOf("--out");
const out = oi !== -1;
if (out) args.splice(oi, 1);
const [command, ...rest] = args;
const library = process.env.SKILLS_HOME || join(homedir(), ".skills");
// Claude Code watches this folder and picks up a new skill mid-session.
const claudeSkills = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "skills");

function fail(message) {
  process.stderr.write(`sk: ${message}\n`);
  process.exit(2);
}

// `skills` through the chosen runner. Windows needs a shell to find npx.cmd.
function skills(...cliArgs) {
  return run(cliArgs, {});
}

function run(cliArgs, { cwd, quiet }) {
  const [bin, pre] = {
    npx: ["npx", ["--yes"]],
    pnpm: ["pnpm", ["dlx"]],
    bun: ["bunx", []],
  }[runner] ?? fail(`unknown runner ${runner}; use npx, pnpm or bun`);
  const windows = process.platform === "win32";
  // With a shell, Windows splits unquoted arguments at spaces ("C:\Users\Jane Doe\...").
  const argv = [...pre, "skills", ...cliArgs].map((a) =>
    windows && /\s/.test(a) ? `"${a}"` : a,
  );
  if (quiet) {
    return spawnSync(bin, argv, { stdio: "ignore", shell: windows, cwd }).status ?? 1;
  }
  if (!out) {
    const result = spawnSync(bin, argv, { stdio: "inherit", shell: windows });
    return result.status ?? 1;
  }
  const result = spawnSync(bin, argv, {
    stdio: ["ignore", "pipe", "inherit"],
    shell: windows,
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = result.stdout?.toString() ?? "";
  const file = join(mkdtempSync(join(tmpdir(), "sk-")), "skill.txt");
  writeFileSync(file, text);
  const lines = text.split("\n").length;
  console.log(`Saved ${lines} lines to ${file}. Read all of it before acting.`);
  return result.status ?? 1;
}

// The `description:` value, including folded (>) and literal (|) blocks.
function description(file) {
  const text = readFileSync(file, "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const lines = fm.split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i === -1) return "";
  let value = lines[i].replace(/^description:\s*/, "");
  if (/^[>|][-+]?$/.test(value)) {
    const block = [];
    for (let j = i + 1; j < lines.length && /^(\s+\S|\s*$)/.test(lines[j]); j++) {
      block.push(lines[j].trim());
    }
    value = block.join(" ");
  }
  return value.replace(/^(["'])(.*)\1$/, "$2").trim();
}

function localSkills() {
  if (!existsSync(library)) return [];
  return readdirSync(library, { withFileTypes: true })
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => ({ name: e.name, file: join(library, e.name, "SKILL.md") }))
    .filter((s) => existsSync(s.file))
    .map((s) => ({ ...s, description: description(s.file) }));
}

function find(words) {
  const terms = words.map((w) => w.toLowerCase()).filter(Boolean);
  if (terms.length === 0) fail("find needs words");
  const hits = localSkills()
    .map((s) => {
      const name = s.name.toLowerCase();
      const desc = s.description.toLowerCase();
      const score = terms.reduce(
        (n, t) => n + (name.includes(t) ? 3 : 0) + (desc.includes(t) ? 1 : 0),
        0,
      );
      return { ...s, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 10);

  console.log(`Local (${library}):`);
  if (hits.length === 0) console.log("  none");
  for (const s of hits) {
    const desc = s.description.length > 140 ? `${s.description.slice(0, 139)}…` : s.description;
    console.log(`  ${s.name}\n    ${desc}`);
  }
  console.log("\nRegistry (skills.sh):");
  return skills("find", ...words);
}

// Extra flags (--skill <name>, as skills.sh prompts give) pass through to `skills use`.
function use(target, extra) {
  if (!target) fail("use needs a skill name, owner/repo@skill, or a repo URL with --skill");
  const local = target.includes("/") ? undefined : named(target);
  if (local) return skills("use", local, ...extra);
  if (existsSync(join(resolve(target), "SKILL.md"))) return skills("use", resolve(target), ...extra);
  if (target.includes("/")) return skills("use", target, ...extra);
  fail(`no skill named ${target} in ${library} or .claude/skills; run: node sk.mjs find ${target}`);
}

// A bare name: the library first, then a skill installed in this project's or
// the user's .claude/skills. An installed skill the Skill tool won't take
// (disable-model-invocation) still loads here when the user asks for it.
function named(name) {
  const dirs = [library, join(process.cwd(), ".claude", "skills"), claudeSkills];
  return dirs.map((d) => join(d, name)).find((d) => existsSync(join(d, "SKILL.md")));
}

// owner/repo@skill, or a source plus --skill <name>.
function remote(target, extra) {
  const si = extra.indexOf("--skill");
  if (si !== -1) return { source: target, skill: extra[si + 1] };
  const at = target.lastIndexOf("@");
  if (at > 0 && !target.slice(at).includes("/")) {
    return { source: target.slice(0, at), skill: target.slice(at + 1) };
  }
  // A URL or repo on its own: fine when it holds (or points at) a single skill.
  return { source: target, skill: undefined };
}

// The skill's folder on disk: the library copy, or a registry skill fetched
// into a temp project with `skills add --copy`, which never touches real skill folders.
function resolveDir(target, extra) {
  // A folder on disk: path/to/skill
  if (existsSync(join(resolve(target), "SKILL.md"))) return resolve(target);
  if (!target.includes("/")) {
    const local = named(target);
    if (local) return local;
    fail(`no skill named ${target} in ${library} or .claude/skills; run: node sk.mjs find ${target}`);
  }
  const { source, skill } = remote(target, extra);
  const tmp = mkdtempSync(join(tmpdir(), "sk-"));
  const pick = skill ? ["--skill", skill] : [];
  const status = run(["add", source, ...pick, "--copy", "-y", "-a", "claude-code"], {
    cwd: tmp,
    quiet: true,
  });
  const root = join(tmp, ".claude", "skills");
  const found = existsSync(root)
    ? readdirSync(root).filter((n) => existsSync(join(root, n, "SKILL.md")))
    : [];
  if (status !== 0 || found.length === 0) {
    fail(`could not fetch ${skill ?? "a skill"} from ${source}; use: node sk.mjs use ${target} ${extra.join(" ")} --out`);
  }
  if (skill) return join(root, skill);
  if (found.length > 1) {
    fail(`${source} has ${found.length} skills: ${found.join(", ")}. Pick one: ${source} --skill <name>`);
  }
  return join(root, found[0]);
}

// Claude Code: copy the skill into its skills folder, where the watcher lists it
// for the Skill tool. A copy, not a symlink: the Skill tool hands the skill paths
// under claudeSkills/<name>, and a copy keeps them working after unlink with
// nothing to dangle. The copy's SKILL.md drops disable-model-invocation, since
// sk only loads a skill the user asked for.
function link(target, extra) {
  if (!target) fail("link needs a skill name, owner/repo@skill, or a repo URL with --skill");
  const dir = resolveDir(target, extra);
  const name = folderName(dir.split(/[\\/]/).pop());
  const path = join(claudeSkills, name);
  if (existsSync(path) && !isOurs(path)) {
    fail(`${path} already exists; not replacing it. Load that one, or use: node sk.mjs use ${target} --out`);
  }
  mkdirSync(claudeSkills, { recursive: true });
  // Build beside it, then swap, so a failure leaves nothing half-copied in the listing.
  const staged = mkdtempSync(join(claudeSkills, `.${name}.sk-`));
  writeFileSync(join(staged, MARK), JSON.stringify(owner(dir)));
  cpSync(dir, staged, { recursive: true, dereference: true });
  const skillFile = join(staged, "SKILL.md");
  const text = readFileSync(skillFile, "utf8");
  const invocable = modelInvocable(text);
  if (invocable !== text) writeFileSync(skillFile, invocable);
  rmSync(path, { recursive: true, force: true });
  renameSync(staged, path);
  const fetched = fetchedRoot(dir);
  if (fetched) rmSync(fetched, { recursive: true, force: true });
  // Give Claude Code's file watcher time to list it.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  console.log(`Linked ${name} from ${dir}`);
  if (invocable !== text) console.log("Removed disable-model-invocation from the copy, so the Skill tool takes it");
  console.log(`Call the Skill tool with "${name}", then run: node sk.mjs unlink ${name}`);
  return 0;
}

// SKILL.md without a `disable-model-invocation:` line in its frontmatter.
function modelInvocable(text) {
  const fm = /^---\r?\n[\s\S]*?\r?\n---/.exec(text)?.[0];
  if (!fm) return text;
  return fm.replace(/^disable-model-invocation:.*\r?\n/m, "") + text.slice(fm.length);
}

// <session>-<name>: two sessions loading the same skill get a folder each, so
// one ending never removes files the other is using. The Skill tool takes this
// folder name, and lists the skill's own name beside it.
function folderName(skill) {
  const session = (process.env.CLAUDE_CODE_SESSION_ID || "").slice(0, 8);
  return session ? `${session}-${skill}` : skill;
}

// Marks a folder link made in claudeSkills, with the Claude Code process it was
// made in (CLAUDE_PID) so prune leaves it alone while that session runs.
const MARK = ".sk-link";

function owner(source) {
  const pid = Number(process.env.CLAUDE_PID) || undefined;
  return { source, pid, session: process.env.CLAUDE_CODE_SESSION_ID };
}

function isOurs(path) {
  return existsSync(join(path, MARK));
}

function readMark(path) {
  try {
    return JSON.parse(readFileSync(join(path, MARK), "utf8"));
  } catch {
    return {};
  }
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// The sk-* folder resolveDir fetched a registry skill into, if dir is one.
function fetchedRoot(dir) {
  const parts = relative(tmpdir(), dir).split(sep);
  const fetched = parts.length === 4 && /^sk-/.test(parts[0]) && parts[1] === ".claude" && parts[2] === "skills";
  return fetched ? join(tmpdir(), parts[0]) : undefined;
}

// Drop the skill from the listing once the Skill tool has loaded it. Only
// SKILL.md goes: scripts/, references/ and the rest stay at the paths the skill
// was given until the session ends and prune removes them.
function unlink(given) {
  if (!given) fail("unlink needs a skill name");
  // The name link printed, or the skill's own name in this session.
  const name = isOurs(join(claudeSkills, given)) ? given : folderName(given);
  const path = join(claudeSkills, name);
  if (!isOurs(path)) fail(`${path} was not made by sk link; leaving it alone`);
  rmSync(join(path, "SKILL.md"), { force: true });
  const rest = readdirSync(path).filter((n) => n !== MARK);
  if (rest.length === 0) rmSync(path, { recursive: true, force: true });
  console.log(`Unlinked ${name}`);
  if (rest.length > 0) console.log(`Kept ${rest.join(", ")} in ${path} for this session`);
  return 0;
}

// Temp folders this skill leaves behind: sk-* from --out, and skills-use-*
// where `skills use` copies supporting files, once older than --hours. Folders
// link made in the Claude Code skills folder go once their session has ended,
// or, without a recorded session, once older than --hours.
// --hook: run from a SessionStart or SessionEnd hook, which passes the session
// as JSON on stdin. SessionEnd fires while the process is still alive, so the
// ending session's folders are matched by session_id instead.
function prune(flags) {
  const hook = flags.includes("--hook");
  let ending;
  if (hook) {
    try {
      const event = JSON.parse(readFileSync(0, "utf8"));
      if (event.hook_event_name === "SessionEnd") ending = event.session_id;
    } catch {}
  }
  const hi = flags.indexOf("--hours");
  const hours = hi === -1 ? 1 : Number(flags[hi + 1]);
  if (!Number.isFinite(hours) || hours < 0) fail("--hours needs a number of hours, 0 or more");
  const dry = flags.includes("--dry-run");
  const tmp = tmpdir();
  const cutoff = Date.now() - hours * 3600_000;
  const verb = dry ? "would remove" : "removed";

  let links = 0;
  if (existsSync(claudeSkills)) {
    for (const entry of readdirSync(claudeSkills)) {
      const path = join(claudeSkills, entry);
      if (!isOurs(path)) continue;
      const { pid, session } = readMark(path);
      const ended = ending !== undefined && session === ending;
      if (!ended && (pid ? alive(pid) : statSync(join(path, MARK)).mtimeMs > cutoff)) {
        console.log(`kept ${path}${pid ? ` (session ${pid} running)` : ""}`);
        continue;
      }
      if (!dry) rmSync(path, { recursive: true, force: true });
      console.log(`${verb} ${path}`);
      links++;
    }
  }

  let dirs = 0;
  // SessionEnd hooks get 1.5 s; the temp folder scan waits for the next SessionStart.
  for (const entry of ending === undefined ? readdirSync(tmp) : []) {
    if (!/^(sk-|skills-use-)/.test(entry)) continue;
    const path = join(tmp, entry);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (!st.isDirectory() || st.mtimeMs > cutoff) continue;
    if (!dry) rmSync(path, { recursive: true, force: true });
    dirs++;
  }
  console.log(`${verb} ${dirs} temp folder(s) older than ${hours}h from ${tmp} and ${links} linked skill folder(s)`);
  return 0;
}

switch (command) {
  case "find":
    process.exit(find(rest));
  case "use":
    process.exit(use(rest[0], rest.slice(1)));
  case "link":
    process.exit(link(rest[0], rest.slice(1)));
  case "unlink":
    process.exit(unlink(rest[0]));
  case "prune":
    process.exit(prune(rest));
  default:
    fail(
      "usage: node sk.mjs find <words...> | use|link <name | owner/repo@skill | url --skill <name>> [--out] [--runner npx|pnpm|bun] | unlink <name> | prune [--hours N] [--dry-run] [--hook]",
    );
}
