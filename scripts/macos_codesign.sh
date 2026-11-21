#!/usr/bin/env bash
# ==============================================================================
# agy-desktop-exo: Standalone macOS Persistent Code-Signing Utility
# Supports: --setup-cert | --resign-only | --status | --lang zh|en
# Zero external dependencies; preserves macOS TCC permissions across updates.
# ==============================================================================
set -euo pipefail

SELF_SCRIPT="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SELF_SCRIPT")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

CODESIGN_IDENTITY="${AGY_CODESIGN_IDENTITY:-Antigravity Local Signer}"
DEFAULT_APP_PATH="${AGY_APP_PATH:-/Applications/Antigravity.app}"

MODE="status"
INSTALL_DIR=""
UI_LANG=""
NO_KILL=false
FORCE_SELF=false
FORCE_QUIT=false
OPEN_AFTER=false
JSON_OUT=false

detect_default_lang() {
  local raw="${AGY_LANG:-${LC_ALL:-${LANG:-zh}}}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    en|en_*|en-*|english|c|posix) printf 'en\n' ;;
    *) printf 'zh\n' ;;
  esac
}

normalize_lang() {
  local raw
  raw="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    en|english|en_*|en-*) printf 'en\n' ;;
    *) printf 'zh\n' ;;
  esac
}

print_help() {
  local lang="$1"
  if [ "$lang" = "en" ]; then
    cat <<'EOF'
Usage: bash scripts/macos_codesign.sh [mode] [options]

Modes:
  --setup-cert              Idempotently create & trust local code-signing cert ("Antigravity Local Signer")
  --resign-only             Clear quarantine xattrs and perform Inside-Out code signing without touching app.asar
  --status                  Read-only check of login keychain certificate & target .app signature (default)

Options:
  --install-dir <path>      Target Antigravity.app (or Resources) path (default: /Applications/Antigravity.app)
  --lang <zh|en>            Output language (zh or en)
  --no-kill                 Do not quit running Antigravity before signing
  --force-self              Bypass anti-suicide guard when running inside Antigravity's own process tree
  --force-quit              Send SIGTERM if Antigravity does not exit within timeout
  --open                    Relaunch Antigravity.app after --resign-only completes
  --json                    Print JSON output (for --status)
  -h, --help                Show this help message
EOF
  else
    cat <<'EOF'
用法: bash scripts/macos_codesign.sh [模式] [选项]

模式:
  --setup-cert              【会话内安全】幂等创建并信任本机固定代码签名证书（默认 Antigravity Local Signer）
  --resign-only             【独立终端执行】不修改 app.asar，清理 xattr 并对目标 .app 执行 Inside-Out 重签名与严格校验
  --status                  【只读安全】输出登录钥匙串证书就绪态与目标 .app 签名模式、Authority、CDHash（默认）

选项:
  --install-dir <path>      指定目标 Antigravity.app（或内部 Resources 目录，默认 /Applications/Antigravity.app）
  --lang <zh|en>            提示输出语言（zh 或 en）
  --no-kill                 签名前不自动关闭运行中的 Antigravity
  --force-self              强制放行进程树防自杀门禁（默认在客户端内置终端中拦截并返回退出码 2）
  --force-quit              若优雅退出超时则发送 SIGTERM 强制结束客户端进程
  --open                    在 --resign-only 完成后自动重新打开目标 Antigravity.app
  --json                    以 JSON 格式输出状态（配合 --status）
  -h, --help                显示帮助信息
EOF
  fi
}

SHOW_HELP=false
while [ $# -gt 0 ]; do
  case "$1" in
    --setup-cert)
      MODE="setup-cert"
      shift
      ;;
    --resign-only)
      MODE="resign-only"
      shift
      ;;
    --status|--check)
      MODE="status"
      shift
      ;;
    --install-dir)
      if [ $# -lt 2 ]; then
        echo "[Error] --install-dir requires a path / --install-dir 需要传入目录路径" >&2
        exit 1
      fi
      INSTALL_DIR="$2"
      shift 2
      ;;
    --install-dir=*)
      INSTALL_DIR="${1#*=}"
      shift
      ;;
    --lang)
      if [ $# -lt 2 ]; then
        echo "[Error] --lang requires zh or en / --lang 需要传入 zh 或 en" >&2
        exit 1
      fi
      UI_LANG="$(normalize_lang "$2")"
      shift 2
      ;;
    --lang=*)
      UI_LANG="$(normalize_lang "${1#*=}")"
      shift
      ;;
    --no-kill)
      NO_KILL=true
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
    -h|--help)
      SHOW_HELP=true
      shift
      ;;
    *)
      echo "[Error / 错误] Unknown option / 未知参数: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$UI_LANG" ]; then
  UI_LANG="$(detect_default_lang)"
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

if [ "$SHOW_HELP" = true ]; then
  print_help "$UI_LANG"
  exit 0
fi

if [ "$(uname -s)" != "Darwin" ]; then
  if [ "$MODE" = "status" ] && [ "$JSON_OUT" = true ]; then
    printf '{"platform":"%s","supported":false}\n' "$(uname -s)"
    exit 0
  fi
  msg "[跳过] 当前系统非 macOS，无需执行 macOS 代码签名操作。" \
      "[Skip] Current OS is not macOS; macOS code-signing is not applicable."
  exit 0
fi

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
    local dscl_home=""
    dscl_home="$(dscl . -read "/Users/$target_user" NFSHomeDirectory 2>/dev/null | awk '{print $2}' || true)"
    if [ -n "$dscl_home" ] && [ -d "$dscl_home" ]; then
      printf '%s\n' "$dscl_home"
      return 0
    fi
    if [ -d "/Users/$target_user" ]; then
      printf '/Users/%s\n' "$target_user"
      return 0
    fi
  fi
  printf '%s\n' "${HOME:-/Users/$target_user}"
}

TARGET_USER="$(resolve_target_user)"
TARGET_HOME="$(resolve_target_home "$TARGET_USER")"
KEYCHAIN_DB="$TARGET_HOME/Library/Keychains/login.keychain-db"
if [ ! -f "$KEYCHAIN_DB" ] && [ -f "$TARGET_HOME/Library/Keychains/login.keychain" ]; then
  KEYCHAIN_DB="$TARGET_HOME/Library/Keychains/login.keychain"
fi

run_as_target_user() {
  if [ "${EUID:-$(id -u)}" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    sudo -u "$SUDO_USER" env "HOME=$TARGET_HOME" "$@"
  else
    "$@"
  fi
}

resolve_app_bundle() {
  local raw="${1:-}"
  if [ -z "$raw" ]; then
    printf '%s\n' "$DEFAULT_APP_PATH"
    return 0
  fi

  local cur="$raw"
  if [ -e "$cur" ]; then
    if [ -f "$cur" ]; then
      cur="$(cd "$(dirname "$cur")" && pwd -P)"
    else
      cur="$(cd "$cur" && pwd -P)"
    fi
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
    return 0
  fi

  printf '%s\n' "$raw"
}

TARGET_APP="$(resolve_app_bundle "$INSTALL_DIR")"

is_inside_antigravity_tree() {
  local pid="$$"
  local hops=0
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] && [ "$hops" -lt 24 ]; do
    local comm args_line base_comm
    comm="$(ps -o comm= -p "$pid" 2>/dev/null || true)"
    args_line="$(ps -o args= -p "$pid" 2>/dev/null || true)"
    base_comm="$(basename "$comm" 2>/dev/null || true)"
    if [[ "$comm" == *"/Antigravity.app/"* ]] || [ "$base_comm" = "Antigravity" ] || [[ "$args_line" == *"/Antigravity.app/"* ]]; then
      return 0
    fi
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
    hops=$((hops + 1))
  done
  return 1
}

has_valid_codesign_identity() {
  local identities_out=""
  if [ -f "$KEYCHAIN_DB" ]; then
    identities_out="$(security find-identity -v -p codesigning "$KEYCHAIN_DB" 2>/dev/null || true)"
  else
    identities_out="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  fi
  printf '%s\n' "$identities_out" | grep -v "CSSMERR_" | grep -Fq "\"${CODESIGN_IDENTITY}\""
}

has_untrusted_codesign_identity() {
  local all_identities_out=""
  if [ -f "$KEYCHAIN_DB" ]; then
    all_identities_out="$(security find-identity -p codesigning "$KEYCHAIN_DB" 2>/dev/null || true)"
  else
    all_identities_out="$(security find-identity -p codesigning 2>/dev/null || true)"
  fi
  printf '%s\n' "$all_identities_out" | grep -Fq "\"${CODESIGN_IDENTITY}\""
}

export_existing_codesign_cert() {
  local dest_crt="$1"
  local all_identities_out target_sha1 certs_dump
  all_identities_out="$(security find-identity -p codesigning "$KEYCHAIN_DB" 2>/dev/null || true)"
  target_sha1="$(printf '%s\n' "$all_identities_out" | grep -F "\"${CODESIGN_IDENTITY}\"" | head -n 1 | grep -Eo '[0-9A-Fa-f]{40}' | head -n 1 || true)"
  certs_dump="$(security find-certificate -a -c "$CODESIGN_IDENTITY" -Z -p "$KEYCHAIN_DB" 2>/dev/null || true)"

  if [ -n "$target_sha1" ] && [ -n "$certs_dump" ]; then
    if awk -v target="$(printf '%s' "$target_sha1" | tr '[:lower:]' '[:upper:]')" '
      /^SHA-1 hash:/ {
        h = toupper($3)
        match_cert = (h == target)
        in_pem = 0
      }
      /-----BEGIN CERTIFICATE-----/ {
        if (match_cert) {
          in_pem = 1
        }
      }
      in_pem { print }
      /-----END CERTIFICATE-----/ {
        if (in_pem) {
          found = 1
          exit 0
        }
      }
      END {
        if (!found) exit 1
      }
    ' <<< "$certs_dump" > "$dest_crt" 2>/dev/null && [ -s "$dest_crt" ]; then
      return 0
    fi
  fi

  security find-certificate -c "$CODESIGN_IDENTITY" -p "$KEYCHAIN_DB" > "$dest_crt"
}

provision_or_trust_codesign_cert() {
  local tmp_dir="$1"

  if has_untrusted_codesign_identity; then
    msg ">>> 检测到登录钥匙串已存在同名证书 ($CODESIGN_IDENTITY) 但尚未受信任，正在导出并请求代码签名信任..." \
        ">>> Found existing certificate ($CODESIGN_IDENTITY) in login keychain without code-signing trust; requesting trust..."
    local existing_crt="$tmp_dir/existing.crt"
    if ! export_existing_codesign_cert "$existing_crt" || [ ! -s "$existing_crt" ]; then
      msg "[错误] 导出已有同名证书失败: $CODESIGN_IDENTITY" \
          "[Error] Failed to export existing certificate: $CODESIGN_IDENTITY" >&2
      return 1
    fi
    msg ">>> 请在弹出的 macOS 授权窗口中使用 Touch ID 或输入系统密码批准证书信任..." \
        ">>> Please approve certificate trust via Touch ID or password in the macOS prompt..."
    run_as_target_user security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN_DB" "$existing_crt"
    return 0
  fi

  msg ">>> 登录钥匙串尚无 \"$CODESIGN_IDENTITY\"，正在生成 10 年期本机固定代码签名证书..." \
      ">>> Generating 10-year local persistent code-signing certificate \"$CODESIGN_IDENTITY\"..."
  local openssl_bin
  openssl_bin="$(command -v openssl 2>/dev/null || printf '/usr/bin/openssl')"
  local key_file="$tmp_dir/signer.key"
  local crt_file="$tmp_dir/signer.crt"
  local p12_file="$tmp_dir/signer.p12"
  local p12_pass="agy-local-signer-$$-$(date +%s)"

  "$openssl_bin" req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$key_file" \
    -out "$crt_file" \
    -subj "/CN=${CODESIGN_IDENTITY}/O=Local Dev Persistence" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "keyUsage=critical,digitalSignature" \
    -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1

  local legacy_args=()
  if "$openssl_bin" pkcs12 -help 2>&1 | grep -q -- '-legacy'; then
    legacy_args=(-legacy)
  fi

  "$openssl_bin" pkcs12 -export "${legacy_args[@]}" \
    -inkey "$key_file" \
    -in "$crt_file" \
    -name "$CODESIGN_IDENTITY" \
    -passout "pass:${p12_pass}" \
    -out "$p12_file" >/dev/null 2>&1

  chmod 0644 "$crt_file" "$p12_file"
  chmod 0755 "$tmp_dir"

  msg ">>> 正在将证书与私钥导入登录钥匙串 ($KEYCHAIN_DB)..." \
      ">>> Importing certificate and private key into login keychain ($KEYCHAIN_DB)..."
  run_as_target_user security import "$p12_file" \
    -k "$KEYCHAIN_DB" \
    -P "$p12_pass" \
    -T /usr/bin/codesign \
    -T /usr/bin/security >/dev/null

  msg ">>> 请在弹出的 macOS 授权窗口中使用 Touch ID 或输入系统密码批准代码签名信任..." \
      ">>> Please approve code-signing trust via Touch ID or password in the macOS prompt..."
  run_as_target_user security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN_DB" "$crt_file"
}

setup_codesign_cert() {
  if has_valid_codesign_identity; then
    msg "[就绪] 本机固定代码签名证书已存在且受信任 ($CODESIGN_IDENTITY)" \
        "[Ready] Local persistent code-signing certificate is valid and trusted ($CODESIGN_IDENTITY)"
    return 0
  fi

  local tmp_dir rc=0
  tmp_dir="$(mktemp -d /tmp/agy_cert_setup.XXXXXX)"
  provision_or_trust_codesign_cert "$tmp_dir" || rc=$?
  rm -rf "$tmp_dir"

  if [ "$rc" -ne 0 ]; then
    msg "[错误] 配置本机固定代码签名证书失败 (退出码: $rc)。" \
        "[Error] Failed to configure local persistent code-signing certificate (exit code: $rc)." >&2
    return "$rc"
  fi

  if has_valid_codesign_identity; then
    msg "[就绪] 本机固定代码签名证书已配置完成并受信任 ($CODESIGN_IDENTITY)" \
        "[Ready] Local persistent code-signing certificate is now active and trusted ($CODESIGN_IDENTITY)"
    return 0
  fi

  msg "[错误] 证书导入已完成，但 security find-identity -v 仍未识别到有效的 \"$CODESIGN_IDENTITY\"，请打开「钥匙串访问」检查代码签名信任策略。" \
      "[Error] Certificate imported, but security find-identity -v still does not report \"$CODESIGN_IDENTITY\" as valid. Please check Keychain Access trust settings." >&2
  return 1
}

quit_running_app() {
  local app_bundle="$1"
  local timeout_sec="${2:-12}"
  local target_exec="$app_bundle/Contents/MacOS/Antigravity"

  if ! pgrep -f "$target_exec" >/dev/null 2>&1; then
    return 0
  fi

  msg ">>> 正在关闭运行中的 Antigravity ($app_bundle)..." \
      ">>> Closing running Antigravity ($app_bundle)..."
  if [ "$app_bundle" = "/Applications/Antigravity.app" ]; then
    run_as_target_user osascript -e 'tell application "Antigravity" to quit' >/dev/null 2>&1 || true
  else
    run_as_target_user osascript -e "tell application \"$app_bundle\" to quit" >/dev/null 2>&1 || true
  fi

  local waited=0
  while pgrep -f "$target_exec" >/dev/null 2>&1; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge "$timeout_sec" ]; then
      if [ "$FORCE_QUIT" = true ]; then
        pkill -TERM -f "$target_exec" >/dev/null 2>&1 || true
        sleep 2
        break
      else
        msg "[错误] Antigravity 未能在 ${timeout_sec} 秒内退出，请手动完全退出客户端后重试（或加 --force-quit）。" \
            "[Error] Antigravity did not exit within ${timeout_sec}s. Please quit Antigravity manually and retry (or pass --force-quit)." >&2
        return 1
      fi
    fi
  done
}

is_macho_file() {
  local target_file="$1"
  [ -f "$target_file" ] && [ ! -L "$target_file" ] || return 1
  local desc
  desc="$(file -b "$target_file" 2>/dev/null || true)"
  case "$desc" in
    *Mach-O*) return 0 ;;
    *) return 1 ;;
  esac
}

apply_inside_out_codesign() {
  local target_app="$1"
  if [ ! -d "$target_app" ]; then
    msg "[错误] 待签名目标应用不存在: $target_app" \
        "[Error] Target app bundle does not exist: $target_app" >&2
    return 1
  fi

  if [ ! -w "$target_app" ] && [ "${EUID:-$(id -u)}" -ne 0 ]; then
    msg "[错误] 对 $target_app 缺少写入权限，请使用 sudo 运行重签名命令。" \
        "[Error] Write permission denied for $target_app. Please re-run with sudo." >&2
    return 1
  fi

  msg ">>> 正在清理 macOS 隔离属性 (xattr -cr): $target_app" \
      ">>> Clearing macOS quarantine attributes (xattr -cr): $target_app"
  xattr -cr "$target_app"

  local sign_identity="-"
  local use_persistent=false
  local kc_args=()

  if has_valid_codesign_identity; then
    sign_identity="$CODESIGN_IDENTITY"
    use_persistent=true
    if [ -f "$KEYCHAIN_DB" ]; then
      kc_args=(--keychain "$KEYCHAIN_DB")
    fi
    msg ">>> 正在使用本机固定证书 ($CODESIGN_IDENTITY) 执行 Inside-Out 持久签名..." \
        ">>> Performing Inside-Out persistent code signing with \"$CODESIGN_IDENTITY\"..."
  else
    msg ">>> 未检测到受信任的 \"$CODESIGN_IDENTITY\" 证书，正在使用 adhoc (-) 执行 Inside-Out 签名..." \
        ">>> No trusted \"$CODESIGN_IDENTITY\" certificate found; falling back to adhoc (-) Inside-Out signing..."
  fi

  local frameworks_dir="$target_app/Contents/Frameworks"
  if [ -d "$frameworks_dir" ]; then
    local fw_item
    for fw_item in "$frameworks_dir"/*; do
      [ -e "$fw_item" ] || [ -L "$fw_item" ] || continue
      case "$fw_item" in
        *.framework|*.app)
          codesign --force --deep "${kc_args[@]}" --sign "$sign_identity" "$fw_item"
          ;;
        *.dylib)
          codesign --force "${kc_args[@]}" --sign "$sign_identity" "$fw_item"
          ;;
      esac
    done
  fi

  local res_bin_dir="$target_app/Contents/Resources/bin"
  if [ -d "$res_bin_dir" ]; then
    local bin_item
    for bin_item in "$res_bin_dir"/*; do
      if is_macho_file "$bin_item"; then
        codesign --force "${kc_args[@]}" --sign "$sign_identity" "$bin_item"
      fi
    done
  fi

  # 严禁加 --preserve-metadata=flags,runtime 或 --options runtime：
  # 无 Apple Team ID 的自签名/adhoc 证书开启 Hardened Runtime 会触发 dyld Library Validation 导致启动即崩溃 (SIGABRT)。
  codesign --force --deep "${kc_args[@]}" --sign "$sign_identity" "$target_app"

  msg ">>> 正在校验 macOS 应用签名完整性 (codesign --verify --deep --strict)..." \
      ">>> Verifying macOS bundle signature integrity (codesign --verify --deep --strict)..."
  codesign --verify --deep --strict "$target_app"

  if [ "$use_persistent" = true ]; then
    local dv_out auth_line cdhash_line
    dv_out="$(codesign -dvvv "$target_app" 2>&1 || true)"
    auth_line="$(printf '%s\n' "$dv_out" | grep -m1 '^Authority=' || echo "Authority=$CODESIGN_IDENTITY")"
    cdhash_line="$(printf '%s\n' "$dv_out" | grep -m1 '^CDHash=' || echo "CDHash=unknown")"
    msg "[完成] 持久证书代码签名与严格校验通过 ($auth_line, $cdhash_line)" \
        "[Done] Persistent certificate signature & strict verification passed ($auth_line, $cdhash_line)"
  else
    msg "[完成] adhoc 自签名与严格校验通过（提示：运行 ./install.sh --setup-cert 可配置固定证书，防止升级后 macOS TCC 权限失效）" \
        "[Done] Adhoc signature & strict verification passed (Tip: run ./install.sh --setup-cert to preserve macOS TCC permissions across updates)"
  fi
}

resign_only_flow() {
  if [ "$FORCE_SELF" = false ] && { [ "$NO_KILL" = false ] || [ -z "$INSTALL_DIR" ] || [ "$TARGET_APP" = "$DEFAULT_APP_PATH" ]; } && is_inside_antigravity_tree; then
    local rerun_cmd="bash \"$REPO_ROOT/install.sh\" --resign-only"
    if [ -n "$INSTALL_DIR" ]; then
      rerun_cmd="$rerun_cmd --install-dir \"$INSTALL_DIR\""
    fi
    if [ "$UI_LANG" = "en" ]; then
      rerun_cmd="$rerun_cmd --lang en"
    fi
    cat >&2 <<EOF
[安全拦截 / Safety Guard] 检测到当前命令运行在 Antigravity 客户端进程树内！
Detected execution inside a live Antigravity.app process tree!

直接关闭并重签名运行中的客户端会立即中断当前会话。请在独立外部终端（Terminal / iTerm / Ghostty）中执行：
Quitting and re-signing the live app would terminate this session. Please run from an external terminal (Terminal / iTerm / Ghostty):

  $rerun_cmd
EOF
    exit 2
  fi

  if [ ! -d "$TARGET_APP" ]; then
    msg "[错误] 未找到目标应用目录: $TARGET_APP" \
        "[Error] Target application bundle not found: $TARGET_APP" >&2
    exit 1
  fi

  if [ "$NO_KILL" = false ]; then
    quit_running_app "$TARGET_APP" 12
  fi

  apply_inside_out_codesign "$TARGET_APP"

  if [ "$OPEN_AFTER" = true ]; then
    run_as_target_user open -a "$TARGET_APP"
  fi
}

json_escape() {
  local s="${1:-}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/}"
  printf '%s' "$s"
}

print_codesign_status() {
  local cert_state="missing"
  local cert_valid=false
  if has_valid_codesign_identity; then
    cert_state="valid"
    cert_valid=true
  elif has_untrusted_codesign_identity; then
    cert_state="untrusted"
  fi

  local app_exists=false
  local sign_mode="not_installed"
  local authority=""
  local cdhash=""
  local designated_req=""

  if [ -d "$TARGET_APP" ]; then
    app_exists=true
    local dv_out dv_rc=0
    dv_out="$(codesign -dvvv "$TARGET_APP" 2>&1)" || dv_rc=$?
    authority="$(printf '%s\n' "$dv_out" | sed -n 's/^Authority=//p' | head -n 1 || true)"
    cdhash="$(printf '%s\n' "$dv_out" | sed -n 's/^CDHash=//p' | head -n 1 || true)"

    if [ -n "$authority" ]; then
      sign_mode="persistent_cert"
    elif printf '%s\n' "$dv_out" | grep -Eq '^Signature=adhoc$|^CodeDirectory .*adhoc'; then
      sign_mode="adhoc"
    elif [ "$dv_rc" -ne 0 ]; then
      sign_mode="unsigned_or_invalid"
    else
      sign_mode="unknown"
    fi

    local dr_out
    dr_out="$(codesign -dr - "$TARGET_APP" 2>&1 || true)"
    designated_req="$(printf '%s\n' "$dr_out" | sed -n 's/.*designated => //p' | head -n 1 || true)"
  fi

  if [ "$JSON_OUT" = true ]; then
    printf '{"identity":"%s","keychain":"%s","certState":"%s","certValid":%s,"appPath":"%s","appExists":%s,"mode":"%s","authority":%s,"cdhash":%s,"designatedRequirement":%s}\n' \
      "$(json_escape "$CODESIGN_IDENTITY")" \
      "$(json_escape "$KEYCHAIN_DB")" \
      "$cert_state" \
      "$cert_valid" \
      "$(json_escape "$TARGET_APP")" \
      "$app_exists" \
      "$sign_mode" \
      "$( [ -n "$authority" ] && printf '"%s"' "$(json_escape "$authority")" || printf 'null' )" \
      "$( [ -n "$cdhash" ] && printf '"%s"' "$(json_escape "$cdhash")" || printf 'null' )" \
      "$( [ -n "$designated_req" ] && printf '"%s"' "$(json_escape "$designated_req")" || printf 'null' )"
    return 0
  fi

  if [ "$UI_LANG" = "en" ]; then
    echo "=========================================================="
    echo "  macOS Code-Signing & Certificate Status"
    echo "=========================================================="
    echo "  Keychain Path      : $KEYCHAIN_DB"
    echo "  Signer Identity    : $CODESIGN_IDENTITY"
    case "$cert_state" in
      valid)     echo "  Certificate Status : READY (valid & trusted for code signing)" ;;
      untrusted) echo "  Certificate Status : UNTRUSTED (present in keychain, run --setup-cert to trust)" ;;
      *)         echo "  Certificate Status : MISSING (run ./install.sh --setup-cert to create)" ;;
    esac
    echo "  Target App Bundle  : $TARGET_APP"
    echo "  Signature Mode     : $sign_mode"
    echo "  Authority          : ${authority:-(none / adhoc)}"
    echo "  CDHash             : ${cdhash:-(none)}"
    if [ -n "$designated_req" ]; then
      echo "  Designated Req     : $designated_req"
    fi
    echo "=========================================================="
  else
    echo "=========================================================="
    echo "  macOS 持久代码签名与证书状态检查"
    echo "=========================================================="
    echo "  登录钥匙串路径 : $KEYCHAIN_DB"
    echo "  目标签名证书名 : $CODESIGN_IDENTITY"
    case "$cert_state" in
      valid)     echo "  钥匙串证书状态 : 已就绪 (有效且受信任)" ;;
      untrusted) echo "  钥匙串证书状态 : 待信任 (已存在但未授信，可运行 ./install.sh --setup-cert 授信)" ;;
      *)         echo "  钥匙串证书状态 : 未创建 (可运行 ./install.sh --setup-cert 一键创建)" ;;
    esac
    echo "  目标客户端路径 : $TARGET_APP"
    echo "  当前签名模式   : $sign_mode"
    echo "  签名 Authority : ${authority:-(无 / adhoc)}"
    echo "  当前 CDHash    : ${cdhash:-(无)}"
    if [ -n "$designated_req" ]; then
      echo "  指定要求 (DR)  : $designated_req"
    fi
    echo "=========================================================="
  fi
}

case "$MODE" in
  setup-cert)  setup_codesign_cert ;;
  resign-only) resign_only_flow ;;
  status)      print_codesign_status ;;
esac
