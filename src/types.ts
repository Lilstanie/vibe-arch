export type ResolvedStatus = "planned" | "wip" | "done";

export interface DeepVerdict {
  status: "done" | "wip" | "planned";
  confidence: "high" | "medium" | "low";
  missing: string[];
  reason: string;
}

export interface BlockState {
  id: string;
  label: string;
  status: ResolvedStatus;
  intent: string;
  fileCount: number;
  level: number;
  deps: string[];         // ids of blocks this block depends on
  matchedFiles: string[]; // relative paths
  deepVerdict?: DeepVerdict; // set after deep check
}

export interface PanelState {
  blocks: BlockState[];
  edges: { from: string; to: string }[];
  readyToWorkOn: string[];
  untrackedFiles: string[];
  error: string | null;
  pulseBlockIds: string[];
  scannedRoot: string;
  generating?: boolean;
  generatingChunk?: string;
}

export type WebviewInbound =
  | { type: "update"; state: PanelState }
  | { type: "pulse"; blockIds: string[] }
  | { type: "deepCheckProgress"; blockId: string; verdict: DeepVerdict; progress: number; total: number }
  | { type: "deepCheckDone" };

export type WebviewOutbound =
  | { type: "ready" }
  | { type: "cycleStatus"; blockId: string }
  | { type: "pickFolder" }
  | { type: "generate" }
  | { type: "copyPrompt" }
  | { type: "deepCheck" };
