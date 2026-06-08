import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// ── System prompt (user-defined architecture analysis) ───────────────────────

const SYSTEM_PROMPT = `You are a senior software architect. Analyze THIS codebase and produce a coarse, concept-level architecture decomposition.

Group the code by RESPONSIBILITY / CONCERN, not by folder. A "block" is a meaningful module (e.g. "identity layer", "drift control", "API routing"), even if its files are spread across directories. Aim for 6 to 15 blocks total. Do not go file-by-file.

Rules:
- Every block MUST map to real files/globs that actually exist in this repo. Do not invent paths.
- Assign every significant source file to exactly one block. If something doesn't fit, list it under unassigned.
- Keep block ids as stable lowercase slugs (e.g. drift_control). These ids are an identity that must stay constant across future runs.
- depends_on uses block ids only.
- Output ONLY valid YAML in the schema below. No prose, no markdown fences, no code blocks.

CRITICAL — the intent field must be a precise contract, not a vague label:
  - State WHAT it does (the concrete responsibility)
  - State what inputs/outputs it handles if relevant
  - State what "done" looks like for this block (e.g. "all error paths handled, typed, no TODOs")
  - Keep it under 20 words but be specific enough that an AI can audit code against it later

Output schema (block ids as map keys, NOT a list):

blocks:
  scenarios:
    label: "Character Scenarios"
    intent: "exports typed character configs (name/role/opening); done when all chars have full fields and no stubs"
    paths:
      - lib/scenarios.ts
    depends_on: []
  chat_api:
    label: "Chat API"
    intent: "streams AI character responses over HTTP; done when retry, error handling, and token limits are implemented"
    paths:
      - app/api/chat/**
    depends_on:
      - scenarios
unassigned:
  - src/lib/audioCache.ts`;

// ── Context constants ────────────────────────────────────────────────────────

const EXCLUDED = new Set([
  "node_modules", ".git", ".next", "out", "dist", "build",
  ".vercel", "public", ".github", ".vscode", "vibe-arch",
  "__pycache__", ".turbo", "coverage", ".cache",
]);
const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".py"]);
const MAX_CONTEXT_CHARS = 24_000;

// ── Public: generate manifest via VS Code LM API ─────────────────────────────

export async function generateManifest(
  root: string,
  existingYaml: string,
  token: vscode.CancellationToken,
  onChunk: (chunk: string) => void
): Promise<string> {
  const models = await vscode.lm.selectChatModels({});
  if (!models.length) {
    throw new NoModelError();
  }

  const model = models[0];
  const userContent = buildContext(root, existingYaml);
  const messages = [
    vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT + "\n\n---\n\n" + userContent),
  ];

  const response = await model.sendRequest(messages, {}, token);

  let yaml = "";
  for await (const chunk of response.text) {
    yaml += chunk;
    onChunk(chunk);
    if (token.isCancellationRequested) break;
  }

  // Strip markdown fences if model adds them despite instructions
  return yaml
    .replace(/^```ya?ml\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

// ── Public: build full prompt string (for copy-paste fallback) ───────────────

export function buildPromptText(root: string, existingYaml: string): string {
  return SYSTEM_PROMPT + "\n\n---\n\n" + buildContext(root, existingYaml);
}

// ── NoModelError (thrown when VS Code LM API has no models) ──────────────────

export class NoModelError extends Error {
  constructor() {
    super("No AI model available in VS Code. Install GitHub Copilot, or use the copy-prompt fallback.");
    this.name = "NoModelError";
  }
}

// ── Context builder ───────────────────────────────────────────────────────────

function buildContext(root: string, existingYaml: string): string {
  const parts: string[] = [];

  // 1. Project identity
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
      parts.push(`## Project\nname: ${pkg.name ?? "unknown"}\nscripts: ${JSON.stringify(Object.keys(pkg.scripts ?? {}))}\ndeps: ${JSON.stringify(deps.slice(0, 40))}`);
    } catch {}
  }

  // 2. File tree (depth 3, code files only)
  parts.push("## File tree\n```\n" + buildTree(root, 0, 3) + "```");

  // 3. Key file snippets
  const snippets = collectSnippets(root, MAX_CONTEXT_CHARS - parts.join("\n").length);
  if (snippets) parts.push("## Key file contents (truncated)\n" + snippets);

  // 4. Existing manifest
  if (existingYaml.trim()) {
    parts.push(`## EXISTING_MANIFEST (keep block ids stable; only change what genuinely changed):\n${existingYaml}`);
  } else {
    parts.push("## EXISTING_MANIFEST:\n(none — this is the first run)");
  }

  return parts.join("\n\n");
}

function buildTree(dir: string, depth: number, maxDepth: number): string {
  if (depth >= maxDepth) return "";
  let out = "";
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ""; }

  for (const ent of entries.slice(0, 60)) {
    if (ent.name.startsWith(".") && depth > 0) continue;
    if (EXCLUDED.has(ent.name)) continue;
    const indent = "  ".repeat(depth);
    if (ent.isDirectory()) {
      out += `${indent}${ent.name}/\n`;
      out += buildTree(path.join(dir, ent.name), depth + 1, maxDepth);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name);
      if (CODE_EXTS.has(ext) || ent.name === "package.json" || ent.name.endsWith(".yaml")) {
        out += `${indent}${ent.name}\n`;
      }
    }
  }
  return out;
}

function collectSnippets(root: string, charBudget: number): string {
  const keyFiles = resolveKeyFiles(root);
  let out = "";
  let used = 0;

  for (const rel of keyFiles) {
    if (used >= charBudget) break;
    try {
      const content = fs.readFileSync(path.join(root, rel), "utf8");
      const lines = content.split("\n").slice(0, 40).join("\n");
      const block = `### ${rel}\n\`\`\`\n${lines}\n\`\`\`\n`;
      if (used + block.length > charBudget) break;
      out += block;
      used += block.length;
    } catch {}
  }
  return out;
}

function resolveKeyFiles(root: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  // Priority entry points
  for (const p of ["index.ts","index.tsx","index.js","src/index.ts","src/index.js","src/main.ts","src/app.ts","app/page.tsx","app/layout.tsx"]) {
    if (fs.existsSync(path.join(root, p)) && !seen.has(p)) {
      files.push(p); seen.add(p);
    }
  }

  // First 2 files from each top-level dir
  try {
    for (const ent of fs.readdirSync(root, { withFileTypes: true }).slice(0, 20)) {
      if (!ent.isDirectory() || EXCLUDED.has(ent.name) || ent.name.startsWith(".")) continue;
      const dirAbs = path.join(root, ent.name);
      let count = 0;
      for (const sub of fs.readdirSync(dirAbs, { withFileTypes: true }).slice(0, 10)) {
        if (!sub.isFile()) continue;
        if (count >= 2) break;
        const ext = path.extname(sub.name);
        if (!CODE_EXTS.has(ext) || sub.name.endsWith(".d.ts")) continue;
        const rel = `${ent.name}/${sub.name}`;
        if (!seen.has(rel)) { files.push(rel); seen.add(rel); count++; }
      }
    }
  } catch {}

  return files;
}
