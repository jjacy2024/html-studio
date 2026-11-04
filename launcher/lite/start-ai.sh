#!/bin/sh
# macOS bootstrap. No global install, PATH changes, sudo, or security-policy changes.
set -eu
umask 077
SCRIPT_DIR=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
EDITOR_DIR=$(dirname "$SCRIPT_DIR")
INSTALL=0 CHECK=0 NO_SYSTEM=0 NODE_OVERRIDE='' ARCHIVE_OVERRIDE=''
RUNTIME_BASE="$HOME/Library/Application Support/html-studio/runtime"
fail(){ printf '%s\n' "$*" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --install) INSTALL=1; shift ;;
    --check) CHECK=1; shift ;;
    --no-system-node) NO_SYSTEM=1; shift ;;
    --cache-dir|--node|--archive)
      [ "$#" -ge 2 ] || fail "$1 缺少参数"
      case "$1" in --cache-dir) RUNTIME_BASE=$2 ;; --node) NODE_OVERRIDE=$2 ;; --archive) ARCHIVE_OVERRIDE=$2 ;; esac
      shift 2 ;;
    --) shift; break ;;
    *) fail "未知参数：$1。连接器参数请放在 -- 后。" ;;
  esac
done
[ "$(uname -s)" = Darwin ] || fail '此启动脚本用于 macOS；Windows 请使用 start-ai.ps1。'
[ -f "$EDITOR_DIR/HTML Studio.html" ] && [ -f "$SCRIPT_DIR/connector.cjs" ] || fail '请完整解压安装包，并保留 connector 文件夹。'
case "$RUNTIME_BASE" in /*) ;; *) fail '运行环境目录必须是绝对路径。' ;; esac
NODE='' SOURCE=''
probe(){
  [ -x "$1" ] || return 1
  found=$("$1" -p "Number(process.versions.node.split('.')[0]) >= 24 ? process.execPath : ''" 2>/dev/null) || return 1
  [ -n "$found" ] && [ -x "$found" ] || return 1
  NODE=$found
}
if [ -n "$NODE_OVERRIDE" ]; then
  probe "$NODE_OVERRIDE" || fail '指定的 Node.js 不可运行或版本低于 24。'
  SOURCE=selected
elif [ "$NO_SYSTEM" -eq 0 ]; then
  candidate=$(command -v node || true)
  if [ -n "$candidate" ] && probe "$candidate"; then SOURCE=system; fi
  if [ -z "$NODE" ]; then
    for candidate in /opt/homebrew/bin/node /usr/local/bin/node /opt/local/bin/node "$HOME/.local/bin/node" "$HOME/.volta/bin/node" "$HOME"/.nvm/versions/node/v*/bin/node; do
      if probe "$candidate"; then SOURCE=system; break; fi
    done
  fi
fi
case "$(uname -m)" in
  arm64) VARIANT=darwin-arm64 ;;
  x86_64) VARIANT=darwin-x64 ;;
  *) fail '暂不支持此 Mac 架构。' ;;
esac
VERSION=v24.22.2
case "$VARIANT" in
  darwin-arm64) SHA=aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a ;;
  darwin-x64) SHA=d5e336d588c45be0c37dbd52cc29895593009ca4997a77a1fd02815131ed0e52 ;;
esac
PREFIX=node-$VERSION-$VARIANT
TARGET="$RUNTIME_BASE/$PREFIX"
if [ -z "$NODE" ] && probe "$TARGET/node"; then SOURCE=cached; fi
if [ -z "$NODE" ]; then
  if [ "$INSTALL" -ne 1 ]; then
    printf '%s\n' '未找到兼容的 Node.js（需要 24 或更高）。请把 HTML 入口中的启动提示词发给 Agent，或显式添加 --install 从官网下载本工具专用运行环境。' >&2
    exit 2
  fi
  mkdir -p "$RUNTIME_BASE"
  LOCK="$TARGET.install-lock"
  mkdir "$LOCK" 2>/dev/null || fail '此运行环境正在安装，或上次安装未正常结束。请确认没有安装任务后再检查锁目录，不要同时重复启动。'
  STAGE=''
  cleanup(){ [ -z "$STAGE" ] || rm -rf "$STAGE"; rmdir "$LOCK" 2>/dev/null || true; }
  trap cleanup EXIT
  trap 'exit 130' HUP INT TERM
  # Recheck inside the lock in case another installer just finished.
  if probe "$TARGET/node"; then SOURCE=cached
  else
    STAGE=$(mktemp -d "$RUNTIME_BASE/.download.XXXXXX")
    ARCHIVE="$STAGE/$PREFIX.tar.gz"
    if [ -n "$ARCHIVE_OVERRIDE" ]; then
      [ -f "$ARCHIVE_OVERRIDE" ] || fail '离线安装文件不存在。'
      cp "$ARCHIVE_OVERRIDE" "$ARCHIVE"
    else
      printf '%s\n' '正在从 nodejs.org 下载本工具专用 Node.js。只需首次下载，安装包本身不会增大。' >&2
      /usr/bin/curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 --retry 2 --output "$ARCHIVE" "https://nodejs.org/dist/$VERSION/$PREFIX.tar.gz" || fail '下载失败，请检查网络后重试；现有 Node.js 和编辑器未被替换。'
    fi
    ACTUAL=$(/usr/bin/shasum -a 256 "$ARCHIVE"); ACTUAL=${ACTUAL%% *}
    [ "$ACTUAL" = "$SHA" ] || fail '下载文件的 SHA-256 校验不匹配，已停止安装，不能执行此文件。'
    mkdir "$STAGE/unpack" "$STAGE/ready"
    /usr/bin/tar -xzf "$ARCHIVE" -C "$STAGE/unpack" "$PREFIX/bin/node" "$PREFIX/LICENSE"
    mv "$STAGE/unpack/$PREFIX/bin/node" "$STAGE/ready/node"
    mv "$STAGE/unpack/$PREFIX/LICENSE" "$STAGE/ready/LICENSE"
    chmod 755 "$STAGE/ready/node"
    probe "$STAGE/ready/node" || fail '校验后的运行环境仍无法执行，请检查系统兼容性或设备策略。'
    # Preserve an invalid previous private copy for diagnosis; never replace a system Node.
    if [ -e "$TARGET" ]; then mv "$TARGET" "$TARGET.invalid-$(date +%Y%m%d%H%M%S)-$$"; fi
    mv "$STAGE/ready" "$TARGET"
    NODE="$TARGET/node" SOURCE=downloaded
  fi
  cleanup
  trap - EXIT HUP INT TERM
fi
if [ "$CHECK" -eq 1 ]; then
  exec "$NODE" -p "JSON.stringify({node:process.execPath,version:process.version,source:process.argv[1]})" "$SOURCE"
fi
printf '已就绪：Node.js %s（%s）\n' "$("$NODE" --version)" "$SOURCE"
exec "$NODE" "$SCRIPT_DIR/connector.cjs" serve --root "$EDITOR_DIR" "$@"
