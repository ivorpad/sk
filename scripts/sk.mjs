#!/usr/bin/env node
// sk: find and load skills on demand. Node 18+, no dependencies, any OS.
//
//   node sk.mjs find <words...>                 local library, then skills.sh
//   node sk.mjs use <name | owner/repo@skill | url --skill <name>>   print the skill as a prompt
//   node sk.mjs link <same targets>             Claude Code: put it in the skills folder for the Skill tool
//   node sk.mjs unlink <name>                   remove a link that link made
//   node sk.mjs prune [--hours N] [--dry-run]   delete temp folders from skills use / link / --out
//
// Library: $SKILLS_HOME, else ~/.skills. One folder per skill: <library>/<name>/SKILL.md
// Runner: --runner npx|pnpm|bun, else $SK_RUNNER, else npx.
// --out writes the output to a temp file and prints the path instead.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readlinkSync,
  rmSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  const local = join(library, target);
  if (!target.includes("/") && existsSync(join(local, "SKILL.md"))) {
    return skills("use", local, ...extra);
  }
  if (existsSync(join(resolve(target), "SKILL.md"))) return skills("use", resolve(target), ...extra);
  if (target.includes("/")) return skills("use", target, ...extra);
  fail(`no skill named ${target} in ${library}; run: node sk.mjs find ${target}`);
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
    const local = join(library, target);
    if (existsSync(join(local, "SKILL.md"))) return local;
    fail(`no skill named ${target} in ${library}; run: node sk.mjs find ${target}`);
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

function link(target, extra) {
  if (!target) fail("link needs a skill name, owner/repo@skill, or a repo URL with --skill");
  const dir = resolveDir(target, extra);
  const name = dir.split(/[\\/]/).pop();
  const path = join(claudeSkills, name);
  if (existsSync(path) || isLink(path)) {
    fail(`${path} already exists; not replacing it. Load that one, or use: node sk.mjs use ${target} --out`);
  }
  mkdirSync(claudeSkills, { recursive: true });
  // A junction needs no admin rights on Windows; elsewhere the type is ignored.
  symlinkSync(dir, path, "junction");
  // Give Claude Code's file watcher time to list it.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  console.log(`Linked ${name} from ${dir}`);
  console.log(`Call the Skill tool with "${name}", then run: node sk.mjs unlink ${name}`);
  return 0;
}

function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function unlink(name) {
  if (!name) fail("unlink needs a skill name");
  const path = join(claudeSkills, name);
  if (!isLink(path)) fail(`${path} is not a link; leaving it alone`);
  unlinkSync(path);
  console.log(`Unlinked ${name}`);
  return 0;
}

// Temp folders this skill leaves behind: sk-* from link and --out, and
// skills-use-* where `skills use` copies supporting files. Folders a live link
// in the Claude Code skills folder still points into are kept; links whose
// temp folder is gone are removed.
function prune(flags) {
  const hi = flags.indexOf("--hours");
  const hours = hi === -1 ? 1 : Number(flags[hi + 1]);
  if (!Number.isFinite(hours) || hours < 0) fail("--hours needs a number of hours, 0 or more");
  const dry = flags.includes("--dry-run");
  const tmp = tmpdir();
  const cutoff = Date.now() - hours * 3600_000;
  const verb = dry ? "would remove" : "removed";

  const inUse = new Set();
  let links = 0;
  if (existsSync(claudeSkills)) {
    for (const entry of readdirSync(claudeSkills)) {
      const path = join(claudeSkills, entry);
      if (!isLink(path)) continue;
      const target = resolve(claudeSkills, readlinkSync(path));
      if (!target.startsWith(tmp)) continue;
      if (existsSync(target)) {
        inUse.add(target);
        continue;
      }
      if (!dry) unlinkSync(path);
      console.log(`${verb} dangling link ${path}`);
      links++;
    }
  }

  let dirs = 0;
  for (const entry of readdirSync(tmp)) {
    if (!/^(sk-|skills-use-)/.test(entry)) continue;
    const path = join(tmp, entry);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (!st.isDirectory() || st.mtimeMs > cutoff) continue;
    if ([...inUse].some((t) => t === path || t.startsWith(path + "/") || t.startsWith(path + "\\"))) {
      console.log(`kept ${path} (linked)`);
      continue;
    }
    if (!dry) rmSync(path, { recursive: true, force: true });
    dirs++;
  }
  console.log(`${verb} ${dirs} temp folder(s) older than ${hours}h and ${links} dangling link(s) from ${tmp}`);
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
      "usage: node sk.mjs find <words...> | use|link <name | owner/repo@skill | url --skill <name>> [--out] [--runner npx|pnpm|bun] | unlink <name> | prune [--hours N] [--dry-run]",
    );
}
