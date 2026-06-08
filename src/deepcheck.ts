import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { BlockState } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeepVerdict {
  status: "done" | "wip" | "planned";
  confidence: "high" | "medium" | "low";
  missing: string[];
  reason: string;
}

// ── Per-block audit prompt ────────────────────────────────────────────────────

function buildAuditPrompt(block: BlockState, codeSnippet: string): string {
  return `You are auditing a software module against its declared intent.

Module id: ${block.id}
Label: ${block.label}
Intent: ${block.intent || "(no intent declared — infer from code what it should do, then assess)"}

Source code (truncated):
${codeSnippet}

Assess whether this module FULLY implements its intent. Be critical — look for:
- Stubbed or missing logic
- TODO/FIXME/not-implemented throws
- Empty error handlers
- Functions that exist but do nothing meaningful
- Missing edge cases the intent implies

Return ONLY valid YAML, no prose, no fences:
status: done
confidence: high
missing: []
reason: "one sentence"

OR if incomplete:
status: wip
confidence: medium
missing:
  - "specific thing missing"
reason: "one sentence"`;
}

// ── Code collector ────────────────────────────────────────────────────────────

const MAX_CHARS_PER_BLOCK = 4000;
const MAX_LINES_PER_FILE = 60;
const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".py"]);

function collectBlockCode(block: BlockState, root: string): string {
  const codeFiles = block.matchedFiles.filter(
    (f) => CODE_EXTS.has(path.extname(f)) && !f.endsWith(".d.ts")
  );

  // Prioritise: index files, then shorter files first
  const sorted = [...codeFiles].sort((a, b) => {
    const aIndex = path.basename(a).startsWith("index") ? -1 : 0;
    const bIndex = path.basename(b).startsWith("index") ? -1 : 0;
    return aIndex - bIndex;
  });

  let out = "";
  for (const rel of sorted) {
    if (out.length >= MAX_CHARS_PER_BLOCK) break;
    try {
      const lines = fs.readFileSync(path.join(root, rel), "utf8")
        .split("\n")
        .slice(0, MAX_LINES_PER_FILE)
        .join("\n");
      const block = `\n### ${rel}\n\`\`\`\n${lines}\n\`\`\`\n`;
      if (out.length + block.length > MAX_CHARS_PER_BLOCK) {
        // Partial append
        out += block.slice(0, MAX_CHARS_PER_BLOCK - out.length) + "\n…";
        break;
      }
      out += block;
    } catch {}
  }
  return out || "(no readable source files)";
}

// ── YAML verdict parser ───────────────────────────────────────────────────────

function parseVerdict(raw: string): DeepVerdict {
  const clean = raw.replace(/^```ya?ml\s*/i, "").replace(/\s*```$/i, "").trim();

  const statusMatch  = clean.match(/^status:\s*(done|wip|planned)/m);
  const confMatch    = clean.match(/^confidence:\s*(high|medium|low)/m);
  const reasonMatch  = clean.match(/^reason:\s*["']?(.+?)["']?\s*$/m);
  const missingLines = [...clean.matchAll(/^\s+-\s+"?(.+?)"?\s*$/gm)].map((m) => m[1]);

  return {
    status:     (statusMatch?.[1]  as DeepVerdict["status"])     ?? "wip",
    confidence: (confMatch?.[1]    as DeepVerdict["confidence"]) ?? "low",
    missing:    missingLines,
    reason:     reasonMatch?.[1] ?? "Could not parse AI response",
  };
}

// ── Single block check ────────────────────────────────────────────────────────

export async function deepCheckBlock(
  block: BlockState,
  root: string,
  token: vscode.CancellationToken
): Promise<DeepVerdict> {
  const models = await vscode.lm.selectChatModels({});
  if (!models.length) {
    throw new Error("No AI model available. Install GitHub Copilot to use Deep Check.");
  }

  const code   = collectBlockCode(block, root);
  const prompt = buildAuditPrompt(block, code);

  const messages = [vscode.LanguageModelChatMessage.User(prompt)];
  const response = await models[0].sendRequest(messages, {}, token);

  let raw = "";
  for await (const chunk of response.text) {
    raw += chunk;
    if (token.isCancellationRequested) break;
  }

  return parseVerdict(raw);
}

// ── All blocks — async generator so panel can stream results ─────────────────

export async function* deepCheckAll(
  blocks: BlockState[],
  root: string,
  token: vscode.CancellationToken
): AsyncGenerator<{ blockId: string; verdict: DeepVerdict }> {
  // Only check blocks that have files and an intent worth auditing
  const auditable = blocks.filter((b) => b.fileCount > 0);

  for (const block of auditable) {
    if (token.isCancellationRequested) return;
    try {
      const verdict = await deepCheckBlock(block, root, token);
      yield { blockId: block.id, verdict };
    } catch {
      // Skip block on error, continue with next
      yield {
        blockId: block.id,
        verdict: { status: "wip", confidence: "low", missing: [], reason: "Audit failed" },
      };
    }
  }
}
