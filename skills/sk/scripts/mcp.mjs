// `sk mcp`: the library as an MCP server, for autocomplete in Claude Code.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { folders, library, localSkills } from "./library.mjs";

// A minimal MCP server (JSON-RPC 2.0, one message per line on stdio) that lists
// each library skill as a prompt named after its folder. Claude Code shows
// prompts in its / menu as /<server>:<name> (MCP) and matches what you type
// anywhere in that name, so /vau finds /lib:vault with no prefix to type.
// Added with: claude mcp add -s user lib -- node <sk> mcp
// Name the server something without "sk" in it: every entry carries the server
// name, so typing /sk would list the whole library under the real /sk.
// --resources also lists each skill as an @ resource. Claude Code ranks files
// above resources, so the query has to start with the server name (@lib:vau),
// and it adds two resource tools to every session while the server is connected.
// The library is checked every few seconds; a change sends list_changed so
// Claude Code fetches the list again mid-session.
export function mcp(flags) {
  const withResources = flags.includes("--resources");
  const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
  const brief = (s) => (s.description.length > 200 ? `${s.description.slice(0, 199)}…` : s.description);
  // /sk is already the way in, so the library's own copy of sk isn't offered.
  // A folder name two categories share is told apart by its category.
  const listed = () => {
    const all = localSkills().filter((s) => s.name !== "sk");
    const count = new Map();
    for (const s of all) count.set(s.name, (count.get(s.name) ?? 0) + 1);
    return all.map((s) =>
      count.get(s.name) > 1
        ? { ...s, id: s.category ? `${s.category}-${s.name}` : s.name, target: s.path }
        : { ...s, id: s.name, target: s.name },
    );
  };
  const find = (id) => listed().find((s) => s.id === id);
  const handlers = {
    initialize: (p) => ({
      protocolVersion: p?.protocolVersion ?? "2025-06-18",
      capabilities: {
        prompts: { listChanged: true },
        ...(withResources && { resources: { listChanged: true } }),
      },
      serverInfo: { name: "sk", version: "0.2.0" },
    }),
    ping: () => ({}),
    "prompts/list": () => ({
      prompts: listed().map((s) => ({
        name: s.id,
        title: s.title || s.name,
        description: brief(s) || `Library skill ${s.path}`,
      })),
    }),
    // No arguments: Claude Code splits what follows the command at spaces and
    // would hand over only the first word. The request goes in the next message.
    "prompts/get": (p) => {
      const s = find(p?.name);
      if (!s) throw { code: -32602, message: `no skill named ${p?.name} in ${library}` };
      const text = `Load the library skill "${s.target}" with the sk skill. Call the Skill tool with skill "sk" (or "sk:sk" if it is listed that way) and args "use ${s.target}", then follow what it loads.`;
      return { description: brief(s), messages: [{ role: "user", content: { type: "text", text } }] };
    },
  };
  if (withResources) {
    Object.assign(handlers, {
      "resources/list": () => ({
        resources: listed().map((s) => ({
          uri: s.id,
          name: s.id,
          title: s.title || s.name,
          description: brief(s),
          mimeType: "text/plain",
        })),
      }),
      "resources/templates/list": () => ({ resourceTemplates: [] }),
      "resources/read": (p) => {
        const s = find(p?.uri);
        if (!s) throw { code: -32002, message: `no skill named ${p?.uri} in ${library}` };
        const text = `Library skill ${s.target} (${s.path}). The user picked it; load it with: node <sk> use ${s.target}`;
        return { contents: [{ uri: s.id, mimeType: "text/plain", text }] };
      },
    });
  }
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        send({ id: null, error: { code: -32700, message: "parse error" } });
        continue;
      }
      if (msg.id === undefined) continue; // a notification
      const handler = handlers[msg.method];
      if (!handler) {
        send({ id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } });
        continue;
      }
      try {
        send({ id: msg.id, result: handler(msg.params) });
      } catch (e) {
        send({ id: msg.id, error: { code: e.code ?? -32603, message: e.message ?? String(e) } });
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
  // Folder names only: reading 600 SKILL.md files every 5 seconds is wasteful.
  const names = () =>
    existsSync(library)
      ? folders(library)
          .flatMap((top) =>
            existsSync(join(library, top, "SKILL.md"))
              ? [top]
              : folders(join(library, top)).map((sub) => `${top}/${sub}`),
          )
          .join("\n")
      : "";
  let seen = names();
  setInterval(() => {
    const now = names();
    if (now === seen) return;
    seen = now;
    send({ method: "notifications/prompts/list_changed" });
    if (withResources) send({ method: "notifications/resources/list_changed" });
  }, 5000).unref();
}
