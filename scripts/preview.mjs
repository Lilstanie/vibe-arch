#!/usr/bin/env node
/**
 * Headless preview — uses madge for dependency analysis.
 * Usage: node scripts/preview.mjs [workspaceRoot]
 */
import path from "path";
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const madge = require("madge");
const yaml = require("js-yaml");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", gray: "\x1b[90m",
  cyan: "\x1b[36m",
};
const SYM = { planned: "◌", wip: "◑", done: "●" };
const COL = { planned: C.gray, wip: C.yellow, done: C.green };

const EXCLUDED = new Set([
  "node_modules",".git",".next","out","dist","build",
  ".vercel","public",".github",".vscode","vibe-arch",
  "__pycache__",".turbo","coverage",".cache",
]);
const CODE_EXTS = new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs"]);
const STUB_THRESHOLD = 15;
const TODO_RE = /\b(TODO|FIXME|XXX)\b|@stub/i;

const root = path.resolve(process.argv[2] ?? process.cwd());

// ── optional yaml ─────────────────────────────────────────────────────────────
let yamlBlocks = new Map();
const yamlPath = path.join(root, "vibe-arch.yaml");
if (fs.existsSync(yamlPath)) {
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8")) ?? {};
  if (doc.blocks) {
    for (const [id, def] of Object.entries(doc.blocks)) {
      const yb = { id, intent: def?.intent ?? "", pinnedStatus: null, extraDeps: def?.depends_on ?? [] };
      if (["planned","wip","done"].includes(def?.status)) yb.pinnedStatus = def.status;
      yamlBlocks.set(id, yb);
    }
  }
}

// ── madge ─────────────────────────────────────────────────────────────────────
console.log(`${C.dim}Running madge on ${root}…${C.reset}`);
const tsConfigPath = path.join(root, "tsconfig.json");

let graph = {};
try {
  const result = await madge(root, {
    fileExtensions: ["ts","tsx","js","jsx","mjs"],
    tsConfig: fs.existsSync(tsConfigPath) ? tsConfigPath : undefined,
    excludeRegExp: [/node_modules/,/\.d\.ts$/,/[/\\]\.next[/\\]/,/[/\\]out[/\\]/,/[/\\]dist[/\\]/,/vibe-arch/],
    baseDir: root,
  });
  graph = result.obj();
} catch (e) {
  console.error(`${C.yellow}madge error: ${e.message}${C.reset}`);
}

const allFiles = Object.keys(graph);
console.log(`${C.dim}Found ${allFiles.length} files${C.reset}\n`);

// ── block derivation ──────────────────────────────────────────────────────────
function blockId(relFile) {
  const segs = relFile.replace(/\\/g, "/").split("/");
  if (EXCLUDED.has(segs[0])) return null;
  if (segs.length > 1) return segs[0];
  const ext = path.extname(segs[0]);
  if (CODE_EXTS.has(ext) && !segs[0].endsWith(".d.ts"))
    return segs[0].replace(/\.[^.]+$/, "");
  return null;
}

const blockMap = new Map(); // id → Set<relFile>
for (const f of allFiles) {
  const bid = blockId(f);
  if (!bid) continue;
  if (!blockMap.has(bid)) blockMap.set(bid, new Set());
  blockMap.get(bid).add(f);
}

// ── edges ─────────────────────────────────────────────────────────────────────
const edgeSet = new Set();
const edges = [];
for (const [file, deps] of Object.entries(graph)) {
  const from = blockId(file);
  if (!from || !blockMap.has(from)) continue;
  for (const dep of deps) {
    const to = blockId(dep);
    if (!to || !blockMap.has(to) || to === from) continue;
    const key = `${to}→${from}`;
    if (!edgeSet.has(key)) { edgeSet.add(key); edges.push({ from: to, to: from }); }
  }
}

// yaml extra deps
for (const [, yb] of yamlBlocks) {
  for (const dep of yb.extraDeps) {
    if (!blockMap.has(dep)) continue;
    const key = `${dep}→${yb.id}`;
    if (!edgeSet.has(key) && blockMap.has(yb.id)) {
      edgeSet.add(key); edges.push({ from: dep, to: yb.id });
    }
  }
}

// ── levels ────────────────────────────────────────────────────────────────────
const ids = [...blockMap.keys()];
const depMap = new Map(ids.map(id => [id, []]));
for (const e of edges) depMap.get(e.to)?.push(e.from);

const levels = new Map();
function levelOf(id, stack) {
  if (levels.has(id)) return levels.get(id);
  if (stack.has(id)) return 0;
  stack.add(id);
  const deps = depMap.get(id) ?? [];
  const lv = deps.length === 0 ? 0 : Math.max(...deps.map(d => levelOf(d, new Set(stack)))) + 1;
  stack.delete(id); levels.set(id, lv); return lv;
}
for (const id of ids) levelOf(id, new Set());

// ── status ────────────────────────────────────────────────────────────────────
function heuristicStatus(files) {
  const codeFiles = [...files].filter(f => CODE_EXTS.has(path.extname(f)));
  if (!codeFiles.length) return "planned";
  let nb = 0, todo = false, any = false;
  for (const f of codeFiles) {
    try {
      const t = fs.readFileSync(path.join(root, f), "utf8");
      if (t.trim()) any = true;
      for (const l of t.split(/\r?\n/)) if (l.trim()) nb++;
      if (TODO_RE.test(t)) todo = true;
    } catch {}
  }
  if (!any) return "planned";
  if (todo || nb < STUB_THRESHOLD) return "wip";
  return "done";
}

const blocks = ids.map(id => {
  const yb = yamlBlocks.get(id);
  const files = blockMap.get(id);
  return {
    id, label: id,
    status: yb?.pinnedStatus ?? heuristicStatus(files),
    intent: yb?.intent ?? "",
    fileCount: files.size,
    level: levels.get(id) ?? 0,
    deps: edges.filter(e => e.to === id).map(e => e.from),
  };
}).sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));

const statusById = new Map(blocks.map(b => [b.id, b.status]));
const ready = blocks
  .filter(b => b.status !== "done")
  .filter(b => b.deps.every(d => statusById.get(d) === "done"))
  .map(b => b.id);

const claimed = new Set(allFiles.map(blockId).filter(Boolean));
const untracked = allFiles.filter(f => !claimed.has(blockId(f))).sort();

// ── print ─────────────────────────────────────────────────────────────────────
console.log(`${C.bold}Vibe Arch${C.reset}  ${C.dim}madge engine${C.reset}\n`);

const byLevel = new Map();
for (const b of blocks) {
  if (!byLevel.has(b.level)) byLevel.set(b.level, []);
  byLevel.get(b.level).push(b);
}

for (const [lv, lvBlocks] of [...byLevel.entries()].sort((a,b) => a[0]-b[0])) {
  console.log(`${C.dim}── Level ${lv} ──${C.reset}`);
  for (const b of lvBlocks) {
    const pin = yamlBlocks.get(b.id)?.pinnedStatus ? " [pinned]" : "";
    const intent = b.intent ? `  ${C.dim}${b.intent}${C.reset}` : "";
    console.log(`  ${COL[b.status]}${SYM[b.status]} ${b.id}${C.reset} (${b.status})${pin} · ${b.fileCount} files${intent}`);
    if (b.deps.length) console.log(`    ${C.dim}deps: ${b.deps.join(", ")}${C.reset}`);
  }
}

if (edges.length) {
  console.log(`\n${C.bold}Edges${C.reset} (${edges.length})`);
  for (const e of edges) console.log(`  ${C.dim}${e.from}${C.reset} → ${e.to}`);
}

console.log(`\n${C.bold}Ready to work on${C.reset}`);
if (!ready.length) console.log(`  ${C.dim}(none)${C.reset}`);
else ready.forEach(id => console.log(`  ${C.cyan}→ ${id}${C.reset}`));

const done = blocks.filter(b => b.status === "done").length;
console.log(`\n${C.bold}Progress${C.reset} ${Math.round(done/blocks.length*100)}%  (${done}/${blocks.length} done)\n`);
