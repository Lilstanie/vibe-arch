export type ResolvedStatus = "planned" | "wip" | "done";

export interface BlockState {
  id: string;
  label: string;
  status: ResolvedStatus;
  intent: string;
  fileCount: number;
  level: number;
  deps: string[];         // ids of blocks this block depends on
  matchedFiles: string[]; // relative paths
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
  | { type: "pulse"; blockIds: string[] };

export type WebviewOutbound =
  | { type: "ready" }
  | { type: "cycleStatus"; blockId: string }
  | { type: "pickFolder" }
  | { type: "generate" }
  | { type: "copyPrompt" };
