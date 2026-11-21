# AI-Native Interactive Installation & Customization SOP (`INSTALL_SOP.md`)

> **Audience / 适用对象**: All AI Coding Agents (`Antigravity`, `Claude Code`, `Cursor`, `Codex`, `Pi`, `OpenCode`, etc.) and human operators.
> **Core Principle / 核心理念**: In the AI era, users do not need to memorize CLI flags or JSON schemas. Whenever an AI assistant handles an installation, upgrade, language switch, module customization, or macOS permission repair request for `agy-desktop-exo`, **it MUST follow this interactive checklist first, verify prerequisites, and strictly obey the Host Self-Preservation Two-Phase Execution Protocol**.
> 进入 AI 时代，用户无需死记硬背命令行参数。任何 AI 助手接手本仓库的安装、升级、语言切换或配置请求时，**严禁不经询问直接盲跑默认脚本**，必须先按以下规程向用户确认偏好，再执行环境探测与宿主自保双阶段部署。

---

## Step 1: Ask User Preferences (AI Mandatory Checklist / AI 必问偏好清单)

Before running any installation command, ask the user to confirm the following items in their preferred conversation language (skip an item only if the user already explicitly stated that choice in their prompt):
在生成配置或执行命令前，请使用用户当前的对话语言，一次性简洁询问以下选项（若用户在首句指令中已明确指定某项，则保留其选择并仅询问其余未定项）：

### Q1. UI Language / 主界面语言 (`--lang`)

Ask whether they want Simplified Chinese UI localization or the untouched official English UI:
询问用户希望使用简体中文汉化界面，还是保留官方原版英文界面：

- **Option A (`--lang zh`)**: **Simplified Chinese UI Localization（简体中文全量汉化）** — Localizes menus, settings, onboarding, Marketplace, and status labels with strict isolation of user prompts, code, file paths, and model reasoning.
- **Option B (`--lang en`)**: **Keep 100% Official English UI（保留 100% 官方原版英文界面与菜单）** — Leaves all product text and menus in original English while enabling the selected EXO enhancements below.

### Q2. Feature Modules / 功能模块组合

Ask which module bundle they want to install:
询问用户希望安装的功能模块组合：

- **Option 1 — Recommended All-in-One（推荐全家桶，`--with-context`）**:
  - `94%` Compact Wide Chat Layout + `.xlsx / .docx / .pptx / .epub` Native Sidebar Preview & One-Click Open
  - Built-in **`Context Pro`** (`plugins/desktop-context`): Top-bar live telemetry pill, official quota reset countdown monitor, composer ring & 3-minute cache TTL tri-color alert, Cache Bust ledger, DeepSeek Harness-style per-turn tool token inspector, and `[Session] | [Swarm Radar]` panoramic dashboard (with live `中 / EN` toggle).
- **Option 2 — Core UX Only（轻量底座，不含 `--with-context`）**:
  - UI language mode (`zh` or `en`) + `94%` Compact Wide Layout + Office/EPUB Sidebar Preview only (skips `Context Pro`).
- **Option 3 — Telemetry Plugin Only（纯遥测插件，`--context-only`）**:
  - Leaves main UI localization, wide layout, and Office/EPUB preview untouched; deploys and injects `plugins/desktop-context` (`Context Pro` zero-CDP Electron IPC bridge + native Sidecar plugin) only.
- **Optional Ecosystem Add-on（附带可选生态询问）**:
  - Ask if they also want to install the standalone bidirectional sticker extension **[`jiangnanquan/agy-meme`](https://github.com/jiangnanquan/agy-meme)** (supports inline Gemini Neko chat stickers, `Cmd+Shift+M` / `Ctrl+Shift+M` picker, and MCP tools; cleanly isolated via `data-ag-localization-skip`).

### Q3. macOS Persistent Code Signing / macOS 持久证书签名 (`Darwin` Only / 仅 macOS 必问)

If the host OS is macOS (`uname -s` is `Darwin`), **first run this read-only status probe** (100% safe inside any session):
若当前系统为 macOS（`Darwin`），AI **必须先运行以下只读探测命令**（在任何会话内均安全无副作用）：

```bash
bash scripts/macos_codesign.sh --status
```

- **When to Prompt / 触发条件**: If the output shows that the local certificate `Antigravity Local Signer` is not yet configured in the login keychain, or `Antigravity.app` is currently signed with `adhoc` (`Signature=adhoc`).
- **Explain the Pain Point / 解释痛点**:
  - **EN**: macOS TCC permissions (such as **Full Disk Access**, Automation, and folder permissions) track apps by code-signing identity. Official updates or `adhoc` re-signing change the binary `CDHash` every time, causing macOS permissions to silently break even when the toggle in System Settings still appears ON.
  - **ZH**: macOS 的 TCC 隐私权限库（如「完全磁盘访问权限」、自动化与目录授权）依赖代码签名身份锚定应用。每次升级客户端或使用普通 `adhoc` 临时重签都会改变 `CDHash`，导致系统设置里开关看似开着、实际权限已静默失效。
- **Ask Confirmation / 询问确认**: Ask whether to run `./install.sh --setup-cert` (alias: `bash scripts/macos_codesign.sh --setup-cert`) to idempotently create and trust a 10-year local code-signing certificate (`Antigravity Local Signer`) in the login keychain. Once set up, `./install.sh` automatically prefers this persistent identity.
- **One-Time TCC Refresh Guide (First Switch from `adhoc` -> `Antigravity Local Signer` / 首次从 `adhoc` 切换至固定证书的标准操作说明)**:
  Remind the user that **only on the very first transition** from `adhoc` to `Antigravity Local Signer`, they should refresh stale TCC bindings once:
  提醒用户在**首次**从 `adhoc` 切换为固定证书签名后，执行一次性的旧授权清理与重绑（此后永久稳固，升级重签不再掉权限）：
  1. Reset stale TCC entries in Terminal / 在终端重置旧签名残留记录：
     ```bash
     tccutil reset All com.google.antigravity
     ```
  2. Open **System Settings -> Privacy & Security -> Full Disk Access**（打开 **系统设置 -> 隐私与安全性 -> 完全磁盘访问权限**）.
  3. Select the old `Antigravity` entry, click **`−`** to remove it completely, then click **`+`** to re-add `/Applications/Antigravity.app` and toggle it ON（选中旧 `Antigravity` 条目，点击 **`−`** 移除，再点击 **`+`** 重新添加 `/Applications/Antigravity.app` 并开启）.

### Q4. Optional Swarm Model Compliance Audit Rules / 蜂群模型合规审计规则 (Optional / 默认关闭，按需询问)

- **Default Behavior / 默认行为**: Disabled by default (`"enabled": false`). Do **NOT** bother general users with this unless they mention **Swarm / multi-agent governance** or ask for advanced customization.
  默认关闭（不拦截任何模型），**仅当用户主动提及 Swarm 蜂群治理或要求选配进阶规则时询问**。
- **Configuration File / 配置文件**: `~/.gemini/context-pro-config.json`
  Show the template below and write `~/.gemini/context-pro-config.json` according to the user's preferences:

```json
{
  "lang": "auto",
  "audit_rules": {
    "enabled": false,
    "forbidden_patterns": [],
    "warn_worker_patterns": [],
    "safe_worker_patterns": [],
    "exempt_role_keywords": ["coordinator", "council", "主控", "议长"]
  }
}
```

- `"lang"`: `"auto"` | `"zh"` | `"en"` (users can also switch live anytime via the `中 / EN` button in the top-right corner of the Context Pro sidebar).
- `"audit_rules"`: When `"enabled": true`, `[Swarm Radar]` highlights workers matching `forbidden_patterns` (error), `warn_worker_patterns` (warning unless exempted by `exempt_role_keywords`), and `safe_worker_patterns` (compliant badge).

---

## Step 2: Pre-Flight Environment Check / 前置环境探测

Verify required local runtimes before installation (read-only checks, safe everywhere):
执行前先在会话内进行只读环境校验：

1. **Node.js (`v18+` required / 必需 `v18+`)**:
   ```bash
   node -v
   ```
   *(Zero external `npm` packages required; the ASAR engine uses pure Node.js standard libraries.)*
2. **Python 3 (Required when installing `Context Pro` via `--with-context` or `--context-only` / 安装 Context Pro 时必需)**:
   ```bash
   python3 --version
   ```

If either runtime is missing, provide the one-line OS package manager command (`brew install node python` on macOS, `winget install OpenJS.NodeJS.LTS Python.Python.3.12` on Windows, or `sudo apt install -y nodejs python3` on Ubuntu/Debian) before proceeding.

---

## Step 3: Host Self-Preservation Two-Phase Execution Protocol / 宿主自保双阶段执行规程（防自杀铁律！）

> [!CAUTION]
> **Anti-Self-Termination Iron Rule / 严防杀死当前宿主会话！**
> Patching or restoring `app.asar` requires terminating running `Antigravity` desktop processes. `install.sh` includes a built-in process-tree guard that blocks execution with **`exit code 2`** if invoked from inside an active Antigravity Desktop session. **You MUST determine your current host environment first!**
> 改写 `app.asar` 的安装与卸载流程必须关闭正在运行的 `Antigravity` 桌面端。如果在 Antigravity Desktop 内部聊天会话中直接运行主安装脚本，会直接杀死宿主导致会话中断（`install.sh` 内置进程树自保门禁会以 **`exit code 2`** 主动拦截）！

### Case A: Running in an External CLI Terminal / 情况 A：当前 AI 运行在外部独立终端 CLI

*(Examples: `Claude Code`, `Pi`, terminal `agy` CLI where `App Data Directory` is `antigravity-cli`, `Cursor`, `Codex`, `OpenCode`, or standalone Terminal/iTerm2)*

- **Action**: Safe to execute end-to-end! Confirm the user has no unsaved work in Antigravity Desktop, write `~/.gemini/context-pro-config.json` if needed, run `./install.sh --setup-cert` if requested on macOS, and **directly run `./install.sh <flags>`** in the session.
- **执行方式**：无宿主自杀风险！确认用户在 Antigravity 桌面端无未保存内容后，AI 可直接在当前会话内一气呵成完成证书配置、JSON 写入与 `./install.sh ...` 安装全流程。

### Case B: Running INSIDE Antigravity Desktop / 情况 B：当前 AI 运行在 Antigravity Desktop 桌面客户端内部会话

*(Identified when `App Data Directory` ends with `/antigravity`, parent process tree belongs to `Antigravity.app` / `Antigravity.exe`, or `install.sh` exits with code `2`)*

**NEVER run `app.asar`-mutating `./install.sh` or `./uninstall.sh` commands directly inside this session!** Instead, strictly execute **Phase A** + **Phase B**:
**严禁在会话内直接执行改写 `app.asar` 的主安装/卸载命令！** 必须严格按以下两阶段交付：

1. **Phase A — Safe In-Session Preparation（阶段 A：AI 在当前会话内安全代劳）**:
   - Run Step 2 environment checks (`node -v`, `python3 --version`, `bash scripts/macos_codesign.sh --status`).
   - If on macOS and the user opted into persistent signing, safely run:
     ```bash
     ./install.sh --setup-cert
     ```
     *(Safe inside Antigravity Desktop: only configures the login keychain certificate without touching `app.asar` or killing the app.)*
   - Write or update `~/.gemini/context-pro-config.json` with the user's chosen `"lang"` and optional `"audit_rules"`.
2. **Phase B — Hand Off Copy-Paste External Terminal Command（阶段 B：输出外部独立终端复制即用命令）**:
   - Provide a single, ready-to-paste command with the exact repository path and chosen flags, instructing the user to run it in an **external terminal** (macOS `Terminal` / `iTerm2` / `Ghostty`, Linux terminal, or Windows `PowerShell` / `.bat` launcher):
   ```bash
   # Example (Chinese All-in-One):
   cd "/absolute/path/to/agy-desktop-exo" && ./install.sh --lang zh --with-context

   # Example (Official English UI + EXO & Context Pro):
   cd "/absolute/path/to/agy-desktop-exo" && ./install.sh --lang en --with-context
   ```

---

## Step 4: Canonical CLI Command Matrix / 标准命令契约速查表

| Scenario / 场景 | Command / 标准命令 |
| :--- | :--- |
| **Chinese All-in-One（中文全家桶：汉化 + 宽屏/Office 速览 + 中文 Context Pro + macOS 优先固定签名）** | `./install.sh --lang zh --with-context` |
| **English All-in-One（英文原版增强全家桶：100% 官方英文 UI + 宽屏/Office 速览 + 英文 Context Pro + macOS 优先固定签名）** | `./install.sh --lang en --with-context` |
| **Core UX Only — Chinese（仅中文汉化 + 宽屏 + Office/EPUB 速览，不装 Context Pro）** | `./install.sh --lang zh` |
| **Core UX Only — English（保留官方英文 UI + 仅宽屏 + Office/EPUB 速览，不装 Context Pro）** | `./install.sh --lang en` |
| **Context Pro Only（不动主界面与宽屏/Office 预览，仅部署并注入 Context Pro）** | `./install.sh --lang <zh\|en> --context-only` |
| **macOS Persistent Cert Setup（macOS 幂等生成并引导信任 10 年期本地签名证书，会话内安全）** | `./install.sh --setup-cert` *(or `bash scripts/macos_codesign.sh --setup-cert`)* |
| **macOS Re-sign Only（不重打 ASAR，仅对 `Antigravity.app` 执行固定证书 Inside-Out 持久重签）** | `./install.sh --resign-only` *(or `bash scripts/macos_codesign.sh --resign-only`)* |
| **macOS Signature & Cert Status（查看当前签名状态与本地证书信任情况）** | `bash scripts/macos_codesign.sh --status` |
| **Full Restore（还原官方原版 `app.asar.bak` 并一并移除 Context Pro 插件软链）** | `./uninstall.sh --with-context` |
| **Remove Context Pro Only（仅无损剥离 Context Pro 桥接层，保留主界面配置）** | `./uninstall.sh --context-only` |
| **Restore Core ASAR Only（使用 `app.asar.bak` 还原主程序包）** | `./uninstall.sh` |
