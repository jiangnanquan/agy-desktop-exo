# Antigravity Desktop Simplified Chinese Localization Engine (Windows / macOS / Linux)

**English** | [简体中文](README_ZH.md)

> **Supported Platforms**: Windows / macOS / Linux (Ubuntu and major distributions)
>
> **Target Language**: Simplified Chinese (`zh-CN`)
>
> **Localization Version**: `v2.33.0`
>
> **Compatible Client**: Antigravity `v2.33.0`
>
> **Last Updated**: `2026-11-20`
>
> **Runtime Requirement**: Node.js (zero external npm dependencies)
>
> **Coverage**: Main UI, native application & tray menus, splash/loading screens, settings panels, onboarding & sign-in flows, agent/task/automation management, customization & Marketplace plugins, MCP server catalog, plus dynamic status indicators and tooltips.

> [!IMPORTANT]
> **Security, Content Isolation & Non-Invasive Design**:
>
> - **Strict Content Exclusion Zones**:
>   - **Conversation & Reasoning Isolation**: Never translates or mutates user prompts (`data-testid="user-input-step"`), model chain-of-thought text, prose paragraphs, or collapsible tool activity blocks (`Explored/Edited X files`, `Ran X commands`). Only top-level progress/duration labels are localized.
>   - **File Tree, Path, Code & Icon Protection**: Uses `WeakMap` ancestor caching and subtree pruning to skip workspace file trees (`role="tree"` / `treeitem`), file path breadcrumbs, tab titles, changed-file paths, Monaco editors, terminals, and icon fonts (`.google-symbols` / `.codicon`).
>   - **Custom Skip Attribute**: Any DOM subtree marked with `data-ag-localization-skip` is skipped automatically (used for clean coexistence with `agy-meme` and native Sidecar plugins).
> - **100% Offline & Zero Telemetry**: Pure Node.js standard library ASAR packer/unpacker. No network calls during patching, no telemetry, and no changes to core binaries or model API payloads.
> - **Lossless Backup & Restore**: Automatically creates `app.asar.bak` on first run for instant one-click rollback to the untouched official English client.

---

## Key Enhancements (Beyond Upstream)

Built on top of [`Silas-02/antigravity-desktop-cn`](https://github.com/Silas-02/antigravity-desktop-cn) with additional UX and tooling enhancements:

- **Compact Wide Layout Toggle**: Enables a 94% adaptive conversation width and tighter message spacing, toggleable live in **Settings → Appearance → Chat Width**.
- **Office & EPUB Sidebar Preview + One-Click External Open**:
  - Click `.xlsx / .docx / .pptx / .epub` files to render multi-sheet spreadsheets (with merged cells, Excel serial date decoding, and formula bar), formatted document previews, or full EPUB reader view (TOC, full-text search, anchors, embedded images, font scaling) directly in the sidebar, with sticky **Open with Default App** and **Reveal in Finder/Explorer** buttons.
  - Optional **"Auto-open Office files externally"** toggle in **Settings → Appearance → Chat Width**.
- **Independent Sticker Plugin Coexistence**: Decoupled sticker features into [`jiangnanquan/agy-meme`](https://github.com/jiangnanquan/agy-meme) while preserving full DOM isolation (`data-ag-localization-skip`) so both layers stack cleanly on `app.asar`.
- **Sandboxed Audit CLI (`scripts/ag_audit.js`)**: Read-only VM sandbox validator covering dictionary linting (`dicts`), engine compilation (`engine`), Electron main-process anchor verification (`asar`), and runtime string search (`search` / `slice`).

---

## Screenshots

### 1. Welcome & Onboarding Flow
![Welcome & Onboarding](./showimg/showlogin.png)

### 2. Main Editor & Navigation
![Main Editor](./showimg/showmain.png)

### 3. Settings Panel
![Settings Panel](./showimg/showmenu.png)

---

## Repository Structure

- **`双击安装中文汉化.bat` / `双击卸载还原官方英文.bat`**: One-click install & restore launchers for Windows.
- **`双击安装中文汉化.command` / `双击卸载还原官方英文.command`**: Finder double-click install & restore launchers for macOS.
- **`install.sh` / `uninstall.sh`**: Terminal install & restore scripts for macOS / Linux.
- **`localization_engine.js`**: Core cross-platform ASAR unpack/patch/repack engine, macOS quarantine cleaner & Inside-Out codesigner, plus UX enhancements.
- **`dicts/`**: Modular JSON translation dictionaries (`release.json`, `common.json`, `menu_nav.json`, `page_agents.json`, `page_mcp_knowledge.json`, `marketplace_plugins.json`, `page_settings.json`, `page_workspaces.json`).
- **`scripts/ag_audit.js`**: Read-only sandbox auditor for dictionaries, engine syntax, and `app.asar` anchor health.
- **`.agents/skills/sync-marketplace-plugins/`**: Automated Marketplace metadata comparison & synchronization skill.
- **`AGENTS.md`**: AI agent maintenance guidelines and localization boundaries.
- **`.gitattributes`**: Preserves GBK/CRLF for `.bat` scripts and LF for `.command`/`.sh` scripts.

---

## Quick Start

### 1. Download or Clone

```bash
git clone https://github.com/jiangnanquan/antigravity-desktop-cn.git
cd antigravity-desktop-cn
```

Or click **Code → Download ZIP** and extract it to any local directory.

### 2. One-Click Install

Close Antigravity (or let the script handle it) and run the installer for your OS:

| Platform | Entry Point | Notes |
| :--- | :--- | :--- |
| **Windows** | Double-click **`双击安装中文汉化.bat`** | Right-click → *Run as administrator* only if permission is denied |
| **macOS** | Double-click **`双击安装中文汉化.command`** or run `./install.sh` | Use `sudo ./install.sh` only if `/Applications/` requires elevation |
| **Linux** | Run **`./install.sh`** | User-space installs require no root; system paths auto-prompt `sudo` |

Useful CLI flags (`install.sh` / `localization_engine.js`):
- `--install-dir "/path/to/Antigravity"`: Specify a custom Antigravity installation directory.
- `--brand-title english|none`: Keep `Antigravity` brand title or hide it.
- `--no-kill`: Skip terminating running Antigravity processes (for offline testing).

### 3. One-Click Restore (Official English)

| Platform | Entry Point |
| :--- | :--- |
| **Windows** | Double-click **`双击卸载还原官方英文.bat`** |
| **macOS** | Double-click **`双击卸载还原官方英文.command`** or run `./uninstall.sh` |
| **Linux** | Run **`./uninstall.sh`** |

---

## How It Works

1. **Process & Lock Check**: Safely closes running Antigravity instances before patching `app.asar`.
2. **Original Backup**: Preserves the untouched official bundle as `app.asar.bak` on first install.
3. **Zero-Dependency Native ASAR Engine**: Implements Chromium Pickle & ASAR archive read/write directly in Node.js without `npm`/`npx`, preserving `--unpack` native modules and binaries.
4. **Targeted Electron Injection**:
   - `preload.js`: Runs a bounded `MutationObserver` + WeakMap-cached DOM translator with Shadow DOM traversal.
   - `menu.js` / `tray.js` / `updater.js` / `ipcHandlers.js`: Localizes native application menus, tray menus, update dialogs, and context menus.
   - `main.js` / `wsl.js` / `provisionSplash.js` / `utils.js`: Localizes startup/WSL dialogs and injects localization hooks into `plugin://` subframes.
5. **macOS Gatekeeper & Codesigning**: Recursively clears `com.apple.quarantine` and performs Inside-Out `codesign` after repacking.

---

## Maintenance & Verification

Before committing dictionary or engine changes, run the read-only sandbox auditor:

```bash
# 1. Validate dictionaries only (JSON syntax, duplicate keys, punctuation, isolated words)
node scripts/ag_audit.js dicts

# 2. Full check: dicts + sandboxed generateJs() + app.asar anchor verification
node scripts/ag_audit.js check
# Or check against a specific unpacked app.asar:
node scripts/ag_audit.js check --asar /path/to/Antigravity.app/Contents/Resources/app.asar
```

---

## FAQ

<details>
<summary><strong>1. "Node.js not found"</strong></summary>

Install Node.js LTS:
- **Windows**: `winget install OpenJS.NodeJS.LTS` (or download from https://nodejs.org)
- **macOS**: `brew install node`
- **Ubuntu/Debian**: `sudo apt update && sudo apt install -y nodejs`

</details>

<details>
<summary><strong>2. macOS Gatekeeper blocks double-clicking <code>.command</code></strong></summary>

Hold **Control** + click `双击安装中文汉化.command` → **Open**, or clear the quarantine attribute in Terminal:

```bash
cd /path/to/antigravity-desktop-cn
xattr -d -r com.apple.quarantine .
chmod +x *.command *.sh
```

</details>

<details>
<summary><strong>3. Official client update overwrote the localization</strong></summary>

Official updates replace `app.asar`. Simply re-run the installer script (`./install.sh` / `.bat` / `.command`) after updating.

</details>

---

## Acknowledgements & Upstream

This repository is maintained with local enhancements on top of [`Silas-02/antigravity-desktop-cn`](https://github.com/Silas-02/antigravity-desktop-cn), which was originally forked from [`qqxpee/antigravity2-cn`](https://github.com/qqxpee/antigravity2-cn). Huge thanks to **Silas-02** and **qqxpee** for their foundational work!
