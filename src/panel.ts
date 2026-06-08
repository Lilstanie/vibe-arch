import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { loadManifest, writeBlockStatus } from "./manifest";
import { blocksForFile, scanWorkspace } from "./scanner";
import { buildPromptText, generateManifest, NoModelError } from "./llm";
import type { PanelState, ResolvedStatus, WebviewOutbound } from "./types";

const STATUS_CYCLE: ResolvedStatus[] = ["planned", "wip", "done"];

export class VibeArchPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "vibeArch.panel";

  private view?: vscode.WebviewView;
  private lastState: PanelState | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private pulseTimer: ReturnType<typeof setTimeout> | undefined;
  private targetRoot: string | undefined;

  constructor(private readonly extUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extUri, "media")],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewOutbound) => {
      if (msg.type === "ready") {
        await this.refresh();
      } else if (msg.type === "cycleStatus") {
        await this.handleCycleStatus(msg.blockId);
      } else if (msg.type === "pickFolder") {
        await this.handlePickFolder();
      } else if (msg.type === "generate") {
        await this.handleGenerate();
      } else if (msg.type === "copyPrompt") {
        await this.handleCopyPrompt();
      }
    });

    void this.refresh();
  }

  scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    // madge is slower than regex — use a longer debounce
    this.refreshTimer = setTimeout(() => void this.refresh(), 800);
  }

  async onActiveEditor(uri: vscode.Uri | undefined): Promise<void> {
    if (!uri || !this.lastState) return;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !uri.fsPath.startsWith(root)) return;

    const rel = path.relative(root, uri.fsPath).replace(/\\/g, "/");
    const blockIds = blocksForFile(this.lastState.blocks, rel);
    if (!blockIds.length) return;

    this.post({ type: "pulse", blockIds });

    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    this.pulseTimer = setTimeout(() => {
      if (this.lastState) {
        this.post({ type: "update", state: { ...this.lastState, pulseBlockIds: [] } });
      }
    }, 1200);
  }

  async refresh(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const root = this.targetRoot ?? workspaceRoot;

    if (!root) {
      this.postError("No folder selected. Click ⌂ to pick a project.");
      return;
    }
    const { overrides, error: manifestError } = loadManifest(root);
    if (manifestError) {
      this.postError(manifestError);
      return;
    }

    try {
      const scanned = await scanWorkspace(root, {
        sourceRoot: overrides.sourceRoot,
        yamlBlocks: overrides.yamlBlocks,
        yamlInclude: overrides.include,
        yamlExclude: overrides.exclude,
        isAiMode: overrides.isAiMode,
        unassigned: overrides.unassigned,
      });
      const state: PanelState = { ...scanned, pulseBlockIds: [], scannedRoot: path.basename(root) };
      this.lastState = state;
      this.post({ type: "update", state });
    } catch (e) {
      this.postError(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private generateCancellation: vscode.CancellationTokenSource | undefined;

  private async handleGenerate(): Promise<void> {
    const root = this.targetRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { this.postError("No folder selected. Click ⌂ to pick a project."); return; }

    // Cancel any ongoing generation
    this.generateCancellation?.cancel();
    this.generateCancellation = new vscode.CancellationTokenSource();

    const yamlPath = path.join(root, "vibe-arch.yaml");
    const existingYaml = fs.existsSync(yamlPath) ? fs.readFileSync(yamlPath, "utf8") : "";

    // Show generating state
    if (this.lastState) {
      this.post({ type: "update", state: { ...this.lastState, generating: true, generatingChunk: "" } });
    }

    try {
      const yamlText = await generateManifest(
        root,
        existingYaml,
        this.generateCancellation.token,
        (chunk) => {
          if (this.lastState) {
            const prev = this.lastState.generatingChunk ?? "";
            this.post({ type: "update", state: { ...this.lastState, generating: true, generatingChunk: prev + chunk } });
          }
        }
      );

      fs.writeFileSync(yamlPath, yamlText, "utf8");
      vscode.window.showInformationMessage("Vibe Arch: Architecture generated ✓");
      await this.refresh();
    } catch (e) {
      if (e instanceof NoModelError) {
        // Fallback: show the prompt in an editor tab
        const doc = await vscode.workspace.openTextDocument({
          language: "markdown",
          content: buildPromptText(root, existingYaml),
        });
        await vscode.window.showTextDocument(doc);
        vscode.window.showWarningMessage(
          "No AI model found. The prompt is open — run it with any AI and paste the YAML output back as vibe-arch.yaml in your project root."
        );
      } else {
        vscode.window.showErrorMessage(`Vibe Arch generate error: ${e instanceof Error ? e.message : String(e)}`);
      }
      // Restore previous state without generating flag
      await this.refresh();
    }
  }

  private async handleCopyPrompt(): Promise<void> {
    const root = this.targetRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    const yamlPath = path.join(root, "vibe-arch.yaml");
    const existingYaml = fs.existsSync(yamlPath) ? fs.readFileSync(yamlPath, "utf8") : "";
    const prompt = buildPromptText(root, existingYaml);
    await vscode.env.clipboard.writeText(prompt);
    vscode.window.showInformationMessage("Vibe Arch: Full prompt copied to clipboard ✓");
  }

  private async handlePickFolder(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Scan this project",
    });
    if (!uris?.length) return;
    this.targetRoot = uris[0].fsPath;
    await this.refresh();
  }

  private async handleCycleStatus(blockId: string): Promise<void> {
    const root = this.targetRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;

    const current = this.lastState?.blocks.find((b) => b.id === blockId);
    const currentStatus: ResolvedStatus = current?.status ?? "planned";
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(currentStatus) + 1) % STATUS_CYCLE.length];

    writeBlockStatus(root, blockId, next);
    await this.refresh();
  }

  private postError(message: string): void {
    const root = this.targetRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const state: PanelState = {
      blocks: [], edges: [], readyToWorkOn: [],
      untrackedFiles: [], error: message, pulseBlockIds: [],
      scannedRoot: root ? path.basename(root) : "",
    };
    this.lastState = state;
    this.post({ type: "update", state });
  }

  private post(message: { type: string; state?: PanelState; blockIds?: string[] }): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extUri, "media", "webview.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extUri, "media", "webview.css")
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="error" class="error hidden"></div>

  <div class="p-head">
    <div class="p-title">
      <h1>VIBE ARCH</h1>
      <span class="live-dot"></span>
    </div>
    <div class="folder-row">
      <span id="folderName" class="folder-name">—</span>
      <button id="pickFolder" class="pick-btn" title="Pick a project folder">⌂</button>
      <button id="generateBtn" class="gen-btn" title="Generate architecture with AI">⚡ Generate</button>
      <button id="copyPromptBtn" class="copy-btn" title="Copy prompt to clipboard">📋</button>
    </div>
    <div class="prog-meta">
      <span>completion</span>
      <span><b id="pPct">0%</b> · <span id="pCnt">0/0</span> done</span>
    </div>
    <div class="prog"><div class="fill" id="pFill"></div></div>
  </div>

  <div id="genOverlay" class="gen-overlay hidden">
    <div class="gen-spinner"></div>
    <div class="gen-label">Analyzing codebase…</div>
    <pre id="genStream" class="gen-stream"></pre>
  </div>

  <div class="map" id="map">
    <svg id="edges" aria-hidden="true"></svg>
    <div id="layers"></div>
  </div>

  <div class="legend">
    <span><i class="lg-done"></i> done</span>
    <span><i class="lg-wip"></i> wip · has TODO</span>
    <span><i class="lg-plan"></i> planned · empty</span>
  </div>

  <div class="sect">
    <h2>Ready to work on <span class="cnt" id="readyCnt">0</span></h2>
    <div id="readyList"></div>
  </div>

  <div class="sect">
    <h2>Untracked files <span class="cnt" id="untrackedCnt">0</span></h2>
    <div id="untrackedList"></div>
  </div>

  <div class="hint">click a <b>block</b> to cycle its status</div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let n = "";
  for (let i = 0; i < 32; i++) n += chars[Math.floor(Math.random() * chars.length)];
  return n;
}
