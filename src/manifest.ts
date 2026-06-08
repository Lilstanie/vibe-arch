import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { ResolvedStatus } from "./types";

const MANIFEST_NAME = "vibe-arch.yaml";

export interface YamlBlockOverride {
  id: string;
  label?: string;
  intent?: string;
  paths?: string[];      // AI-generated: semantic grouping across dirs
  pinnedStatus?: ResolvedStatus;
  extraDeps?: string[];
}

export interface ManifestOverrides {
  sourceRoot?: string;
  yamlBlocks: YamlBlockOverride[];
  include?: string[];
  exclude: string[];
  unassigned: string[];  // from AI output
  isAiMode: boolean;     // true when any block has paths[]
}

export function loadManifest(root: string): {
  overrides: ManifestOverrides;
  error: string | null;
} {
  const filePath = path.join(root, MANIFEST_NAME);

  if (!fs.existsSync(filePath)) {
    return { overrides: { yamlBlocks: [], exclude: [], unassigned: [], isAiMode: false }, error: null };
  }

  let parsed: unknown;
  try {
    const text = fs.readFileSync(filePath, "utf8");
    parsed = yaml.load(text);
  } catch (e) {
    return {
      overrides: { yamlBlocks: [], exclude: [], unassigned: [], isAiMode: false },
      error: `vibe-arch.yaml parse error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return { overrides: { yamlBlocks: [], exclude: [], unassigned: [], isAiMode: false }, error: null };
  }

  const obj = parsed as Record<string, unknown>;
  const overrides: ManifestOverrides = {
    sourceRoot: typeof obj.sourceRoot === "string" ? obj.sourceRoot : undefined,
    yamlBlocks: [],
    include: Array.isArray(obj.include) ? (obj.include as string[]) : undefined,
    exclude: Array.isArray(obj.exclude) ? (obj.exclude as string[]) : [],
    unassigned: Array.isArray(obj.unassigned) ? (obj.unassigned as string[]) : [],
    isAiMode: false,
  };

  if (obj.blocks && typeof obj.blocks === "object" && !Array.isArray(obj.blocks)) {
    for (const [id, def] of Object.entries(obj.blocks as Record<string, unknown>)) {
      if (!def || typeof def !== "object") continue;
      const d = def as Record<string, unknown>;
      const yb: YamlBlockOverride = { id };
      if (typeof d.label === "string") yb.label = d.label;
      if (typeof d.intent === "string") yb.intent = d.intent;
      // paths: AI-generated multi-path array
      if (Array.isArray(d.paths)) yb.paths = d.paths as string[];
      const st = d.status as string;
      if (st === "planned" || st === "wip" || st === "done") yb.pinnedStatus = st;
      if (Array.isArray(d.depends_on)) yb.extraDeps = d.depends_on as string[];
      overrides.yamlBlocks.push(yb);
    }
  }

  overrides.isAiMode = overrides.yamlBlocks.some((b) => (b.paths?.length ?? 0) > 0);
  return { overrides, error: null };
}

export function writeBlockStatus(
  root: string,
  blockId: string,
  status: ResolvedStatus
): void {
  const filePath = path.join(root, MANIFEST_NAME);

  let doc: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      doc = (yaml.load(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>) ?? {};
    } catch {
      doc = {};
    }
  }

  if (!doc.blocks || typeof doc.blocks !== "object") doc.blocks = {};
  const blocks = doc.blocks as Record<string, Record<string, unknown>>;
  if (!blocks[blockId]) blocks[blockId] = {};
  blocks[blockId].status = status;

  try {
    fs.writeFileSync(filePath, yaml.dump(doc, { lineWidth: 100, noRefs: true }), "utf8");
  } catch {}
}
