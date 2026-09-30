#!/usr/bin/env bash
# Gate: 架构 invariant 守卫（防架构静默烂）
#
# Usage: check-invariant.sh [master.md]
#
# master 参数可选：
# - 有 master：跑内置静态检查（master 可作为未来 invariant 来源的引用，目前内置检查不依赖 master 内容）
# - 无 master：只跑内置静态检查
#
# 内置 invariant：默认无（项目无关，不臆测层级规则）。
# 在下方「项目专属静态 invariant」区追加你项目的检查（用 check_no_import helper 或自定义命令）。
#
# 运行时 invariant（流式客户端断开后进程存活等）无法静态扫，
# 由 /lt-review 维度 6/7 + e2e 用例覆盖，不在此 gate。
#
# NOTE（bash 3.2 可移植性）：echo 里 $var 一律用 ${var} 大括号——macOS bash 3.2
# + `set -u` 会把紧跟多字节字符（全角（）／，等）的裸 $var 误当未定义变量而崩溃。
# 详见 check-hack-count.sh 头注释；勿"简化"回裸 $var。
set -euo pipefail

master="${1:-}"
if [[ -n "$master" && ! -f "$master" ]]; then
  echo "⚠ master 文件不存在: ${master}，跳过 master 引用，只跑内置检查" >&2
  master=""
fi

failed=0
checks_run=0

# --- helper：扫某目录是否 import 了禁止的路径 ---
check_no_import() {
  local src_dir="$1" forbidden="$2" label="$3"
  [[ -d "$src_dir" ]] || return 0
  checks_run=$((checks_run + 1))
  local v
  v=$(rg -n "from ['\"][^'\"]*${forbidden}" "$src_dir" 2>/dev/null || true)
  if [[ -n "$v" ]]; then
    echo "✗ invariant 违反：${label}"
    echo "$v"
    failed=1
  fi
}

# --- 项目专属静态 invariant（默认无；取消注释改成你项目的层级规则）---
# check_no_import "<前端层目录>" "<后端内部目录>" "前端直接 import 后端内部实现（应走 API）"
# check_no_import "<被调用方目录>" "<调用方目录>" "反向依赖"
# 也可追加自定义检查（schema 列类型、禁止某 API 等）：
# if command -v psql >/dev/null 2>&1; then ...; fi

if (( failed == 1 )); then
  echo ""
  echo "invariant 守卫失败。回 /lt-plan 确认该 invariant 是否应被本批触及；"
  echo "若应触及，需在子 plan Invariants 子集里显式声明并更新总纲。"
  exit 1
fi

echo "✓ invariant gate 通过（$checks_run 条内置检查全绿）"
echo "提示：运行时 invariant（SSE 进程存活等）由 /lt-review 维度 6/7 覆盖，不在此静态 gate。"
