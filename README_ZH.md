# agy-desktop-exo — Antigravity Desktop 模块化全能外骨骼套件（English & 简体中文双语支持）

[English](README.md) | **简体中文** | [AI 交互式安装 SOP](INSTALL_SOP.md) | [MIT 开源协议](LICENSE)

> **支持系统**：macOS / Windows / Linux（含 Ubuntu 等常见发行版）
>
> **界面语言支持**：**简体中文全量汉化（`--lang zh`）** / **100% 官方原版英文界面（`--lang en`）**
>
> **套件与词典版本**：`v2.35.0.1`（匹配官方 **Antigravity Desktop `v2.35.0`**）
>
> **最近更新**：`2026-11-24`
>
> **运行环境**：Node.js `v18+`（核心 ASAR 引擎零外部 `npm` 依赖）；启用 `Context Pro` 时需系统具备 `python3`

`agy-desktop-exo` 是面向 **English 与简体中文双语用户** 打造的 Google Antigravity Desktop **模块化全能外骨骼套件（All-in-One Modular EXO Suite）**。无论是追求零误伤母语体验的中文开发者，还是习惯保留 100% 官方英文原版界面（`--lang en`）的极客用户，都能按需自由组装宽屏阅读、Office/EPUB 原生速览、零 CDP 实时上下文与蜂群全景雷达，以及 macOS 持久代码签名能力。

---

## 🧩 四大核心支柱（Four Modular Pillars）

### 1. 界面本地化（可选：`--lang zh` 简体中文 / `--lang en` 官方英文原版）
- **零误伤简体中文全量汉化（`--lang zh`）**：覆盖主界面、顶部原生菜单与系统托盘、新手引导与登录页、设置面板、智能体/计划任务管理、MCP 列表与官方插件市场；严守内容禁区，绝不污染用户 Prompt、模型思考流（Thought）、文件路径、代码块与终端输出。
- **100% 官方英文原版模式（`--lang en`）**：丝毫不改动官方英文主界面与系统菜单，仅为您无感挂载下方的工作区增强、`Context Pro` 英文遥测面板与 macOS 持久证书签名。

### 2. 工作区 UX 增强（Workspace UX Enhancements）
- **94% 紧凑加宽对话布局**：告别局促窄栏，提供自适应 94% 黄金对话宽度与紧凑消息排版，支持在 **设置 -> 外观 -> 聊天宽度（Settings -> Appearance -> Chat Width）** 中随时一键实时开关。
- **Office 与 EPUB 侧边栏原生速览 + 一键本地外开**：
  - 在文件树或对话链接中点击 `.xlsx / .docx / .pptx / .epub` 文件，直接在侧边栏渲染多工作表表格（支持合并单元格、Excel 日期序列号还原与公式栏）、文档排版速览或完整 EPUB 阅读器（章节目录、全书检索、页内锚点、内嵌插图与字号调节）。
  - 预览区顶部固定 **「用默认应用打开」** 与 **「定位文件」** 按钮；亦可在 **设置 -> 外观 -> 聊天宽度** 中开启「Office 文件自动外开」，点击瞬间拉起本地 WPS / Office。

### 3. 内置 `Context Pro` 上下文遥测与蜂群全景雷达（`plugins/desktop-context/`）
基于 **零 CDP（免开调试端口）Electron 原生 IPC 轻桥接 + 原生 Sidecar 插件**，全本地零外联运行：
- **顶栏实时遥测胶囊（Top-Bar Telemetry Pill）**：在桌面端顶栏直观常驻显示当前会话上下文水位与状态。
- **官方配额重置倒计时监视（Quota Reset Monitor）**：精准追踪各模型配额消耗比例与精确重置倒计时窗口。
- **输入框圆环与 3 分钟缓存 TTL 三色保活预警**：围绕聊天输入框实时展示上下文圆环，并在 3 分钟 Prompt Cache 即将过期前通过绿/黄/红三色倒计时预警，帮您精准续杯避免高昂重算。
- **Cache Bust 缓存崩塌账本**：自动抓拍并记录跨轮次缓存意外失效事件，精准定位导致 Cache Bust 的原因。
- **DeepSeek Harness 风格逐轮工具 Token 检查器**：逐轮拆解对话步骤与各工具调用返回负载的真实 Token 增量，一眼揪出吞噬上下文的“大胃王”工具。
- **`[Session] | [Swarm Radar]` 蜂群全景雷达**：一屏统览多子 Agent / Swarm 蜂群工兵实时状态、模型分配与可选自定义合规审计（面板右上角内置 **`中 / EN`** 一键实时切换按钮，支持通过 `~/.gemini/context-pro-config.json` 配置 `audit_rules`）。

### 4. macOS 持久代码签名（`Antigravity Local Signer`）
- **根治 macOS TCC 掉权限顽疾**：官方升级或普通 `adhoc` 临时重签每次都会改变应用二进制 `CDHash`，导致 macOS 系统设置里的「完全磁盘访问权限（Full Disk Access）」开关看似还开着，实际权限早已静默失效。
- 本套件支持在登录钥匙串幂等签发并信任 10 年期本地固定代码签名证书 `Antigravity Local Signer`，执行由内而外（Inside-Out）持久签名——首次绑定后，此后无论升级客户端还是重打补丁重签，系统权限永久稳固不掉线。

---

## 🤖 AI-Native 交互式安装（强烈推荐）

进入 AI 时代，您无需记忆任何命令行参数。直接复制下方这段提示词发送给**任意 AI 编程助手**（`Antigravity`、`Claude Code`、`Cursor`、`Codex`、`Pi`、`OpenCode` 等）：

```text
请帮我克隆 https://github.com/jiangnanquan/agy-desktop-exo（或进入我本地该仓库目录），先阅读 INSTALL_SOP.md，向我提问确认界面语言、模块组合与 macOS 持久签名偏好，并严格按宿主自保双阶段规程帮我完成配置与安装。
```

> [!TIP]
> **宿主自保双阶段机制说明**：
> - 若您在**外部独立终端 CLI**（如 `Claude Code`、`Pi`、终端 `agy` CLI、`Cursor`）中发送上述指令，AI 会直接在会话内一气呵成代您跑完整个安装流程。
> - 若您在 **Antigravity Desktop 桌面客户端内部会话**中发送指令，直接改写 `app.asar` 会杀死当前宿主会话（`install.sh` 内置进程树自保门禁会以 `exit code 2` 主动拦截）。此时 AI 会先在会话内安全代劳**阶段 A**（环境体检、`./install.sh --setup-cert` 配置持久证书、写入 `~/.gemini/context-pro-config.json`），最后生成一条复制即用的**阶段 B 外部终端单行命令**交您在系统终端粘贴执行。完整规程见 [`INSTALL_SOP.md`](INSTALL_SOP.md)。

### ⚡ 手动一行命令速查矩阵（One-Line CLI Matrix）

```bash
git clone https://github.com/jiangnanquan/agy-desktop-exo.git
cd agy-desktop-exo
```

| 您的安装目标 | 外部终端一键执行命令 |
| :--- | :--- |
| **中文全家桶（推荐）** *(简体中文汉化 + 宽屏/Office 速览 + 中文 Context Pro + macOS 优先固定签名)* | `./install.sh --lang zh --with-context` |
| **英文原版增强全家桶** *(100% 官方英文 UI 与菜单 + 宽屏/Office 速览 + 英文 Context Pro + macOS 优先固定签名)* | `./install.sh --lang en --with-context` |
| **仅安装基础界面与 UX 增强** *(汉化或英文保持 + 宽屏 + Office/EPUB 速览，不装 Context Pro)* | `./install.sh --lang zh` 或 `./install.sh --lang en` |
| **仅安装/更新 Context Pro 遥测插件** *(不动主界面语言与宽屏/Office 预览，仅部署并注入 Context Pro)* | `./install.sh --lang zh --context-only` 或 `./install.sh --lang en --context-only` |
| **macOS 配置 10 年期持久签名证书** *(登录钥匙串幂等生成并引导信任 `Antigravity Local Signer`)* | `./install.sh --setup-cert` *(查状态：`bash scripts/macos_codesign.sh --status`)* |
| **macOS 仅持久重签** *(不重打 ASAR，仅对 `Antigravity.app` 执行固定证书 Inside-Out 重签)* | `./install.sh --resign-only` |
| **一键无损卸载还原** *(恢复官方原版 `app.asar.bak` 并一并移除 Context Pro 插件软链)* | `./uninstall.sh --with-context` *(仅剥离 Context Pro 用 `--context-only`)* |

<details>
<summary><strong>点击展开：Windows / macOS 图形化双击脚本与附加 CLI 参数</strong></summary>

| 平台 | 默认中文安装入口 | 一键还原官方英文入口 | 说明 |
| :--- | :--- | :--- | :--- |
| **Windows** | 双击 **`双击安装中文汉化.bat`** | 双击 **`双击卸载还原官方英文.bat`** | 仅在权限受限时右键“以管理员身份运行” |
| **macOS** | 双击 **`双击安装中文汉化.command`** | 双击 **`双击卸载还原官方英文.command`** | 首次 Gatekeeper 拦截见下方 [FAQ 3](#常见问题解答-faq) |

其他常用可选参数（支持追加在 `./install.sh` 后）：
- `--install-dir "/path/to/Antigravity"`：自动定位失败时手动指定客户端安装目录。
- `--brand-title english|none`：设置左上角品牌标题（保留英文 `Antigravity` 或隐藏）。
- `--no-kill`：跳过关闭运行中的 Antigravity 进程（供离线解包调试使用）。

</details>

### 🐱 独立生态扩展：Gemini 猫娘双向表情包

- **[`jiangnanquan/agy-meme`](https://github.com/jiangnanquan/agy-meme)**：本仓库已将表情包能力解耦为独立开源插件，同时在引擎中完整保留了 `data-ag-localization-skip` 无损共存隔离保护。安装本套件后叠加安装 `agy-meme`，即可体验桌面端聊天贴纸内联双向渲染、`⌘⇧M` / `Ctrl+Shift+M` 选图面板与 MCP 表情工具。

---

## ⚙️ 进阶配置与 macOS 持久签名指南

### 1. `Context Pro` 配置文件（`~/.gemini/context-pro-config.json`）

`Context Pro` 默认免配置开箱即用。进阶用户可按需编辑 `~/.gemini/context-pro-config.json`：

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

- `"lang"`：支持 `"auto"` | `"zh"` | `"en"`（日常也可直接点击 `Context Pro` 侧边栏右上角的 **`中 / EN`** 按钮实时切换语言）。
- `"audit_rules"`：出厂默认 `"enabled": false`（不拦截任何官方模型）。重度多智能体蜂群（Swarm）用户可开启并自定义禁用模型（`forbidden_patterns`）、告警模型（`warn_worker_patterns`）、合规工兵模型（`safe_worker_patterns`）及豁免角色关键词（`exempt_role_keywords`）。

### 2. macOS 首次从 `adhoc` 切换至固定证书的 TCC 权限刷新指引

当您首次运行 `./install.sh --setup-cert` 并使用 `Antigravity Local Signer` 完成重签后，请执行**一次性**的旧 `adhoc` 权限清理与重绑：

```bash
tccutil reset All com.google.antigravity
```

随后打开 macOS **系统设置 -> 隐私与安全性 -> 完全磁盘访问权限**，选中旧的 `Antigravity` 条目，点击左下角 **`−`** 号将其彻底移除，再点击 **`+`** 号重新添加 `/Applications/Antigravity.app` 并打开开关。完成此一次性重绑后，未来客户端升级与重打补丁将永久保持权限生效。

---

## 🛡️ 内容隔离与高安全机制说明（开发者必读）

> [!IMPORTANT]
> - **全方位内容禁区隔离（`--lang zh` 汉化模式）**：
>   - **会话与思考流隔离**：默认跳过用户消息（`data-testid="user-input-step"`，仅放行 `Commented on:` 等固定 UI 标签）、模型思考正文（Thought 流式块）、散文段落及工具活动折叠块（如 `Explored/Edited X files`、`Ran X commands`），状态区仅翻译顶层进度与耗时（如 `工作中`、`正在压缩`、`工作了 XX 分钟`）。
>   - **文件树、路径与代码/图标隔离**：通过 `WeakMap` 缓存与整树剪枝（零子树递归），直接跳过工作区文件树（`role="tree"` / `treeitem`）、辅助面板路径面包屑（`File path breadcrumbs`）、动态文件/目录标签页、变更文件列表路径、Monaco 编辑器、终端及图标字体节点（`.google-symbols` / `.codicon` 等），确保原文件名、目录路径与图标绝不被误译。
>   - **自定义禁区**：任意容器添加 `data-ag-localization-skip` 属性即可显式禁用其子树翻译（与 `Context Pro`、`agy-meme` 及原生 Sidecar 插件完美隔离共存）。
> - **核心匹配与性能机制**：
>   - **1:1 匹配与独立控件守卫**：文本归一化后与词典 1:1 匹配；短词与单字词条受独立控件守卫（`isIsolatedUiControlLabel`）约束，仅在独立按钮、菜单、表头或表单控件上生效；长度 `> 20` 的具体长句支持带单词边界保护的子串替换。
>   - **零阻塞遍历与 100% 本地离线**：全链路采用有界文本提取（`getBoundedTextContent`），内置纯 Node.js 标准库 ASAR 读写引擎与纯本地回环遥测，绝不改写核心二进制或模型 API 请求负载；首次运行自动生成 `app.asar.bak` 无损备份。

---

## 📸 界面效果展示

以下是简体中文模式下的部分板块实际效果展示（涵盖欢迎引导页、主编辑器界面与详细设置面板）：

### 1. 欢迎页与登录新手引导

![欢迎页与登录新手引导](./showimg/showlogin.png)

### 2. 主编辑器界面与菜单

![主编辑器界面与菜单](./showimg/showmain.png)

### 3. 详细参数设置面板

![详细参数设置面板](./showimg/showmenu.png)

---

## 📂 项目文件结构

- **`INSTALL_SOP.md`**：面向 AI Agent 与人类用户的交互式安装与定制标准作业规程（中英双语）。
- **`install.sh` / `uninstall.sh`**：macOS / Linux 模块化安装与无损还原入口（内置宿主进程树自保门禁）。
- **`双击安装中文汉化.bat` / `双击卸载还原官方英文.bat`**：Windows 一键安装与备份还原入口。
- **`双击安装中文汉化.command` / `双击卸载还原官方英文.command`**：macOS Finder 双击一键安装与还原入口。
- **`localization_engine.js`**：核心跨平台 ASAR 内存解包/重包引擎，负责 `--lang zh|en` 注入、紧凑宽屏与 Office/EPUB 速览挂载及签名联动。
- **`plugins/desktop-context/`**：内置 `Context Pro` 上下文遥测与蜂群全景雷达模块（零 CDP Electron IPC 轻桥接 + 原生 Sidecar 前端 + Python/Node 双端测试套件）。
- **`scripts/macos_codesign.sh`**：macOS 本地固定签名证书（`Antigravity Local Signer`）幂等管理与 Inside-Out 持久重签工具。
- **`scripts/ag_audit.js`**：只读沙箱审计与体检工具，支持字典规范质检（`dicts`）、引擎沙箱编译校验（`engine`）、桌面壳动态锚点体检（`asar`）及运行态文本检索（`search` / `slice`）。
- **`dicts/`**：按模块分类的 JSON 对照翻译字典，当前版本独立词典固定为 `dicts/release.json`。
- **`.agents/skills/sync-marketplace-plugins/`**：官方插件市场云端实时元数据与内存零落盘全自动比对审计技能。
- **`AGENTS.md`**：AI 协作路由入口、汉化安全开发规范与 `Context Pro` 测试门禁。
- **`.gitattributes`**：保护 Windows `.bat` 的 GBK/CRLF 编码与 macOS/Linux 脚本的 LF 换行符。
- **`LICENSE`**：MIT 开源许可证与第三方上游致谢声明。

---

## 🛠️ 架构与注入原理说明

本套件采用 **原生 ASAR 内存流式修补 + 模块化桥接架构**，深度适配 **Antigravity 2.0+** 的 Electron 架构：

1. **宿主自保与进程释放锁**：执行前自动检测调用链是否位于运行中的 Antigravity Desktop 内部（防自杀拦截），外部执行时安全关闭客户端进程以释放文件锁。
2. **原始安全备份**：首次运行时自动创建原始 `app.asar.bak` 备份，确保随时可秒级无损还原。
3. **零外部依赖原生 ASAR 引擎**：纯 Node.js 原生标准库实现 Chromium Pickle 与 ASAR 归档读写，100% 离线免 `npm`/`npx`，完整保留官方 `--unpack` 外部模块属性，杜绝包体积膨胀与杀毒软件误报卡顿。
4. **分层精确注入**：
   - **UX 与可选汉化层**：向 `preload.js`、`menu.js`、`tray.js`、`updater.js`、`ipcHandlers.js`、`main.js`、`wsl.js`、`provisionSplash.js`、`utils.js` 等注入宽屏/Office 预览能力；`--lang zh` 时启用 `WeakMap` 缓存 + Shadow DOM 穿透动态汉化，`--lang en` 时保持 100% 原生英文。
   - **零 CDP `Context Pro` 遥测层**：按需软链挂载 Sidecar 插件并注入极简原生 IPC 通道，无需暴露 `--remote-debugging-port` 即可实时采集上下文、缓存 TTL、配额与蜂群状态。
5. **macOS 隔离修复与持久签名**：自动递归清除 `com.apple.quarantine` 隔离属性，优先调用登录钥匙串中的 `Antigravity Local Signer` 固定证书执行 Inside-Out 持久签名（未配置固定证书时自动平滑回退至 `adhoc` 签名）。

---

## 💡 如何通过 AI 助手自动补充汉化或参与开发？

若在使用 `--lang zh` 模式时遇到漏译文案，直接发送截图或文字描述即可让 AI 助手协助更新词库：

> [!TIP]
> - **推荐做法**：在 Antigravity 中点击 **“打开文件夹”** 将本仓库目录作为工作区打开后与 AI 对话，AI 会自动读取 [`AGENTS.md`](AGENTS.md) 规范并按路由精准定位词典或模块。
> - **免开项目**：若在其他项目工作区中提问，请在提示词中附带仓库路径，例如：*“我的外骨骼套件在 `~/Downloads/agy-desktop-exo`，请先阅读其 `AGENTS.md` 再根据截图补充词典。”*

### 📋 常用词典维护提示词（Prompt）模板

<details>
<summary><strong>1. 方式一：直接在聊天中发送截图（推荐 📸）</strong></summary>

如果您不方便打字，可以直接将未汉化干净的界面截图粘贴发送给 AI，并附带以下指令：

> **"请先阅读项目中的 `AGENTS.md`，识别截图中属于 Antigravity 固定界面的漏译文本，并按项目规则补充到词典或引擎中；不要翻译用户内容、路径、命令或诊断正文。"**
> *(AI 应先确认英文来源和界面语境，再选择固定词条或动态规则。)*

</details>

<details>
<summary><strong>2. 方式二：直接在聊天中发送文字描述（极速 ✍️）</strong></summary>

如果您只想修改或增加某一个特定词汇，可以直接发送文字描述给 AI：

> **"帮我把漏译的英文 'Allow agent to view and edit files outside of the current workspace automatically' 汉化为 '允许智能体自动查看并编辑当前工作区之外的文件'。"**
> *(AI 仍应先搜索现有词典并确认该文本是固定界面词条，再决定修改位置。)*

</details>

<details>
<summary><strong>3. 方式三：一键同步与审计官方插件市场（Marketplace 🧩）</strong></summary>

当 Antigravity 客户端更新版本后，官方插件市场可能会新增插件、更新建议提示词或下架旧插件。您可以直接向 AI 发送指令进行全自动比对审计：

> **"请使用 `sync-marketplace-plugins` 技能比对官方插件市场元数据，检查是否有新上架的插件、文案变动或下架插件，并输出比对报告。"**

AI 会自动激活内置技能并调用原生 Node.js 工具，以官方权威云端插件数据为基准比对 `dicts/marketplace_plugins.json`，并采用流式内存零落盘技术精准提取技能详情，呈现结构化清单并征求您的确认后再执行汉化或清理。

</details>

### 📝 自定义、高级开发与自动化质检指南

<details>
<summary><strong>点击展开查看词库维护、动态规则与双端测试门禁</strong></summary>

#### 1. 静态固定词条（修改 `dicts/*.json`）

对于界面上不含变量的固定标签、按钮文字、弹窗标题等，直接维护 `dicts/` 下的 JSON 文件：

- **`release.json`**：当前版本（`v2.35.0.1`）专用词典，适配官方版本迭代的独有界面；文件名固定，跨版本持续沿用。
- **`common.json`**：通用基础词汇、侧边栏概览、登录与引导流程、通用按钮与权限弹窗。
- **`menu_nav.json`**：系统菜单、顶部导航与状态栏菜单。
- **`page_agents.json`**：智能体、任务及会话管理相关页面。
- **`page_mcp_knowledge.json`**：MCP 服务器、知识库与扩展配置页面。
- **`marketplace_plugins.json`**：官方插件市场、插件详情与建议提示词。
- **`page_settings.json`**：详细参数设置面板与二级权限菜单。
- **`page_workspaces.json`**：工作区与项目管理相关页面。

在对应 JSON 中新增键值对即可：

```json
"Original English Text": "您的中文翻译"
```

#### 2. 动态文案与复杂 DOM 规则（修改 `localization_engine.js`）

包含**动态数字、时间、路径、分支**或属于 **React 碎片化分拆 / Electron 原生层组件**的文案，须在 `localization_engine.js` 对应转换函数（如 `getRelativeTimeTranslation`、`getVersionControlUiTranslation`、`getDynamicProductUiTranslation`）中编写带严格锚定（`^...$`）和捕获组的正则规则，严禁破坏原有 React 事件挂载与 DOM 结构。

#### 3. 插件市场自动审计与交付前自检命令

提交词典、引擎或 `Context Pro` 修改前，请执行对应的只读沙箱质检与单元测试：

```bash
# 1. 仅校验字典规范（JSON 语法、重复键、标点 1:1 对齐、孤立通配词禁令）
node scripts/ag_audit.js dicts

# 2. 完整校验引擎编译合法性与桌面壳锚点健康度
node scripts/ag_audit.js check

# 3. Context Pro 插件双端单元测试（修改 plugins/desktop-context/ 必跑）
python3 -m unittest discover -s plugins/desktop-context/tests
node --test plugins/desktop-context/tests/*.test.mjs

# 4. 官方插件市场云端元数据流式零落盘比对审计（加 --local 走离线缓存，加 --json 输出 JSON）
node .agents/skills/sync-marketplace-plugins/scripts/diff_marketplace_plugins.js
```

</details>

---

## 常见问题解答 (FAQ)

<details>
<summary><strong>1）提示“未检测到 Node.js 环境”</strong></summary>

* **原因**：核心引擎基于 Node.js `v18+` 原生标准库运行（无需额外安装 `npm` 第三方包）。
* **解决**：安装 Node.js LTS 版本（若启用 `Context Pro`，请确保系统同时具备 `python3`）：
  ```bash
  # macOS (使用 Homebrew)
  brew install node python

  # Windows (访问 https://nodejs.org 下载，或使用 winget)
  winget install OpenJS.NodeJS.LTS

  # Ubuntu/Debian
  sudo apt update && sudo apt install -y nodejs python3
  ```

</details>

<details>
<summary><strong>2）macOS 每次升级客户端或重打补丁后，「完全磁盘访问权限」总是静默失效怎么办？</strong></summary>

* **原因**：默认的 `adhoc` 临时签名在每次修改 `app.asar` 或升级软件后都会生成全新的 `CDHash`，导致 macOS TCC 权限记录失效。
* **根治方案**：开启本套件内置的 10 年期本地固定代码签名证书 `Antigravity Local Signer`：
  ```bash
  ./install.sh --setup-cert
  ./install.sh --resign-only
  tccutil reset All com.google.antigravity
  ```
  随后进入 **系统设置 -> 隐私与安全性 -> 完全磁盘访问权限**，点 **`−`** 移除旧的 `Antigravity` 项，再点 **`+`** 重新添加 `/Applications/Antigravity.app` 并开启。此后运行 `./install.sh` 会自动复用该固定证书，权限永久有效。

</details>

<details>
<summary><strong>3）macOS 双击 .command 提示“Apple无法验证...”或提示权限不足？</strong></summary>

* **Gatekeeper 网络隔离拦截解决（任选其一）**：
  - **方案 1（右键打开）**：在访达（Finder）中按住 **Control** 键点击 `双击安装中文汉化.command` -> 选择 **“打开”** -> 在弹窗中再次点击 **“打开”**。
  - **方案 2（终端清除隔离属性并运行，最推荐）**：
    ```bash
    cd /path/to/agy-desktop-exo
    xattr -d -r com.apple.quarantine .
    chmod +x *.command *.sh
    ./install.sh --lang zh --with-context
    ```
* **目录写入权限提示**：
  - **Windows**：默认普通双击 `.bat`；仅提示权限不足时右键选择 **“以管理员身份运行”**。
  - **macOS / Linux**：用户目录免提权；仅当安装在系统受保护目录且提示权限不足时使用 `sudo ./install.sh ...`（Linux 脚本会自动保留用户级 NVM/FNM Node.js 路径）。

</details>

<details>
<summary><strong>4）软件官方更新后，增强或汉化失效了怎么办？</strong></summary>

* 客户端升级时官方会覆盖 `app.asar` 文件。在外部独立终端重新运行一次您常用的安装命令（如 `./install.sh --lang zh --with-context` 或 `./install.sh --lang en --with-context`）即可秒级恢复全部增强与持久签名。

</details>

---

## 📜 开源许可与致谢（License & Acknowledgements）

本项目采用 **[MIT License](LICENSE)** 开源发布（`Copyright (c) 2026 jiangnanquan & Contributors`）。

- **汉化引擎与词典上游致谢**：本项目的中文汉化底座基于 [`Silas-02/antigravity-desktop-cn`](https://github.com/Silas-02/antigravity-desktop-cn)（原始上游 Fork 自 [`qqxpee/antigravity2-cn`](https://github.com/qqxpee/antigravity2-cn)）深度重构与持续演进，衷心感谢 **Silas-02** 与 **qqxpee** 的开拓性工作与开源贡献！
- **`Context Pro` 上游架构致谢**：`plugins/desktop-context` 的基础架构源自原作者 **Dimitrios Ioannidis** 开源的 [`dimitr-io/antigravity-desktop-context`](https://github.com/dimitr-io/antigravity-desktop-context)（MIT License），并融合借鉴了 [`pigzzz104/antigravity-context-pro`](https://github.com/pigzzz104/antigravity-context-pro) 的优秀设计理念，特此致谢！
