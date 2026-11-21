#!/usr/bin/env bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ORIG_ARGS=("$@")

# Ensure scripts have execute permission
chmod +x "$0" "$SCRIPT_DIR/install.sh" "$SCRIPT_DIR/uninstall.sh" "$SCRIPT_DIR/scripts/macos_codesign.sh" "$SCRIPT_DIR"/*.command 2>/dev/null || true

OS_NAME="$(uname -s)"

normalize_lang() {
    local raw
    raw="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
    case "$raw" in
        en|english|en_*|en-*) printf 'en\n' ;;
        *) printf 'zh\n' ;;
    esac
}

UI_LANG="zh"
WITH_CONTEXT=false
CONTEXT_ONLY=false
SHOW_HELP=false
INSTALL_DIR=""
NO_KILL=false
SKIP_SIGN=false
NO_RELAUNCH=false
FORCE_SELF=false
NO_WAIT=false

while [ $# -gt 0 ]; do
    case "$1" in
        --lang)
            if [ $# -lt 2 ]; then
                echo "[Error / 错误] --lang requires zh or en / --lang 需要传入 zh 或 en" >&2
                exit 1
            fi
            UI_LANG="$(normalize_lang "$2")"
            shift 2
            ;;
        --lang=*)
            UI_LANG="$(normalize_lang "${1#*=}")"
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
            echo "Run './uninstall.sh --help' for usage / 请运行 './uninstall.sh --help' 查看用法。" >&2
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
Usage: ./uninstall.sh [options]

Options:
  --with-context            Restore untouched official app.asar.bak AND remove Context Pro plugin symlink
  --context-only            Detach Context Pro bridge & symlink only (preserve Chinese/English UX & agy-meme)
  --lang <zh|en>            Output language (default: zh)
  --install-dir <path>      Custom Antigravity installation or sandbox directory
  --no-kill                 Do not close or relaunch running Antigravity processes
  --skip-sign               Skip macOS code signing
  --no-relaunch             Do not relaunch Antigravity after restoring
  --force-self              Bypass process-tree self-preservation guard
  --no-wait                 Skip 5-second exit countdown
  -h, --help                Show this help message
EOF
    else
        cat <<'EOF'
用法: ./uninstall.sh [选项]

选项:
  --with-context            完整还原官方原版 app.asar.bak，并移除指向本仓库的 Context Pro 插件软链
  --context-only            仅无损剥离 Context Pro 桥接层并移除本仓库插件软链（完好保留汉化/宽屏与 agy-meme）
  --lang <zh|en>            输出提示语言（默认 zh）
  --install-dir <path>      手动指定 Antigravity 安装目录（或离线沙箱测试目录）
  --no-kill                 不自动关闭或重启正在运行的 Antigravity 进程
  --skip-sign               跳过 macOS 代码签名
  --no-relaunch             还原完成后不自动拉起客户端
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

run_as_target_user() {
    if [ "${EUID:-$(id -u)}" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
        sudo -u "$SUDO_USER" env "HOME=$TARGET_HOME" "PATH=$PATH" "$@"
    else
        env "HOME=$TARGET_HOME" "$@"
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
    local cmd="cd \"$SCRIPT_DIR\" && ./uninstall.sh"
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

还原或剥离 app.asar 补丁需要先退出客户端，在内置会话中直接执行会立即中断当前任务。
Restoring or detaching patches from app.asar requires closing Antigravity, which would terminate this session.

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
        if [ -x "$SCRIPT_DIR/uninstall.sh" ]; then
            exec sudo env "PATH=$PATH" "ANTIGRAVITY_GEMINI_DIR=${ANTIGRAVITY_GEMINI_DIR:-}" "$SCRIPT_DIR/uninstall.sh" "${ORIG_ARGS[@]}"
        else
            exec sudo env "PATH=$PATH" "ANTIGRAVITY_GEMINI_DIR=${ANTIGRAVITY_GEMINI_DIR:-}" bash "$SCRIPT_DIR/uninstall.sh" "${ORIG_ARGS[@]}"
        fi
    else
        msg "[权限不足] 目标安装目录需要 root 权限，且当前环境未找到 sudo 命令。" \
            "[Permission Denied] Target directory requires root privileges and sudo was not found." >&2
        wait_on_error
        exit 1
    fi
fi

GEMINI_BASE_DIR="${ANTIGRAVITY_GEMINI_DIR:-$TARGET_HOME/.gemini}"

remove_context_pro_link() {
    local ctx_link="$GEMINI_BASE_DIR/config/plugins/desktop-context"
    local repo_ctx="$SCRIPT_DIR/plugins/desktop-context"
    if [ -L "$ctx_link" ]; then
        local link_target=""
        link_target="$(node -e '
const fs = require("fs");
const path = require("path");
const linkPath = process.argv[1];
try {
    process.stdout.write(fs.realpathSync(linkPath));
} catch (_) {
    try {
        const raw = fs.readlinkSync(linkPath);
        process.stdout.write(path.resolve(path.dirname(linkPath), raw));
    } catch (_) {}
}
' "$ctx_link")"
        local repo_ctx_real="$repo_ctx"
        if [ -d "$repo_ctx" ]; then
            repo_ctx_real="$(cd "$repo_ctx" && pwd -P)"
        fi
        if [ "$link_target" = "$repo_ctx_real" ] || [[ "$link_target" == "$SCRIPT_DIR/"* ]]; then
            rm -f "$ctx_link"
            msg "[移除] 已移除指向本仓库的 Context Pro 插件软链: $ctx_link" \
                "[Remove] Removed Context Pro plugin symlink: $ctx_link"
            local agy_bin=""
            agy_bin="$(command -v agy 2>/dev/null || true)"
            if [ -z "$agy_bin" ] && [ -x "$TARGET_HOME/.local/bin/agy" ]; then
                agy_bin="$TARGET_HOME/.local/bin/agy"
            fi
            if [ -n "$agy_bin" ] && [ -x "$agy_bin" ]; then
                run_as_target_user "$agy_bin" plugin disable desktop-context >/dev/null 2>&1 || true
            fi
        else
            msg "[保留] $ctx_link 指向外部仓库 ($link_target)，未做删除。" \
                "[Keep] $ctx_link points to an external path ($link_target); left untouched."
        fi
    fi
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

finalize_macos_signature() {
    [ "$OS_NAME" = "Darwin" ] || return 0
    if [ "$SKIP_SIGN" = true ]; then
        return 0
    fi
    local app_bundle
    app_bundle="$(find_mac_app_bundle)"
    if [ -z "$app_bundle" ] || [ ! -d "$app_bundle" ]; then
        return 0
    fi
    bash "$SCRIPT_DIR/scripts/macos_codesign.sh" \
        --resign-only \
        --no-kill \
        --force-self \
        --lang "$UI_LANG" \
        --install-dir "$app_bundle"
}

if [ "$CONTEXT_ONLY" = true ]; then
    echo ""
    msg "[1/2] 正在无损剥离 Context Pro 桥接层与软链..." \
        "[1/2] Detaching Context Pro bridge & plugin symlink..."
    quit_live_app_for_context_only
    CTX_UNINSTALL_ARGS=(--no-kill --force-self)
    if [ "$OS_NAME" = "Darwin" ] || [ "$SKIP_SIGN" = true ]; then
        CTX_UNINSTALL_ARGS+=(--skip-sign)
    fi
    [ -n "$INSTALL_DIR" ] && CTX_UNINSTALL_ARGS+=(--install-dir "$INSTALL_DIR")
    ANTIGRAVITY_GEMINI_DIR="$GEMINI_BASE_DIR" HOME="$TARGET_HOME" bash "$SCRIPT_DIR/plugins/desktop-context/uninstall.sh" "${CTX_UNINSTALL_ARGS[@]}"
    remove_context_pro_link
    finalize_macos_signature
else
    echo ""
    msg "[1/2] 正在从 app.asar.bak 还原官方原版程序包..." \
        "[1/2] Restoring untouched official bundle from app.asar.bak..."

    ENGINE_RESTORE_ARGS=(--huifu --lang "$UI_LANG" "${ENGINE_DIR_ARGS[@]}")
    [ "$NO_KILL" = true ] && ENGINE_RESTORE_ARGS+=(--no-kill)
    [ "$SKIP_SIGN" = true ] && ENGINE_RESTORE_ARGS+=(--skip-sign)
    [ "$NO_RELAUNCH" = true ] && ENGINE_RESTORE_ARGS+=(--no-relaunch)

    if ! node "$SCRIPT_DIR/localization_engine.js" "${ENGINE_RESTORE_ARGS[@]}"; then
        echo ""
        msg "[错误] 还原失败，请检查上方错误信息。" \
            "[Error] Restore failed. Please check the error output above." >&2
        if [ "$(id -u)" -ne 0 ]; then
            msg "提示：如提示权限不足 (EACCES)，请使用 sudo ./uninstall.sh 重试。" \
                "Tip: If you see EACCES permission errors, retry with sudo ./uninstall.sh." >&2
        fi
        wait_on_error
        exit 1
    fi

    if [ "$WITH_CONTEXT" = true ]; then
        remove_context_pro_link
    fi
fi

echo ""
msg "[2/2] 还原完成！" "[2/2] Restore complete!"
echo ""
if [ "$CONTEXT_ONLY" = true ]; then
    msg "提示：Context Pro 已无损剥离，原有界面配置已完整保留。" \
        "Info: Context Pro has been cleanly detached; your main UI configuration remains intact."
else
    msg "提示：Antigravity 已恢复至官方原版英文状态。" \
        "Info: Antigravity Desktop has been restored to its untouched official state."
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
