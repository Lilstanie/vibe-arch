import * as vscode from "vscode";
import { VibeArchPanelProvider } from "./panel";

let panelProvider: VibeArchPanelProvider | undefined;
const watchers: vscode.FileSystemWatcher[] = [];

export function activate(context: vscode.ExtensionContext): void {
  panelProvider = new VibeArchPanelProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      VibeArchPanelProvider.viewType,
      panelProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vibeArch.refresh", () => {
      void panelProvider?.refresh();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void panelProvider?.onActiveEditor(editor?.document.uri);
      panelProvider?.scheduleRefresh();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      panelProvider?.scheduleRefresh();
      const editor = vscode.window.activeTextEditor;
      if (editor) void panelProvider?.onActiveEditor(editor.document.uri);
    })
  );

  setupWatchers(context);
}

export function deactivate(): void {
  for (const w of watchers) w.dispose();
  watchers.length = 0;
}

function setupWatchers(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const manifestWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, "vibe-arch.yaml")
  );
  manifestWatcher.onDidChange(() => panelProvider?.scheduleRefresh());
  manifestWatcher.onDidCreate(() => panelProvider?.scheduleRefresh());
  manifestWatcher.onDidDelete(() => panelProvider?.scheduleRefresh());
  watchers.push(manifestWatcher);
  context.subscriptions.push(manifestWatcher);

  const codeWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, "**/*.{ts,tsx,js,jsx}")
  );
  const onCodeChange = () => panelProvider?.scheduleRefresh();
  codeWatcher.onDidChange(onCodeChange);
  codeWatcher.onDidCreate(onCodeChange);
  codeWatcher.onDidDelete(onCodeChange);
  watchers.push(codeWatcher);
  context.subscriptions.push(codeWatcher);
}
