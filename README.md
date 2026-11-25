# agy-desktop-exo — All-in-One Modular EXO Suite for Antigravity Desktop

**English** | [简体中文](README_ZH.md) | [AI Interactive Install SOP](INSTALL_SOP.md) | [MIT License](LICENSE)

> **Supported Platforms**: macOS / Windows / Linux (Ubuntu & major distributions)
>
> **Supported UI Languages**: **Official English (`--lang en`, 100% original UI)** & **Simplified Chinese (`--lang zh`)**
>
> **Suite & Localization Version**: `v2.35.1` (Compatible with **Antigravity Desktop `v2.35.1`**)
>
> **Last Updated**: `2026-11-24`
>
> **Runtime Requirements**: Node.js `v18+` (zero external `npm` dependencies for core ASAR engine); `python3` when enabling `Context Pro`

`agy-desktop-exo` is a modular, non-invasive **Exoskeleton (EXO) enhancement suite** built for **both English and Simplified Chinese users** of Google Antigravity Desktop. Pick only the layers you want — keep the untouched official English interface or enable surgical Simplified Chinese localization, while unlocking wide-screen ergonomics, native Office/EPUB previews, real-time context & Swarm telemetry, and persistent macOS TCC permissions.

---

## Four Modular Pillars

### 1. UI Localization (Optional: `--lang en` or `--lang zh`)
- **100% Official English Mode (`--lang en`)**: Preserves every native English menu, label, and dialog untouched while installing the workspace UX enhancements and/or `Context Pro` in English.
- **Zero-Collateral Simplified Chinese Localization (`--lang zh`)**: Covers main UI, native application & tray menus, splash/onboarding flows, settings, agent/automation panels, MCP servers, and Marketplace catalogs — strictly isolating user prompts, model reasoning, file paths, code editors, and terminals.

### 2. Workspace UX Enhancements
- **94% Compact Wide Chat Layout**: Replaces cramped narrow columns with an adaptive 94% conversation width and tighter message spacing, live-toggleable anytime in **Settings -> Appearance -> Chat Width**.
- **Native Office & EPUB Sidebar Preview + One-Click External Open**:
  - Click `.xlsx / .docx / .pptx / .epub` files in the workspace to render multi-sheet spreadsheets (merged cells, Excel serial date decoding, formula bar), formatted documents, or a full EPUB reader (TOC, full-text search, anchors, embedded images, font scaling) right inside the sidebar.
  - Sticky **Open with Default App** and **Reveal in Finder/Explorer** action buttons at the top, plus an optional **"Auto-open Office files externally"** toggle in **Settings -> Appearance -> Chat Width**.

### 3. Built-in `Context Pro` Telemetry & Swarm Radar (`plugins/desktop-context/`)
Powered by a **zero-CDP Electron IPC lightweight bridge + native Sidecar plugin** (no `--remote-debugging-port` required):
- **Top-Bar Live Telemetry Pill**: Real-time context window utilization badge anchored right in the desktop title/top bar.
- **Official Quota Reset Countdown Monitor**: Tracks active model quota consumption and exact reset countdown windows.
- **Composer Ring & 3-Minute Cache TTL Tri-Color Alert**: Visual ring indicator around the chat input with green/amber/red countdown alerts before your 3-minute prompt cache expires.
- **Cache Bust Ledger**: Automatically detects, records, and pinpoints unexpected prompt cache invalidations across turns.
- **DeepSeek Harness-Style Per-Turn Tool Token Inspector**: Breaks down per-step prompt growth and heavy tool-call payloads so you know exactly which tool ate your context budget.
- **`[Session] | [Swarm Radar]` Panoramic Dashboard**: Real-time multi-agent / Swarm roster view tracking worker states, assigned models, and optional user-defined model compliance auditing (`audit_rules`), with a one-click **`中 / EN`** live language switch in the top-right corner.

### 4. macOS Persistent Code Signing (`Antigravity Local Signer`)
- Solves macOS's notorious **TCC permission amnesia**: official client updates or standard `adhoc` re-signing change the app's `CDHash` every time, silently breaking **Full Disk Access**, folder permissions, and Automation toggles.
- Idempotently generates a 10-year local code-signing certificate (`Antigravity Local Signer`) in your login keychain and performs Inside-Out signing so macOS permissions survive updates and re-patching permanently.

---

## AI-Native Interactive Install (Recommended)

In the AI era, you don't need to memorize CLI flags. Paste the prompt below into **any AI Coding Agent** (`Antigravity`, `Claude Code`, `Cursor`, `Codex`, `Pi`, `OpenCode`):

```text
Clone https://github.com/jiangnanquan/agy-desktop-exo (or cd into my local copy), read INSTALL_SOP.md first, ask me interactively for my language, feature module, and macOS persistent signing preferences, and configure it following the Host Self-Preservation Two-Phase Protocol.
```

> [!TIP]
> **How AI Host Self-Preservation Works**:
> - If your AI runs in an **external terminal CLI** (`Claude Code`, `Pi`, terminal `agy`, `Cursor`), it will run the entire setup end-to-end for you.
> - If your AI runs **inside Antigravity Desktop**, `install.sh` protects you from killing your own active session (`exit code 2` guard): the AI safely completes pre-flight checks, macOS certificate setup, and JSON config in-session (**Phase A**), then gives you a single copy-paste command to run in an external terminal (**Phase B**). See [`INSTALL_SOP.md`](INSTALL_SOP.md) for full details.

### Manual One-Line CLI Matrix

```bash
git clone https://github.com/jiangnanquan/agy-desktop-exo.git
cd agy-desktop-exo
```

| Goal | Command |
| :--- | :--- |
| **English All-in-One** *(100% Official English UI + Wide/Office UX + English Context Pro + macOS Persistent Sign)* | `./install.sh --lang en --with-context` |
| **Chinese All-in-One** *(Simplified Chinese UI + Wide/Office UX + Chinese Context Pro + macOS Persistent Sign)* | `./install.sh --lang zh --with-context` |
| **Core UX Only (English or Chinese)** *(Wide layout + Office/EPUB preview, without Context Pro)* | `./install.sh --lang en` *or* `./install.sh --lang zh` |
| **Context Pro Only** *(Keep current main UI untouched; deploy/inject Context Pro only)* | `./install.sh --lang en --context-only` *or* `./install.sh --lang zh --context-only` |
| **macOS Persistent Cert Setup** *(Create & trust 10-year `Antigravity Local Signer` in login keychain)* | `./install.sh --setup-cert` *(status: `bash scripts/macos_codesign.sh --status`)* |
| **macOS Re-Sign Only** *(Re-sign `Antigravity.app` with persistent cert without repacking ASAR)* | `./install.sh --resign-only` |
| **One-Click Full Restore** *(Restore untouched `app.asar.bak` & remove Context Pro symlink)* | `./uninstall.sh --with-context` *(or `--context-only` to detach Context Pro only)* |

<details>
<summary><strong>GUI Double-Click Launchers (Windows / macOS) & Extra Flags</strong></summary>

| Platform | Install (Chinese Default) | Restore Official English |
| :--- | :--- | :--- |
| **Windows** | Double-click **`双击安装中文汉化.bat`** | Double-click **`双击卸载还原官方英文.bat`** |
| **macOS** | Double-click **`双击安装中文汉化.command`** | Double-click **`双击卸载还原官方英文.command`** |

Additional flags for `install.sh` / `localization_engine.js`:
- `--install-dir "/path/to/Antigravity"`: Specify a custom Antigravity installation directory.
- `--brand-title english|none`: Keep `Antigravity` brand title in the top-left corner or hide it.
- `--no-kill`: Skip terminating running Antigravity processes (for offline testing).

</details>

### Ecosystem Companion Extension

- **[`jiangnanquan/agy-meme`](https://github.com/jiangnanquan/agy-meme)**: Standalone bidirectional Gemini Neko chat sticker pack with inline desktop rendering, `Cmd+Shift+M` / `Ctrl+Shift+M` sticker picker, and MCP tools. Fully isolated via `data-ag-localization-skip` for lossless stacking on top of `agy-desktop-exo`.

---

## Configuration & macOS Persistent Signing Notes

### `Context Pro` Configuration (`~/.gemini/context-pro-config.json`)

`Context Pro` works out of the box with zero config. Power users can optionally customize `~/.gemini/context-pro-config.json`:

```json
{
  "lang": "auto",
  "audit_rules": {
    "enabled": false,
    "forbidden_patterns": [],
    "warn_worker_patterns": [],
    "safe_worker_patterns": [],
    "exempt_role_keywords": ["coordinator", "council"]
  }
}
```

- `"lang"`: `"auto"` | `"en"` | `"zh"` (can also be toggled live via the **`中 / EN`** button in the Context Pro sidebar header).
- `"audit_rules"`: Disabled by default (`"enabled": false`). Heavy Swarm users can define custom substrings/patterns to audit worker model assignments in `[Swarm Radar]`.

### First-Time Switch to `Antigravity Local Signer` on macOS

After running `./install.sh --setup-cert` and signing `Antigravity.app` with `Antigravity Local Signer` for the **very first time** (migrating away from `adhoc`), flush stale TCC entries once:

```bash
tccutil reset All com.google.antigravity
```

Then open **System Settings -> Privacy & Security -> Full Disk Access**, select `Antigravity`, click **`−`** to remove the old entry, click **`+`** to re-add `/Applications/Antigravity.app`, and toggle it ON. Future client upgrades + `./install.sh` runs will keep your permissions intact automatically.

---

## Security, Content Isolation & Non-Invasive Design

> [!IMPORTANT]
> - **Strict Content Exclusion Zones (`--lang zh` mode)**:
>   - **Conversation & Reasoning Isolation**: Never translates or mutates user prompts (`data-testid="user-input-step"`), model chain-of-thought text, prose paragraphs, or collapsible tool activity blocks (`Explored/Edited X files`, `Ran X commands`). Only top-level progress/duration labels are localized.
>   - **File Tree, Path, Code & Icon Protection**: Uses `WeakMap` ancestor caching and subtree pruning to skip workspace file trees (`role="tree"` / `treeitem`), file path breadcrumbs, tab titles, changed-file paths, Monaco editors, terminals, and icon fonts (`.google-symbols` / `.codicon`).
>   - **Custom Skip Attribute**: Any DOM subtree marked with `data-ag-localization-skip` is skipped automatically (used for clean coexistence with `Context Pro`, `agy-meme`, and native Sidecar plugins).
> - **100% Local & Zero External Telemetry**: Pure Node.js standard library ASAR packer/unpacker and localhost-only Sidecar telemetry. No external network calls during patching and no mutations to core binaries or model API payloads.
> - **Lossless Backup & Restore**: Automatically preserves the untouched official bundle as `app.asar.bak` on first run for instant one-click rollback.

---

## Screenshots (Localization & UX Preview)

### 1. Welcome & Onboarding Flow
![Welcome & Onboarding](./showimg/showlogin.png)

### 2. Main Editor & Navigation
![Main Editor](./showimg/showmain.png)

### 3. Settings Panel
![Settings Panel](./showimg/showmenu.png)

---

## Repository Structure

- **`INSTALL_SOP.md`**: AI-native interactive installation & customization protocol (EN/ZH bilingual).
- **`install.sh` / `uninstall.sh`**: Cross-platform CLI installer & restore entrypoints with process-tree self-preservation guard.
- **`双击安装中文汉化.bat` / `双击卸载还原官方英文.bat`**: One-click install & restore launchers for Windows.
- **`双击安装中文汉化.command` / `双击卸载还原官方英文.command`**: Finder double-click install & restore launchers for macOS.
- **`localization_engine.js`**: Zero-dependency Node.js ASAR unpack/patch/repack engine, `--lang en|zh` injector, wide-layout & Office/EPUB preview enhancements, and Inside-Out codesign integration.
- **`plugins/desktop-context/`**: Built-in `Context Pro` telemetry & Swarm Radar module (zero-CDP Electron IPC bridge + native Sidecar UI + Python/Node test suites).
- **`scripts/macos_codesign.sh`**: Idempotent `Antigravity Local Signer` keychain certificate manager and Inside-Out persistent codesigner.
- **`scripts/ag_audit.js`**: Read-only VM sandbox auditor for dictionaries, engine syntax, and `app.asar` anchor health.
- **`dicts/`**: Modular JSON translation dictionaries (`release.json`, `common.json`, `menu_nav.json`, `page_agents.json`, `page_mcp_knowledge.json`, `marketplace_plugins.json`, `page_settings.json`, `page_workspaces.json`).
- **`.agents/skills/sync-marketplace-plugins/`**: Automated Marketplace metadata comparison & synchronization skill.
- **`AGENTS.md`**: AI agent routing rules, localization safety boundaries, and `Context Pro` test gates.
- **`LICENSE`**: MIT License and third-party upstream attributions.

---

## How It Works

1. **Process & Host Guard**: Verifies the caller is not running inside the target Electron host (`exit code 2` guard), then safely closes running Antigravity instances before patching `app.asar`.
2. **Original Backup**: Preserves the untouched official bundle as `app.asar.bak` on first install.
3. **Zero-Dependency Native ASAR Engine**: Implements Chromium Pickle & ASAR archive read/write directly in Node.js without `npm`/`npx`, preserving `--unpack` native modules and binaries.
4. **Targeted Modular Injection**:
   - `preload.js` & Electron shell modules (`menu.js`, `tray.js`, `updater.js`, `ipcHandlers.js`, `main.js`, `wsl.js`, `provisionSplash.js`, `utils.js`): Injects UX enhancements (94% wide chat, Office/EPUB viewer) and optional `zh-CN` UI translation while leaving everything 100% English under `--lang en`.
   - `plugins/desktop-context`: Links the Sidecar plugin and injects a minimal Electron IPC hook to surface local context, cache TTL, quota, and Swarm telemetry without opening CDP debugging ports.
5. **macOS Gatekeeper & Persistent Codesigning**: Recursively clears `com.apple.quarantine` and signs Inside-Out using `Antigravity Local Signer` (falling back to `adhoc` if unconfigured).

---

## Maintenance, Contribution & Verification

Read [`AGENTS.md`](AGENTS.md) before modifying dictionaries, `localization_engine.js`, or `plugins/desktop-context/`. Run the read-only verification suites before submitting changes:

```bash
# 1. Validate dictionaries only (JSON syntax, duplicate keys, punctuation, isolated words)
node scripts/ag_audit.js dicts

# 2. Full engine check: dicts + sandboxed generateJs() + app.asar anchor verification
node scripts/ag_audit.js check

# 3. Context Pro test suites (required when touching plugins/desktop-context/)
python3 -m unittest discover -s plugins/desktop-context/tests
node --test plugins/desktop-context/tests/*.test.mjs
```

---

## FAQ

<details>
<summary><strong>1. "Node.js not found"</strong></summary>

Install Node.js LTS (`v18+`):
- **macOS**: `brew install node`
- **Windows**: `winget install OpenJS.NodeJS.LTS` (or download from https://nodejs.org)
- **Ubuntu/Debian**: `sudo apt update && sudo apt install -y nodejs`

</details>

<details>
<summary><strong>2. macOS Full Disk Access / TCC permissions keep breaking after updates</strong></summary>

Set up the persistent local signing certificate once:
```bash
./install.sh --setup-cert
./install.sh --resign-only
tccutil reset All com.google.antigravity
```
Then remove (`−`) and re-add (`+`) `/Applications/Antigravity.app` in **System Settings -> Privacy & Security -> Full Disk Access** one last time.

</details>

<details>
<summary><strong>3. macOS Gatekeeper blocks double-clicking <code>.command</code></strong></summary>

Hold **Control** + click `双击安装中文汉化.command` -> **Open**, or clear quarantine attributes in Terminal:

```bash
cd /path/to/agy-desktop-exo
xattr -d -r com.apple.quarantine .
chmod +x *.command *.sh
```

</details>

<details>
<summary><strong>4. Official client update overwrote the enhancements</strong></summary>

Official updates replace `app.asar`. Simply re-run your preferred `./install.sh` command (e.g., `./install.sh --lang en --with-context` or `./install.sh --lang zh --with-context`) in an external terminal.

</details>

---

## License & Acknowledgements

Released under the **[MIT License](LICENSE)** (`Copyright (c) 2026 jiangnanquan & Contributors`).

- **Localization Upstream**: Built upon [`Silas-02/antigravity-desktop-cn`](https://github.com/Silas-02/antigravity-desktop-cn) (originally forked from [`qqxpee/antigravity2-cn`](https://github.com/qqxpee/antigravity2-cn)). Huge thanks to **Silas-02** and **qqxpee** for their foundational localization engineering and dictionary curation!
- **Context Pro Upstream**: `plugins/desktop-context` builds upon the foundational architecture created by **Dimitrios Ioannidis** ([`dimitr-io/antigravity-desktop-context`](https://github.com/dimitr-io/antigravity-desktop-context), MIT License) and draws inspiration from [`pigzzz104/antigravity-context-pro`](https://github.com/pigzzz104/antigravity-context-pro).
