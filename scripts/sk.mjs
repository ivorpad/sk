#!/usr/bin/env node
// sk: find and load skills on demand. Node 18+, no dependencies, any OS.
//
//   node sk.mjs find <words...>                 local library, then skills.sh
//   node sk.mjs use <name | owner/repo@skill | url --skill <name>>   print the skill as a prompt
//
// Library: $SKILLS_HOME, else ~/.skills. One folder per skill: <library>/<name>/SKILL.md
// Runner: --runner npx|pnpm|bun, else $SK_RUNNER, else npx.
// --out writes the output to a temp file and prints the path instead.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

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

function fail(message) {
  process.stderr.write(`sk: ${message}\n`);
  process.exit(2);
}

// `skills` through the chosen runner. Windows needs a shell to find npx.cmd.
function skills(...cliArgs) {
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
  if (target.includes("/")) return skills("use", target, ...extra);
  fail(`no skill named ${target} in ${library}; run: node sk.mjs find ${target}`);
}

switch (command) {
  case "find":
    process.exit(find(rest));
  case "use":
    process.exit(use(rest[0], rest.slice(1)));
  default:
    fail("usage: node sk.mjs find <words...> | use <name | owner/repo@skill | url --skill <name>> [--runner npx|pnpm|bun]");
}
