1import * as path from "path";
import * as fs from "fs";
import madge from "madge";
import type { BlockState, PanelState, ResolvedStatus } from "./types";
import type { YamlBlockOverride } from "./manifest";

// ── Config ───────────────────────────────────────────────────────────────────

const EXCLUDED_FIRST_SEGMENTS = new Set([
  "node_modules", ".git", ".next", "out", "dist", "build",
  ".vercel", "public", ".github", ".vscode", "vibe-arch",
  "__pycache__", ".turbo", "coverage", ".cache",
  "storybook-static", ".parcel-cache",
]);

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const STUB_LINE_THRESHOLD = 15;
const TODO_RE = /\b(TODO|FIXME|XXX)\b|@stub/i;

// ── WIP scoring signals ───────────────────────────────────────────────────────
// Each returns a score; total >= WIP_SCORE_THRESHOLD → wip regardless of line count

const WIP_SCORE_THRESHOLD = 5;

function wipScore(text: string, ext: string): number {
  let score = 0;

  // Definitive: single hit is enough
  if (/throw new Error\(['"`]not implemented/i.test(text)) score += 10;
  if (/throw new Error\(['"`]todo/i.test(text))            score += 10;

  // Strong: each occurrence adds weight
  const emptyCatches = (text.match(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g) ?? []).length;
  score += emptyCatches * 4;
  score += (text.match(/\/\/\s*HACK\b/gi) ?? []).length * 3;

  // Medium: diminishing returns
  score += Math.min((text.match(/@ts-ignore/g) ?? []).length * 2, 6);

  // Weak: only meaningful in TS, capped
  if (ext === ".ts" || ext === ".tsx") {
    score += Math.min((text.match(/:\s*any\b/g) ?? []).length, 4);
  }
  score += Math.min((text.match(/console\.(log|warn|debug)\(/g) ?? []).length, 3);

  return score;
}

export interface ScanOptions {
  sourceRoot?: string;
  yamlBlocks?: YamlBlockOverride[];
  yamlInclude?: string[];
  yamlExclude?: string[];
  isAiMode?: boolean;
  unassigned?: string[];
}

// ── Public entry — routes to AI mode or madge mode ───────────────────────────

export async function scanWorkspace(
  root: string,
  opts: ScanOptions = {}
): Promise<Omit<PanelState, "pulseBlockIds">> {
  if (opts.isAiMode && opts.yamlBlocks?.length) {
    return scanAiMode(root, opts);
  }
  return scanMadgeMode(root, opts);
}

// ── AI mode: blocks fully defined by yaml paths + depends_on ─────────────────

async function scanAiMode(
  root: string,
  opts: ScanOptions
): Promise<Omit<PanelState, "pulseBlockIds">> {
  const blocks = opts.yamlBlocks!;
  const blockStates: BlockState[] = [];

  for (const yb of blocks) {
    const matchedFiles = resolveGlobPaths(root, yb.paths ?? []);
    const status = yb.pinnedStatus ?? heuristicStatus(matchedFiles, root);
    blockStates.push({
      id: yb.id,
      label: yb.label ?? yb.id,
      status,
      intent: yb.intent ?? "",
      fileCount: matchedFiles.length,
      level: 0, // computed below
      deps: yb.extraDeps ?? [],
      matchedFiles,
    });
  }

  // Edges from explicit depends_on
  const validIds = new Set(blockStates.map((b) => b.id));
  const edges: { from: string; to: string }[] = [];
  const seen = new Set<string>();
  for (const b of blockStates) {
    for (const dep of b.deps) {
      if (!validIds.has(dep)) continue;
      const key = `${dep}→${b.id}`;
      if (!seen.has(key)) { seen.add(key); edges.push({ from: dep, to: b.id }); }
    }
  }

  const levels = computeLevels(blockStates.map((b) => b.id), edges);
  for (const b of blockStates) b.level = levels.get(b.id) ?? 0;

  const claimed = new Set(blockStates.flatMap((b) => b.matchedFiles));
  const untrackedFiles = [...(opts.unassigned ?? []), ...walkAllCodeFiles(root).filter((f) => !claimed.has(f))];

  const statusById = new Map(blockStates.map((b) => [b.id, b.status]));
  const readyToWorkOn = blockStates
    .filter((b) => b.status !== "done")
    .filter((b) => b.deps.every((d) => statusById.get(d) === "done"))
    .map((b) => b.id);

  return { blocks: blockStates, edges, readyToWorkOn, untrackedFiles: [...new Set(untrackedFiles)].sort(), error: null, scannedRoot: "" };
}

// ── Glob resolver (used by AI mode) ──────────────────────────────────────────

function globToRegex(glob: string): RegExp {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*"; i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += ".";
    } else if ("{}+^$[]\\.|()".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(re + "$");
}

function walkAllCodeFiles(root: string): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.name.startsWith(".") || EXCLUDED_FIRST_SEGMENTS.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && CODE_EXTS.has(path.extname(ent.name)) && !ent.name.endsWith(".d.ts")) {
        results.push(path.relative(root, abs).replace(/\\/g, "/"));
      }
    }
  }
  walk(root);
  return results;
}

function resolveGlobPaths(root: string, patterns: string[]): string[] {
  const allFiles = walkAllCodeFiles(root);
  const result: string[] = [];
  for (const pat of patterns) {
    const isExact = !(/[*?[\]{}]/.test(pat));
    if (isExact) {
      if (fs.existsSync(path.join(root, pat))) {
        // could be a file or directory
        const stat = fs.statSync(path.join(root, pat));
        if (stat.isDirectory()) {
          result.push(...allFiles.filter((f) => f.startsWith(pat + "/")));
        } else {
          result.push(pat);
        }
      }
    } else {
      const re = globToRegex(pat);
      result.push(...allFiles.filter((f) => re.test(f)));
    }
  }
  return [...new Set(result)];
}

// ── Madge mode (renamed from old scanWorkspace body) ─────────────────────────

async function scanMadgeMode(
  root: string,
  opts: ScanOptions
): Promise<Omit<PanelState, "pulseBlockIds">> {
  const srcRoot = opts.sourceRoot ? path.join(root, opts.sourceRoot) : root;

  // 1. Run madge to get file-level dependency graph
  const fileGraph = await runMadge(srcRoot, root);

  // 2. Derive blocks (folder = block, root-level code file = block)
  const allFiles = Object.keys(fileGraph);
  const blocks = deriveBlocks(allFiles, srcRoot, root);

  // 3. Assign files to blocks
  for (const relFile of allFiles) {
    const bid = blockIdForFile(relFile, srcRoot, root);
    const block = blocks.find((b) => b.id === bid);
    if (block && !block.matchedFiles.includes(relFile)) {
      block.matchedFiles.push(relFile);
    }
  }

  // 4. Compute block-level edges from file-level graph
  const rawEdges = computeBlockEdges(blocks, fileGraph, srcRoot, root);

  // 5. Merge yaml extra deps
  const yamlById = new Map((opts.yamlBlocks ?? []).map((b) => [b.id, b]));
  const edgeSet = new Set(rawEdges.map((e) => `${e.from}→${e.to}`));
  for (const yb of opts.yamlBlocks ?? []) {
    for (const dep of yb.extraDeps ?? []) {
      const key = `${dep}→${yb.id}`;
      if (!edgeSet.has(key) && blocks.some((b) => b.id === dep)) {
        edgeSet.add(key);
        rawEdges.push({ from: dep, to: yb.id });
      }
    }
  }

  // Filter to only valid block ids
  const validIds = new Set(blocks.map((b) => b.id));
  const finalEdges = rawEdges.filter(
    (e) => validIds.has(e.from) && validIds.has(e.to)
  );

  // 6. Levels via topological sort
  const levels = computeLevels(
    blocks.map((b) => b.id),
    finalEdges
  );

  // 7. Build block states with status
  const blockStates: BlockState[] = blocks.map((b) => {
    const yaml = yamlById.get(b.id);
    return {
      id: b.id,
      label: b.id,
      status: yaml?.pinnedStatus ?? heuristicStatus(b.matchedFiles, root),
      intent: yaml?.intent ?? "",
      fileCount: b.matchedFiles.length,
      level: levels.get(b.id) ?? 0,
      deps: finalEdges.filter((e) => e.to === b.id).map((e) => e.from),
      matchedFiles: b.matchedFiles,
    };
  });

  // 8. Untracked: files in madge graph not claimed by any block
  const claimed = new Set(blocks.flatMap((b) => b.matchedFiles));
  const untrackedFiles = allFiles.filter((f) => !claimed.has(f)).sort();

  const statusById = new Map(blockStates.map((b) => [b.id, b.status]));
  const readyToWorkOn = blockStates
    .filter((b) => b.status !== "done")
    .filter((b) => b.deps.every((d) => statusById.get(d) === "done"))
    .map((b) => b.id);

  return {
    blocks: blockStates,
    edges: finalEdges,
    readyToWorkOn,
    untrackedFiles,
    error: null,
    scannedRoot: "",
  };
}

// ── madge wrapper ─────────────────────────────────────────────────────────────

async function runMadge(
  srcRoot: string,
  workspaceRoot: string
): Promise<Record<string, string[]>> {
  const tsConfigPath = path.join(workspaceRoot, "tsconfig.json");
  const excludeRegExp = [
    /node_modules/,
    /\.d\.ts$/,
    /[/\\]\.next[/\\]/,
    /[/\\]out[/\\]/,
    /[/\\]dist[/\\]/,
    /[/\\]vibe-arch[/\\]/,
    /[/\\]build[/\\]/,
  ];

  try {
    const result = await madge(srcRoot, {
      fileExtensions: ["ts", "tsx", "js", "jsx", "mjs"],
      tsConfig: fs.existsSync(tsConfigPath) ? tsConfigPath : undefined,
      excludeRegExp,
      // paths relative to srcRoot
      baseDir: srcRoot,
    });
    return result.obj();
  } catch {
    // madge can fail on malformed files — fall back to empty graph
    return {};
  }
}

// ── Block derivation from file paths ─────────────────────────────────────────

interface RawBlock {
  id: string;
  isDir: boolean;
  matchedFiles: string[];
}

function deriveBlocks(
  relFiles: string[],   // relative to workspaceRoot
  srcRoot: string,
  workspaceRoot: string
): RawBlock[] {
  const seen = new Map<string, RawBlock>();

  for (const relFile of relFiles) {
    const bid = blockIdForFile(relFile, srcRoot, workspaceRoot);
    if (!bid) continue;
    if (!seen.has(bid)) {
      // A block is a dir if the first segment has a path separator after it,
      // i.e., the file is nested inside a folder.
      const firstSeg = relFile.split("/")[0];
      const isDir = relFile.includes("/");
      seen.set(bid, { id: bid, isDir, matchedFiles: [] });
    }
  }

  return [...seen.values()].filter(
    (b) => !EXCLUDED_FIRST_SEGMENTS.has(b.id)
  );
}

function blockIdForFile(
  relFile: string,    // relative to workspaceRoot
  srcRoot: string,
  workspaceRoot: string
): string {
  // If srcRoot !== workspaceRoot, relFile is relative to srcRoot already (from madge)
  const segments = relFile.replace(/\\/g, "/").split("/");
  const first = segments[0];

  if (EXCLUDED_FIRST_SEGMENTS.has(first)) return "";

  // Directory block: first segment
  if (segments.length > 1) return first;

  // Root-level file block: filename without extension
  const ext = path.extname(first);
  if (CODE_EXTS.has(ext) && !first.endsWith(".d.ts")) {
    return first.replace(/\.[^.]+$/, "");
  }
  return "";
}

// ── Block-level edge computation ──────────────────────────────────────────────

function computeBlockEdges(
  blocks: RawBlock[],
  fileGraph: Record<string, string[]>,
  srcRoot: string,
  workspaceRoot: string
): { from: string; to: string }[] {
  const edges: { from: string; to: string }[] = [];
  const seen = new Set<string>();
  const validIds = new Set(blocks.map((b) => b.id));

  for (const [file, deps] of Object.entries(fileGraph)) {
    const fromBlock = blockIdForFile(file, srcRoot, workspaceRoot);
    if (!fromBlock || !validIds.has(fromBlock)) continue;

    for (const dep of deps) {
      const toBlock = blockIdForFile(dep, srcRoot, workspaceRoot);
      if (!toBlock || !validIds.has(toBlock) || toBlock === fromBlock) continue;

      // edge: toBlock (dependency) → fromBlock (dependent)
      const key = `${toBlock}→${fromBlock}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ from: toBlock, to: fromBlock });
      }
    }
  }

  return edges;
}

// ── Status heuristic ──────────────────────────────────────────────────────────

export function heuristicStatus(files: string[], root: string): ResolvedStatus {
  const codeFiles = files.filter(
    (f) => CODE_EXTS.has(path.extname(f)) && !f.endsWith(".d.ts")
  );
  if (!codeFiles.length) return "planned";

  let totalNonBlank = 0;
  let hasTodo = false;
  let anyContent = false;
  let totalWipScore = 0;

  for (const rel of codeFiles) {
    try {
      const text = fs.readFileSync(path.join(root, rel), "utf8");
      const ext = path.extname(rel);
      if (text.trim()) anyContent = true;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) totalNonBlank++;
      }
      if (TODO_RE.test(text)) hasTodo = true;
      totalWipScore += wipScore(text, ext);
    } catch {}
  }

  if (!anyContent) return "planned";
  if (hasTodo || totalNonBlank < STUB_LINE_THRESHOLD || totalWipScore >= WIP_SCORE_THRESHOLD) {
    return "wip";
  }
  return "done";
}

// ── Level computation (topological) ──────────────────────────────────────────

function computeLevels(
  ids: string[],
  edges: { from: string; to: string }[]
): Map<string, number> {
  // depMap[X] = blocks that X depends on (edge.to === X → edge.from is a dep)
  const depMap = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    depMap.get(e.to)?.push(e.from);
  }

  const levels = new Map<string, number>();
  function levelOf(id: string, stack: Set<string>): number {
    if (levels.has(id)) return levels.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    const deps = depMap.get(id) ?? [];
    const lv =
      deps.length === 0
        ? 0
        : Math.max(...deps.map((d) => levelOf(d, new Set(stack)))) + 1;
    stack.delete(id);
    levels.set(id, lv);
    return lv;
  }

  for (const id of ids) levelOf(id, new Set());
  return levels;
}

// ── For pulse: which blocks own a given file ──────────────────────────────────

export function blocksForFile(blocks: BlockState[], relPath: string): string[] {
  const norm = relPath.replace(/\\/g, "/");
  return blocks
    .filter((b) => b.matchedFiles.some((f) => f.replace(/\\/g, "/") === norm))
    .map((b) => b.id);
}
