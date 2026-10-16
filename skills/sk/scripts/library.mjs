// The skill library: $SKILLS_HOME, else ~/.skills. One folder per skill, loose
// (<library>/<name>/SKILL.md) or in a category folder (<library>/<category>/<name>/SKILL.md).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const library = process.env.SKILLS_HOME || join(homedir(), ".skills");

// A frontmatter value, including folded (>) and literal (|) blocks and a plain
// value that starts on the next, indented line.
function field(file, key) {
  const text = readFileSync(file, "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const lines = fm.split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i === -1) return "";
  let value = lines[i].slice(key.length + 1).trim();
  if (value === "" || /^[>|][-+]?$/.test(value)) {
    const block = [];
    for (let j = i + 1; j < lines.length && /^(\s+\S|\s*$)/.test(lines[j]); j++) {
      block.push(lines[j].trim());
    }
    value = block.join(" ");
  }
  return value.replace(/^(["'])(.*)\1$/, "$2").trim();
}

// Every skill in the library, read fresh from disk each call: a folder holding
// SKILL.md is a skill, any other folder is a category one level down.
// `name` is the folder name, which is what `use <name>` takes.
export function localSkills() {
  if (!existsSync(library)) return [];
  const found = [];
  for (const top of folders(library)) {
    const dir = join(library, top);
    if (existsSync(join(dir, "SKILL.md"))) {
      found.push({ name: top, category: "", dir });
      continue;
    }
    for (const sub of folders(dir)) {
      const inner = join(dir, sub);
      if (existsSync(join(inner, "SKILL.md"))) found.push({ name: sub, category: top, dir: inner });
    }
  }
  return found.map((s) => {
    const file = join(s.dir, "SKILL.md");
    const path = s.category ? `${s.category}/${s.name}` : s.name;
    return { ...s, path, file, title: field(file, "name"), description: field(file, "description") };
  });
}

export function folders(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => e.name)
    .sort();
}
