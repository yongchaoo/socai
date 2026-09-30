#!/bin/sh
# SoCai 默认 dsh 入口：PATH 上的 dsh 优先，否则用同级 deepseek-harness 已构建 CLI。
set -e
if command -v dsh >/dev/null 2>&1; then
  exec dsh "$@"
fi
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# _runtime → socai → skills → .claude → SoCai → www
WWW="$(CDPATH= cd -- "$HERE/../../../../.." && pwd)"
BIN="$WWW/deepseek-harness/apps/cli/lib/bin.js"
if [ ! -f "$BIN" ]; then
  echo "dsh 不在 PATH，且未找到 $BIN（装 dsh 或设 SOCAI_AGENT_BIN_DSH）" >&2
  exit 127
fi
exec node "$BIN" "$@"
