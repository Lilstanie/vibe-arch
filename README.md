# Vibe Arch

A VS Code / Cursor extension that turns any codebase into a live architecture map while you vibe-code.

![status](https://img.shields.io/badge/status-alpha-orange)

## What it does

Vibe coding tends to grow complex fast. Vibe Arch gives you a **passive, always-visible map** of your project — which modules exist, how they depend on each other, and how done each one is.

- **Auto-derive blocks** from folder structure (no config needed)
- **AI Generate** — one click to have an AI architect analyze the codebase by *responsibility*, not folder. Groups scattered files into semantic blocks like "Identity Layer" or "Streaming API"
- **Completion status** — `done` (green) / `wip` (amber) / `planned` (gray), inferred from code or pinned manually
- **Dependency graph** — import-based edges rendered as a layered DAG
- **Ready to work on** — highlights blocks whose deps are all done
- **Pick any folder** — scan any local project, not just the open workspace

## Quick start

```bash
git clone https://github.com/Lilstanie/vibe-arch.git
cd vibe-arch
npm install
npm run compile
```

Then in VS Code: `F5` to launch Extension Development Host, open any project, click the **Vibe Arch** icon in the Activity Bar.

Or point it at a specific project from the terminal:

```bash
code --extensionDevelopmentPath="$(pwd)" /path/to/your-project
```

## AI Generate

Click **⚡ Generate** in the panel. The extension:

1. Builds a compact snapshot of the codebase (file tree + key file snippets)
2. Sends it to your VS Code AI model (GitHub Copilot / GitHub Models) with a senior-architect prompt
3. Gets back a YAML manifest grouping files by *concern*, not folder
4. Saves it as `vibe-arch.yaml` and renders the map

No Copilot? Click **📋** to copy the full prompt to clipboard, run it with any AI (Claude, ChatGPT, local Ollama), and paste the returned YAML as `vibe-arch.yaml` in your project root.

## vibe-arch.yaml (optional override)

The extension works with zero config. The YAML file is only needed to:

- Pin a block's status manually
- Add intent descriptions
- Override AI-generated groupings

```yaml
blocks:
  chat_api:
    label: "Chat API"
    intent: "streaming Japanese character responses"
    paths:
      - app/api/chat/**
    depends_on:
      - scenarios
    status: done   # pin manually (planned / wip / done)
unassigned:
  - src/lib/orphan.ts
```

## Status colors

| Color | Meaning |
|-------|---------|
| 🟢 Green | Done — real content, no TODOs |
| 🟡 Amber | WIP — has TODO/FIXME, or fewer than 15 non-blank lines |
| ⚫ Gray | Planned — empty or no files yet |

Click any block in the panel to cycle its status manually.

## Stack

- VS Code Extension API (works in Cursor too)
- [madge](https://github.com/pahen/madge) for import-based dependency resolution
- VS Code Language Model API for AI generation
- Vanilla JS + SVG webview (no React, no bundler)

## License

MIT
