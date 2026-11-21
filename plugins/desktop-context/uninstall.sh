#!/usr/bin/env bash
set -euo pipefail

# antigravity-context-pro 零 CDP 桥接层无损卸载脚本（macOS / Linux）
# 仅剥离 context-bridge 标记区块，完好保留汉化与 agy-meme 猫娘表情包。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PATCHER="$SCRIPT_DIR/scripts/context_bridge_patcher.js"

if [ ! -f "$PATCHER" ]; then
  echo "[错误] 未找到桥接补丁脚本: $PATCHER" >&2
  exit 1
fi

PASSTHROUGH_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-kill|--skip-sign|--force-self)
      PASSTHROUGH_ARGS+=("$1")
      shift
      ;;
    --install-dir)
      if [ $# -lt 2 ]; then
        echo "[错误] --install-dir 需要传入目录路径" >&2
        exit 1
      fi
      PASSTHROUGH_ARGS+=("--install-dir" "$2")
      shift 2
      ;;
    --install-dir=*)
      PASSTHROUGH_ARGS+=("$1")
      shift
      ;;
    -h|--help)
      exec node "$PATCHER" --help
      ;;
    *)
      echo "[错误] 未知参数: $1" >&2
      exit 1
      ;;
  esac
done

resolve_target_user_home() {
  if [ "${EUID:-$(id -u)}" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    if [ "$(uname -s)" = "Darwin" ]; then
      dscl . -read "/Users/$SUDO_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}' || eval echo "~$SUDO_USER"
    else
      getent passwd "$SUDO_USER" 2>/dev/null | cut -d: -f6 || eval echo "~$SUDO_USER"
    fi
  else
    printf '%s\n' "$HOME"
  fi
}

find_node_bin() {
  local cand home_dir
  home_dir="$(resolve_target_user_home)"
  for cand in \
    "${AGY_CONTEXT_NODE_BIN:-}" \
    "$(command -v node 2>/dev/null || true)" \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node" \
    "/usr/bin/node" \
    "$home_dir/.local/share/fnm/aliases/default/bin/node" \
    "$home_dir/.fnm/aliases/default/bin/node" \
    "$home_dir/.volta/bin/node" \
    "$home_dir/.nvm/versions/node"/*/bin/node \
    "$home_dir/.local/share/fnm/node-versions"/*/installation/bin/node; do
    if [ -n "$cand" ] && [ -x "$cand" ]; then
      printf '%s\n' "$cand"
      return 0
    fi
  done
  return 1
}

NODE_BIN="$(find_node_bin || true)"
if [ -z "$NODE_BIN" ]; then
  echo "[错误] 未找到 Node.js (需要 v18+)。" >&2
  exit 1
fi

TARGET_HOME="$(resolve_target_user_home)"
export PATH="$(cd "$(dirname "$NODE_BIN")" && pwd -P):$PATH"

set +e
HOME="$TARGET_HOME" "$NODE_BIN" "$PATCHER" --check-write "${PASSTHROUGH_ARGS[@]}"
WRITE_CHECK_RC=$?
set -e

if [ "$WRITE_CHECK_RC" -eq 0 ]; then
  HOME="$TARGET_HOME" "$NODE_BIN" "$PATCHER" --uninstall "${PASSTHROUGH_ARGS[@]}"
elif [ "$WRITE_CHECK_RC" -eq 2 ]; then
  echo "[权限] Antigravity 安装目录需要管理员权限，请输入密码以继续："
  sudo env "HOME=$TARGET_HOME" "PATH=$PATH" "AGY_CODESIGN_IDENTITY=${AGY_CODESIGN_IDENTITY:-}" "$NODE_BIN" "$PATCHER" --uninstall "${PASSTHROUGH_ARGS[@]}"
elif [ "$WRITE_CHECK_RC" -eq 3 ]; then
  echo "[提示] 未检测到 Antigravity Desktop 安装目录，跳过 ASAR 剥离。"
else
  exit 1
fi
