#!/usr/bin/env bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ORIG_ARGS=("$@")

# Ensure scripts have execute permission
chmod +x "$0" "$SCRIPT_DIR/install.sh" "$SCRIPT_DIR/uninstall.sh" "$SCRIPT_DIR/scripts/macos_codesign.sh" "$SCRIPT_DIR"/*.command 2>/dev/null || true

OS_NAME="$(uname -s)"
if [ "$OS_NAME" = "Darwin" ]; then
    PLATFORM_LABEL="macOS"
else
    PLATFORM_LABEL="Linux"
fi

normalize_lang() {
    local raw
    raw="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
    case "$raw" in
        en|english|en_*|en-*) printf 'en\n' ;;
        *) printf 'zh\n' ;;
    esac
}

UI_LANG="zh"
HAS_LANG_ARG=false
BRAND_TITLE=""
HAS_BRAND_ARG=false
WITH_CONTEXT=false
CONTEXT_ONLY=false
SETUP_CERT_ONLY=false
RESIGN_ONLY=false
STATUS_ONLY=false
CHECK_WRITE_ONLY=false
SHOW_HELP=false
INSTALL_DIR=""
NO_KILL=false
SKIP_SIGN=false
NO_RELAUNCH=false
FORCE_SELF=false
FORCE_QUIT=false
OPEN_AFTER=false
JSON_OUT=false
NO_WAIT=false

while [ $# -gt 0 ]; do
    case "$1" in
        --lang)
            if [ $# -lt 2 ]; then
                echo "[Error / 错误] --lang requires zh or en / --lang 需要传入 zh 或 en" >&2
                exit 1
            fi
            UI_LANG="$(normalize_lang "$2")"
            HAS_LANG_ARG=true
            shift 2
            ;;
        --lang=*)
            UI_LANG="$(normalize_lang "${1#*=}")"
            HAS_LANG_ARG=true
            shift
            ;;
        --brand-title)
            if [ $# -lt 2 ]; then
                echo "[Error / 错误] --brand-title requires english or hidden / --brand-title 需要传入参数" >&2
                exit 1
            fi
            BRAND_TITLE="$2"
            HAS_BRAND_ARG=true
            shift 2
            ;;
        --brand-title=*)
            BRAND_TITLE="${1#*=}"
            HAS_BRAND_ARG=true
            shift
            ;;
        --with-context)
            WITH_CONTEXT=true
            shift
            ;;
        --context-only)
            CONTEXT_ONLY=true
            shift
            ;;
        --setup-cert)
            SETUP_CERT_ONLY=true
            shift
            ;;
        --resign-only)
            RESIGN_ONLY=true
            shift
            ;;
        --status|--check-cert)
            STATUS_ONLY=true
            shift
            ;;
        --check-write)
            CHECK_WRITE_ONLY=true
            shift
            ;;
        --install-dir)
            if [ $# -lt 2 ]; then
                echo "[Error / 错误] --install-dir requires a directory path / --install-dir 需要传入目录路径" >&2
                exit 1
            fi
            INSTALL_DIR="$2"
            shift 2
            ;;
        --install-dir=*)
            INSTALL_DIR="${1#*=}"
            shift
            ;;
        --no-kill)
            NO_KILL=true
            shift
            ;;
        --skip-sign)
            SKIP_SIGN=true
            shift
            ;;
        --no-relaunch)
            NO_RELAUNCH=true
            shift
            ;;
        --force-self|--yes-kill-self)
            FORCE_SELF=true
            shift
            ;;
        --force-quit)
            FORCE_QUIT=true
            shift
            ;;
        --open)
            OPEN_AFTER=true
            shift
            ;;
        --json)
            JSON_OUT=true
            shift
            ;;
        --no-wait)
            NO_WAIT=true
            shift
            ;;
        -h|--help)
            SHOW_HELP=true
            shift
            ;;
        *)
            echo "[Error / 错误] Unknown option / 未知参数: $1" >&2
            echo "Run './install.sh --help' for usage / 请运行 './install.sh --help' 查看用法。" >&2
            exit 1
            ;;
    esac
done

IS_AUTOMATED=false
if [ "${#ORIG_ARGS[@]}" -gt 0 ] || [ ! -t 0 ]; then
    IS_AUTOMATED=true
fi

msg() {
    local zh_txt="$1"
    local en_txt="$2"
    if [ "$UI_LANG" = "en" ]; then
        printf '%s\n' "$en_txt"
    else
        printf '%s\n' "$zh_txt"
    fi
}

print_help() {
    if [ "$UI_LANG" = "en" ]; then
        cat <<'EOF'
Usage: ./install.sh [options]

Modular Options:
  --lang <zh|en>            UI language: 'en' keeps 100% official English UI + UX enhancements; 'zh' enables Simplified Chinese UI (default: zh)
  --with-context            Also deploy & inject Context Pro (Sidecar symlink + config + zero-CDP IPC bridge)
  --context-only            Deploy & inject Context Pro only (leave main UI / layout untouched)
  --brand-title <mode>      Top-left brand label: 'english' (default) or 'hidden'

macOS Persistent Signing:
  --setup-cert              [In-session safe] Idempotently create & trust 10-year "Antigravity Local Signer" cert
  --resign-only             Re-sign Antigravity.app Inside-Out without repacking app.asar
  --status, --check-cert    [Read-only] Inspect keychain certificate & app bundle signature status

Advanced / Automation:
  --install-dir <path>      Custom Antigravity installation or sandbox directory
  --no-kill                 Do not close or relaunch running Antigravity processes
  --skip-sign               Skip macOS code signing (for external multi-layer orchestrators)
  --no-relaunch             Do not relaunch Antigravity after patching
  --force-self              Bypass process-tree self-preservation guard
  --no-wait                 Skip 5-second exit countdown
  -h, --help                Show this help message
EOF
    else
        cat <<'EOF'
用法: ./install.sh [选项]

核心与模块化选项:
  --lang <zh|en>            界面语言：zh 启用简体中文全量汉化与增强（默认）；en 保留 100% 官方原版英文界面并启用宽屏/Office 增强
  --with-context            全家桶模式：部署第 1 层界面/UX 增强后，自动部署并叠加 Context Pro（零 CDP 遥测与蜂群雷达）
  --context-only            仅部署并叠加 Context Pro，不改动第 1 层主界面与宽屏设置
  --brand-title <mode>      左上角品牌显示方式：english（默认推荐）或 hidden（隐藏品牌名）

macOS 持久代码签名（防升级后 TCC 权限失效）:
  --setup-cert              【会话内安全】幂等创建并引导信任 10 年期本机签名证书（Antigravity Local Signer）
  --resign-only             【独立终端执行】不重打 ASAR，仅对目标 .app 执行 Inside-Out 持久重签名
  --status, --check-cert    【只读安全】查看钥匙串证书就绪状态与目标 .app 签名详情

进阶与自动化选项:
  --install-dir <path>      手动指定 Antigravity 安装目录（或离线沙箱测试目录）
  --no-kill                 不自动关闭或重启正在运行的 Antigravity 进程
  --skip-sign               跳过 macOS 代码签名（供外部多层补丁编排器末尾统一签名）
  --no-relaunch             安装完成后不自动拉起客户端
  --force-self              强制放行宿主进程树防自杀门禁（默认在 Antigravity 内置会话中以退出码 2 拦截）
  --no-wait                 跳过末尾 5 秒自动退出倒计时
  -h, --help                显示帮助信息
EOF
    fi
}

if [ "$SHOW_HELP" = true ]; then
    print_help
    exit 0
fi

# Safe in-session operations: --setup-cert and --status delegate immediately without touching app.asar
if [ "$SETUP_CERT_ONLY" = true ]; then
    CERT_ARGS=(--setup-cert)
    [ "$HAS_LANG_ARG" = true ] && CERT_ARGS+=(--lang "$UI_LANG")
    exec bash "$SCRIPT_DIR/scripts/macos_codesign.sh" "${CERT_ARGS[@]}"
fi

if [ "$STATUS_ONLY" = true ]; then
    STATUS_ARGS=(--status)
    [ "$HAS_LANG_ARG" = true ] && STATUS_ARGS+=(--lang "$UI_LANG")
    [ -n "$INSTALL_DIR" ] && STATUS_ARGS+=(--install-dir "$INSTALL_DIR")
    [ "$JSON_OUT" = true ] && STATUS_ARGS+=(--json)
    exec bash "$SCRIPT_DIR/scripts/macos_codesign.sh" "${STATUS_ARGS[@]}"
fi

wait_on_error() {
    if [ "$IS_AUTOMATED" = true ] || [ "$NO_WAIT" = true ]; then
        return 0
    fi
    echo ""
    if [ -t 0 ]; then
        read -rp "按 Enter 键退出..." _
    elif [ -e /dev/tty ]; then
        read -rp "按 Enter 键退出..." _ </dev/tty 2>/dev/null || true
    fi
}

resolve_target_user() {
    if [ "${EUID:-$(id -u)}" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
        printf '%s\n' "$SUDO_USER"
    else
        id -un
    fi
}

resolve_target_home() {
    local target_user="$1"
    if [ "${EUID:-$(id -u)}" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
        if [ "$OS_NAME" = "Darwin" ]; then
            local dscl_home=""
            dscl_home="$(dscl . -read "/Users/$target_user" NFSHomeDirectory 2>/dev/null | awk '{print $2}' || true)"
            if [ -n "$dscl_home" ] && [ -d "$dscl_home" ]; then
                printf '%s\n' "$dscl_home"
                return 0
            fi
            [ -d "/Users/$target_user" ] && { printf '/Users/%s\n' "$target_user"; return 0; }
        else
            local entry=""
            if command -v getent >/dev/null 2>&1; then
                entry="$(getent passwd "$target_user" 2>/dev/null | cut -d: -f6 || true)"
            fi
            if [ -n "$entry" ] && [ -d "$entry" ]; then
                printf '%s\n' "$entry"
                return 0
            fi
            [ -d "/home/$target_user" ] && { printf '/home/%s\n' "$target_user"; return 0; }
        fi
    fi
    printf '%s\n' "$HOME"
}

TARGET_USER="$(resolve_target_user)"
TARGET_HOME="$(resolve_target_home "$TARGET_USER")"
TARGET_GROUP="$(id -gn "$TARGET_USER" 2>/dev/null || true)"

run_as_target_user() {
    if [ "${EUID:-$(id -u)}" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
        sudo -u "$SUDO_USER" env "HOME=$TARGET_HOME" "PATH=$PATH" "$@"
    else
        env "HOME=$TARGET_HOME" "$@"
    fi
}

fix_user_ownership() {
    local target_path="$1"
    [ -e "$target_path" ] || [ -L "$target_path" ] || return 0
    if [ "${EUID:-$(id -u)}" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
        if [ -n "$TARGET_GROUP" ]; then
            chown -h "$TARGET_USER:$TARGET_GROUP" "$target_path" 2>/dev/null || chown -h "$TARGET_USER" "$target_path" 2>/dev/null || true
        else
            chown -h "$TARGET_USER" "$target_path" 2>/dev/null || true
        fi
    fi
}

is_inside_antigravity_tree() {
    local pid="$$"
    local hops=0
    while [ -n "$pid" ] && [ "$pid" -gt 1 ] && [ "$hops" -lt 24 ]; do
        local comm args_line base_comm
        comm="$(ps -o comm= -p "$pid" 2>/dev/null || true)"
        args_line="$(ps -o args= -p "$pid" 2>/dev/null || true)"
        base_comm="$(basename "$comm" 2>/dev/null || true)"
        if [[ "$comm" == *"/Antigravity.app/"* ]] || [ "$base_comm" = "Antigravity" ] || [[ "$args_line" == *"/Antigravity.app/"* ]] || [[ "$comm" == *"/antigravity/antigravity"* ]]; then
            return 0
        fi
        pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
        hops=$((hops + 1))
    done
    return 1
}

format_rerun_command() {
    local cmd="cd \"$SCRIPT_DIR\" && ./install.sh"
    local a
    for a in "${ORIG_ARGS[@]}"; do
        if [[ "$a" == *[[:space:]]* ]]; then
            cmd="$cmd \"$a\""
        else
            cmd="$cmd $a"
        fi
    done
    printf '%s\n' "$cmd"
}

find_mac_app_bundle() {
    if [ "$OS_NAME" != "Darwin" ]; then
        return 0
    fi
    if [ -z "$INSTALL_DIR" ]; then
        if [ -d "/Applications/Antigravity.app" ]; then
            printf '/Applications/Antigravity.app\n'
        elif [ -d "$TARGET_HOME/Applications/Antigravity.app" ]; then
            printf '%s\n' "$TARGET_HOME/Applications/Antigravity.app"
        fi
        return 0
    fi
    local cur="$INSTALL_DIR"
    if [ -d "$cur" ]; then
        cur="$(cd "$cur" && pwd -P)"
    fi
    local probe="$cur"
    while [ -n "$probe" ] && [ "$probe" != "/" ] && [ "$probe" != "." ]; do
        case "$probe" in
            *.app|*.APP)
                printf '%s\n' "$probe"
                return 0
                ;;
        esac
        probe="$(dirname "$probe")"
    done
    if [ -d "$cur/Antigravity.app" ]; then
        printf '%s\n' "$cur/Antigravity.app"
    fi
}

# Handle --resign-only before Node check (uses macos_codesign.sh directly, with sudo elevation if needed)
if [ "$RESIGN_ONLY" = true ]; then
    RESIGN_ARGS=(--resign-only --lang "$UI_LANG")
    [ -n "$INSTALL_DIR" ] && RESIGN_ARGS+=(--install-dir "$INSTALL_DIR")
    [ "$NO_KILL" = true ] && RESIGN_ARGS+=(--no-kill)
    [ "$FORCE_SELF" = true ] && RESIGN_ARGS+=(--force-self)
    [ "$FORCE_QUIT" = true ] && RESIGN_ARGS+=(--force-quit)
    [ "$OPEN_AFTER" = true ] && RESIGN_ARGS+=(--open)

    MAC_BUNDLE_FOR_RESIGN="$(find_mac_app_bundle)"
    if [ "$FORCE_SELF" = false ] && { [ "$NO_KILL" = false ] || [ -z "$INSTALL_DIR" ] || [ "$MAC_BUNDLE_FOR_RESIGN" = "/Applications/Antigravity.app" ]; } && is_inside_antigravity_tree; then
        bash "$SCRIPT_DIR/scripts/macos_codesign.sh" "${RESIGN_ARGS[@]}"
        exit $?
    fi

    if [ "$OS_NAME" = "Darwin" ] && [ -n "$MAC_BUNDLE_FOR_RESIGN" ] && [ -d "$MAC_BUNDLE_FOR_RESIGN" ] && [ ! -w "$MAC_BUNDLE_FOR_RESIGN" ] && [ "$(id -u)" -ne 0 ]; then
        if command -v sudo >/dev/null 2>&1; then
            msg "[提示] 重签名 $MAC_BUNDLE_FOR_RESIGN 需要管理员权限，正在请求 sudo 提权..." \
                "[Info] Administrator privileges required to re-sign $MAC_BUNDLE_FOR_RESIGN; requesting sudo..."
            exec sudo env "PATH=$PATH" bash "$SCRIPT_DIR/scripts/macos_codesign.sh" "${RESIGN_ARGS[@]}"
        fi
    fi
    exec bash "$SCRIPT_DIR/scripts/macos_codesign.sh" "${RESIGN_ARGS[@]}"
fi

# Locate Node.js runtime (handling standard paths, user NVM/fnm/volta/pnpm under sudo)
find_node_dir() {
    if command -v node >/dev/null 2>&1; then
        local node_bin
        node_bin="$(command -v node)"
        echo "${node_bin%/*}"
        return 0
    fi
    for p in /opt/homebrew/bin /usr/local/bin /opt/local/bin; do
        if [ -f "$p/node" ] && [ -x "$p/node" ]; then
            echo "$p"
            return 0
        fi
    done
    local homes=()
    [ -n "$HOME" ] && homes+=("$HOME")
    [ -n "$TARGET_HOME" ] && [ "$TARGET_HOME" != "$HOME" ] && homes+=("$TARGET_HOME")
    for h in "${homes[@]}"; do
        [ -d "$h" ] || continue
        for cand in \
            "$h/.local/bin" \
            "$h/bin" \
            "$h/.volta/bin" \
            "$h/.asdf/shims" \
            "$h/.local/share/mise/shims" \
            "$h/Library/pnpm" \
            "$h/.n/bin" \
            "$h/.local/share/pnpm" \
            "$h/.nvm/current/bin" \
            "$h/.local/share/fnm/aliases/default/bin" \
            "$h/.fnm/aliases/default/bin" \
            "$h/.local/share/fnm/current/bin" \
            "$h/.fnm/current/bin"; do
            if [ -f "$cand/node" ] && [ -x "$cand/node" ]; then
                echo "$cand"
                return 0
            fi
        done
        local latest_nvm=""
        for nvm_node in "$h"/.nvm/versions/node/*/bin/node; do
            if [ -f "$nvm_node" ] && [ -x "$nvm_node" ]; then
                latest_nvm="$nvm_node"
            fi
        done
        if [ -n "$latest_nvm" ]; then
            echo "${latest_nvm%/*}"
            return 0
        fi
        local latest_fnm=""
        for fnm_node in "$h"/.local/share/fnm/node-versions/*/installation/bin/node; do
            if [ -f "$fnm_node" ] && [ -x "$fnm_node" ]; then
                latest_fnm="$fnm_node"
            fi
        done
        if [ -n "$latest_fnm" ]; then
            echo "${latest_fnm%/*}"
            return 0
        fi
    done
    for p in /usr/bin /bin /usr/sbin /sbin; do
        if [ -f "$p/node" ] && [ -x "$p/node" ]; then
            echo "$p"
            return 0
        fi
    done
    return 1
}

NODE_DIR="$(find_node_dir || true)"
if [ -n "$NODE_DIR" ]; then
    export PATH="$NODE_DIR:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
    echo ""
    msg "[错误] 未检测到 Node.js 环境！需要 Node.js v18+（https://nodejs.org/ 或 brew install node）。" \
        "[Error] Node.js runtime not found! Node.js v18+ is required (https://nodejs.org/ or brew install node)." >&2
    wait_on_error
    exit 1
fi

ENGINE_DIR_ARGS=()
if [ -n "$INSTALL_DIR" ]; then
    ENGINE_DIR_ARGS=(--install-dir "$INSTALL_DIR")
fi

# Safe read-only write-permission probe
if [ "$CHECK_WRITE_ONLY" = true ]; then
    exec node "$SCRIPT_DIR/localization_engine.js" --check-write "${ENGINE_DIR_ARGS[@]}"
fi

# Host Self-Preservation Guard (MUST run before sudo prompt or killing live Antigravity)
TARGET_MAC_BUNDLE="$(find_mac_app_bundle)"
IS_LIVE_HOST_TARGET=false
if [ -z "$INSTALL_DIR" ] || [ "$TARGET_MAC_BUNDLE" = "/Applications/Antigravity.app" ]; then
    IS_LIVE_HOST_TARGET=true
fi

if [ "$FORCE_SELF" = false ] && { [ "$NO_KILL" = false ] || [ "$IS_LIVE_HOST_TARGET" = true ]; } && is_inside_antigravity_tree; then
    RERUN_CMD="$(format_rerun_command)"
    cat >&2 <<EOF
[安全拦截 / Host Self-Preservation Guard]
检测到当前正运行在 Antigravity Desktop 客户端进程树内！
Detected execution inside an active Antigravity Desktop session!

改写 app.asar 需要先退出客户端，在内置会话中直接执行会立即中断当前任务。
Patching app.asar requires closing Antigravity, which would immediately terminate this session.

请打开系统独立外部终端（Terminal / iTerm2 / Ghostty 等）运行以下命令：
Please run the following command from an external terminal (Terminal / iTerm2 / Ghostty):

  $RERUN_CMD
EOF
    exit 2
fi

# Check if target installation directory requires elevated permissions
set +e
if [ "$CONTEXT_ONLY" = true ] && [ -f "$SCRIPT_DIR/plugins/desktop-context/scripts/context_bridge_patcher.js" ]; then
    node "$SCRIPT_DIR/plugins/desktop-context/scripts/context_bridge_patcher.js" --check-write "${ENGINE_DIR_ARGS[@]}" >/dev/null 2>&1
    CHECK_STATUS=$?
else
    node "$SCRIPT_DIR/localization_engine.js" --check-write "${ENGINE_DIR_ARGS[@]}" >/dev/null 2>&1
    CHECK_STATUS=$?
fi
set -e

if [ "$CHECK_STATUS" -eq 2 ] && [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        msg "[提示] 检测到 Antigravity 安装在系统目录，需要管理员权限，正在请求 sudo 提权..." \
            "[Info] Antigravity is installed in a system directory; requesting sudo privileges..."
        if [ -x "$SCRIPT_DIR/install.sh" ]; then
            exec sudo env "PATH=$PATH" "ANTIGRAVITY_GEMINI_DIR=${ANTIGRAVITY_GEMINI_DIR:-}" "$SCRIPT_DIR/install.sh" "${ORIG_ARGS[@]}"
        else
            exec sudo env "PATH=$PATH" "ANTIGRAVITY_GEMINI_DIR=${ANTIGRAVITY_GEMINI_DIR:-}" bash "$SCRIPT_DIR/install.sh" "${ORIG_ARGS[@]}"
        fi
    else
        msg "[权限不足] 目标安装目录需要 root 权限，且当前环境未找到 sudo 命令。" \
            "[Permission Denied] Target directory requires root privileges and sudo was not found." >&2
        wait_on_error
        exit 1
    fi
fi

GEMINI_BASE_DIR="${ANTIGRAVITY_GEMINI_DIR:-$TARGET_HOME/.gemini}"

detect_existing_meme_overlay() {
    node -e '
const fs = require("fs");
const path = require("path");
const manual = process.argv[1] || "";
const targetHome = process.argv[2] || process.env.HOME || "";
const cands = [];
if (manual) {
    cands.push(
        path.join(manual, "app.asar"),
        path.join(manual, "resources", "app.asar"),
        path.join(manual, "Contents", "Resources", "app.asar"),
        path.join(manual, "Antigravity.app", "Contents", "Resources", "app.asar")
    );
} else {
    cands.push(
        "/Applications/Antigravity.app/Contents/Resources/app.asar",
        path.join(targetHome, "Applications", "Antigravity.app", "Contents", "Resources", "app.asar"),
        "/opt/Antigravity/resources/app.asar",
        "/usr/share/antigravity/resources/app.asar",
        "/usr/lib/antigravity/resources/app.asar"
    );
}
for (const p of cands) {
    try {
        if (fs.existsSync(p)) {
            const buf = fs.readFileSync(p);
            if (buf.includes("ag-meme-renderer-v2")) {
                process.exit(0);
            }
            process.exit(1);
        }
    } catch (_) {}
}
process.exit(1);
' "$INSTALL_DIR" "$TARGET_HOME" >/dev/null 2>&1
}

quit_live_app_for_context_only() {
    [ "$NO_KILL" = true ] && return 0
    if [ "$OS_NAME" = "Darwin" ]; then
        local app_bundle="${TARGET_MAC_BUNDLE:-/Applications/Antigravity.app}"
        local app_exec="$app_bundle/Contents/MacOS/Antigravity"
        if pgrep -f "$app_exec" >/dev/null 2>&1; then
            msg ">>> 正在关闭运行中的 Antigravity ($app_bundle)..." \
                ">>> Closing running Antigravity ($app_bundle)..."
            run_as_target_user osascript -e 'tell application "Antigravity" to quit' >/dev/null 2>&1 || true
            local waited=0
            while pgrep -f "$app_exec" >/dev/null 2>&1; do
                sleep 1
                waited=$((waited + 1))
                if [ "$waited" -ge 12 ]; then
                    pkill -TERM -f "$app_exec" >/dev/null 2>&1 || true
                    sleep 1
                    break
                fi
            done
        fi
    else
        pkill -TERM -x antigravity >/dev/null 2>&1 || true
    fi
}

deploy_context_pro_files() {
    local ctx_src="$SCRIPT_DIR/plugins/desktop-context"
    if [ ! -d "$ctx_src" ] || [ ! -f "$ctx_src/install.sh" ]; then
        msg "[错误] 未找到内置 Context Pro 模块目录: $ctx_src" \
            "[Error] Built-in Context Pro directory not found: $ctx_src" >&2
        return 1
    fi

    local plugins_dir="$GEMINI_BASE_DIR/config/plugins"
    local ctx_link="$plugins_dir/desktop-context"
    local cfg_path="$GEMINI_BASE_DIR/context-pro-config.json"

    mkdir -p "$GEMINI_BASE_DIR" "$GEMINI_BASE_DIR/config" "$plugins_dir"
    fix_user_ownership "$GEMINI_BASE_DIR"
    fix_user_ownership "$GEMINI_BASE_DIR/config"
    fix_user_ownership "$plugins_dir"

    if [ -L "$ctx_link" ]; then
        ln -sfn "$ctx_src" "$ctx_link"
    elif [ -e "$ctx_link" ]; then
        local bak_dir="${ctx_link}.bak.$(date +%Y%m%d%H%M%S)"
        mv "$ctx_link" "$bak_dir"
        fix_user_ownership "$bak_dir"
        msg "[备份] 已将原有非软链目录备份至: $bak_dir" \
            "[Backup] Backed up existing directory to: $bak_dir"
        ln -sfn "$ctx_src" "$ctx_link"
    else
        ln -s "$ctx_src" "$ctx_link"
    fi
    fix_user_ownership "$ctx_link"
    msg "[挂载] Context Pro 插件软链已就绪: $ctx_link -> $ctx_src" \
        "[Link] Context Pro plugin linked: $ctx_link -> $ctx_src"

    local explicit_lang=""
    if [ "$HAS_LANG_ARG" = true ]; then
        explicit_lang="$UI_LANG"
    fi

    node -e '
const fs = require("fs");
const path = require("path");
const cfgPath = process.argv[1];
const explicitLang = process.argv[2] || "";

let cfg = {};
if (fs.existsSync(cfgPath)) {
    try {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            cfg = parsed;
        }
    } catch (_) {
        const bak = cfgPath + ".bak." + Date.now();
        fs.copyFileSync(cfgPath, bak);
    }
}

if (explicitLang === "zh" || explicitLang === "en") {
    cfg.lang = explicitLang;
} else if (typeof cfg.lang !== "string" || !cfg.lang.trim()) {
    cfg.lang = "auto";
}

if (!cfg.audit_rules || typeof cfg.audit_rules !== "object" || Array.isArray(cfg.audit_rules)) {
    cfg.audit_rules = {
        enabled: false,
        forbidden_patterns: [],
        warn_worker_patterns: [],
        safe_worker_patterns: [],
        exempt_role_keywords: ["coordinator", "council"]
    };
}

fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n", { encoding: "utf8", mode: 0o644 });
' "$cfg_path" "$explicit_lang"

    chmod 0644 "$cfg_path" 2>/dev/null || true
    fix_user_ownership "$cfg_path"
    msg "[配置] 已同步 Context Pro 配置文件: $cfg_path" \
        "[Config] Updated Context Pro config: $cfg_path"

    local agy_bin=""
    agy_bin="$(command -v agy 2>/dev/null || true)"
    if [ -z "$agy_bin" ] && [ -x "$TARGET_HOME/.local/bin/agy" ]; then
        agy_bin="$TARGET_HOME/.local/bin/agy"
    fi
    if [ -n "$agy_bin" ] && [ -x "$agy_bin" ]; then
        run_as_target_user "$agy_bin" plugin enable desktop-context >/dev/null 2>&1 || true
    fi
}

reapply_meme_overlay_if_needed() {
    local meme_install="$GEMINI_BASE_DIR/config/plugins/agy-meme/install.sh"
    if [ "$HAD_MEME_OVERLAY" = true ] && [ -f "$meme_install" ]; then
        msg ">>> 检测到升级前已安装 agy-meme 猫娘贴纸层，正在自动保留叠加..." \
            ">>> Detected existing agy-meme sticker overlay; re-applying automatically..."
        local meme_args=(--no-kill)
        [ -n "$INSTALL_DIR" ] && meme_args+=(--install-dir "$INSTALL_DIR")
        HOME="$TARGET_HOME" bash "$meme_install" "${meme_args[@]}"
    fi
}

inject_context_pro_bridge() {
    msg ">>> 正在叠加注入 Context Pro 零 CDP Electron IPC 桥接层..." \
        ">>> Injecting Context Pro zero-CDP Electron IPC bridge..."
    local ctx_args=(--no-kill --force-self)
    if [ "$OS_NAME" = "Darwin" ] || [ "$SKIP_SIGN" = true ]; then
        ctx_args+=(--skip-sign)
    fi
    [ -n "$INSTALL_DIR" ] && ctx_args+=(--install-dir "$INSTALL_DIR")
    ANTIGRAVITY_GEMINI_DIR="$GEMINI_BASE_DIR" HOME="$TARGET_HOME" bash "$SCRIPT_DIR/plugins/desktop-context/install.sh" "${ctx_args[@]}"
}

finalize_macos_signature() {
    [ "$OS_NAME" = "Darwin" ] || return 0
    if [ "$SKIP_SIGN" = true ]; then
        msg "[跳过] 检测到 --skip-sign 参数，跳过最终 macOS 重签名。" \
            "[Skip] --skip-sign specified; skipping final macOS code signing."
        return 0
    fi
    local app_bundle
    app_bundle="$(find_mac_app_bundle)"
    if [ -z "$app_bundle" ] || [ ! -d "$app_bundle" ]; then
        msg "[跳过] 目标目录非 macOS .app 包结构，跳过 macOS 重签名。" \
            "[Skip] Target directory is not inside a macOS .app bundle; skipping code signing."
        return 0
    fi
    bash "$SCRIPT_DIR/scripts/macos_codesign.sh" \
        --resign-only \
        --no-kill \
        --force-self \
        --lang "$UI_LANG" \
        --install-dir "$app_bundle"
}

# Pre-detect existing agy-meme Layer 2 before Layer 1 repacks app.asar from app.asar.bak
HAD_MEME_OVERLAY=false
if [ "$CONTEXT_ONLY" = false ] && [ -f "$GEMINI_BASE_DIR/config/plugins/agy-meme/install.sh" ]; then
    if detect_existing_meme_overlay; then
        HAD_MEME_OVERLAY=true
    fi
fi

# Determine brand title arguments (never block on read when automated flags are passed)
BRAND_ARGS=()
if [ "$CONTEXT_ONLY" = false ]; then
    if [ "$HAS_BRAND_ARG" = true ]; then
        BRAND_ARGS=(--brand-title "$BRAND_TITLE")
    elif [ "$IS_AUTOMATED" = true ] || [ "$UI_LANG" = "en" ]; then
        BRAND_ARGS=(--brand-title english)
    else
        echo ""
        echo "=========================================="
        echo "  Antigravity 中文汉化与 EXO 增强安装工具 ($PLATFORM_LABEL)"
        echo "=========================================="
        echo ""
        echo "请选择左上角品牌显示方式："
        echo "  [1] 显示英文 Antigravity（默认推荐）"
        echo "  [2] 不显示品牌名"
        echo ""
        CHOICE_VAL=""
        if [ -t 0 ]; then
            read -rp "请输入选项 [1/2]（直接按 Enter 默认为 1）: " CHOICE_VAL
        fi
        case "$CHOICE_VAL" in
            2) BRAND_ARGS=(--brand-title hidden) ;;
            *) BRAND_ARGS=(--brand-title english) ;;
        esac
    fi
fi

NEEDS_MULTI_STAGE_SIGN=false
if [ "$WITH_CONTEXT" = true ] || [ "$CONTEXT_ONLY" = true ] || [ "$HAD_MEME_OVERLAY" = true ]; then
    NEEDS_MULTI_STAGE_SIGN=true
fi

if [ "$CONTEXT_ONLY" = true ]; then
    echo ""
    msg "[1/2] 正在部署并注入 Context Pro 模块..." \
        "[1/2] Deploying & injecting Context Pro module..."
    quit_live_app_for_context_only
    deploy_context_pro_files
    inject_context_pro_bridge
    finalize_macos_signature
else
    echo ""
    msg "[1/2] 正在注入 Antigravity Desktop EXO 核心引擎 (--lang $UI_LANG)..." \
        "[1/2] Applying Antigravity Desktop EXO core engine (--lang $UI_LANG)..."

    ENGINE_RUN_ARGS=("${BRAND_ARGS[@]}" --lang "$UI_LANG" "${ENGINE_DIR_ARGS[@]}")
    [ "$NO_KILL" = true ] && ENGINE_RUN_ARGS+=(--no-kill)
    if [ "$SKIP_SIGN" = true ] || [ "$NEEDS_MULTI_STAGE_SIGN" = true ]; then
        ENGINE_RUN_ARGS+=(--skip-sign)
    fi
    if [ "$NO_RELAUNCH" = true ] || [ "$NEEDS_MULTI_STAGE_SIGN" = true ]; then
        ENGINE_RUN_ARGS+=(--no-relaunch)
    fi

    if ! node "$SCRIPT_DIR/localization_engine.js" "${ENGINE_RUN_ARGS[@]}"; then
        echo ""
        msg "[错误] 核心引擎注入失败，请检查上方错误信息。" \
            "[Error] Core engine injection failed. Please check the error output above." >&2
        if [ "$(id -u)" -ne 0 ]; then
            msg "提示：如提示权限不足 (EACCES)，请使用 sudo ./install.sh 重试。" \
                "Tip: If you see EACCES permission errors, retry with sudo ./install.sh." >&2
        fi
        wait_on_error
        exit 1
    fi

    reapply_meme_overlay_if_needed

    if [ "$WITH_CONTEXT" = true ]; then
        echo ""
        deploy_context_pro_files
        inject_context_pro_bridge
    fi

    if [ "$NEEDS_MULTI_STAGE_SIGN" = true ]; then
        echo ""
        finalize_macos_signature
    fi
fi

echo ""
msg "[2/2] 部署完成！" "[2/2] Deployment complete!"
echo ""
if [ "$CONTEXT_ONLY" = true ]; then
    msg "提示：Context Pro 已成功挂载并注入，请重新启动 Antigravity 客户端生效。" \
        "Info: Context Pro has been linked and injected. Please restart Antigravity Desktop."
elif [ "$UI_LANG" = "en" ]; then
    if [ "$WITH_CONTEXT" = true ]; then
        echo "Info: Official English UI + EXO Enhancements + Context Pro deployed successfully."
    else
        echo "Info: Official English UI + EXO Enhancements (94% Wide Chat & Office/EPUB Preview) deployed."
    fi
    echo "Please launch or restart Antigravity Desktop to enjoy the enhanced experience!"
else
    if [ "$WITH_CONTEXT" = true ]; then
        echo "提示：简体中文汉化 + 宽屏/Office 预览 + Context Pro 全家桶已成功部署！"
    else
        echo "提示：简体中文汉化与 UX 增强已成功部署！"
    fi
    echo "请启动或重启 Antigravity 客户端即可畅享增强体验！"
fi
echo ""

if [ "$IS_AUTOMATED" = false ] && [ "$NO_WAIT" = false ]; then
    for i in 5 4 3 2 1; do
        printf "\r窗口将在 %d 秒后自动退出（按 Enter 立即退出）... " "$i"
        if [ -t 0 ]; then
            read -t 1 -r && break || true
        else
            sleep 1
        fi
    done
    printf "\r\033[K已就绪，正在退出...\n"
fi
