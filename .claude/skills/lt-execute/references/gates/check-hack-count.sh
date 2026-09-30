#!/usr/bin/env bash
# Gate: hack 标记计数不升，除非登记债清单（防偷偷欠债）
#
# Usage: check-hack-count.sh <spec.md>
#
# 对比 HEAD（commit 前）与工作区（commit 时）的 hack 标记计数。
# 计数上升 → 必须在子 plan 里有 TODO(arch-debt) 登记，否则拒。
#
# NOTE（bash 3.2 可移植性）：所有 $var 插值必须用 ${var} 大括号。macOS 自带
# bash 3.2 在 `set -u` 下，会把紧跟多字节字符（全角（）／，等，UTF-8 多字节）
# 的裸 $var 连同其后字节误解析为更长的变量名 → "unbound variable" 崩溃。
# 大括号在 `}` 处显式终结变量名，是唯一可移植写法；勿"简化"回裸 $var。
set -euo pipefail

spec="${1:-}"
if [[ -z "$spec" || ! -f "$spec" ]]; then
  echo "✗ 用法: $0 <spec.md>" >&2
  exit 2
fi

pattern='TODO|FIXME|@ts-ignore|@ts-expect-error|hack|XXX'

# before: HEAD 里的计数（匹配行数）。{ ... || true; } 兜住 grep/rg 无匹配时的退出 1，
# 否则 set -e + pipefail 会在赋值行直接杀掉脚本（无匹配的干净仓库会踩这个）。
before=$( { git grep -hE "$pattern" HEAD -- apps/ packages/ 2>/dev/null || true; } | wc -l | tr -d ' ')
before=${before:-0}

# after: 工作区里的计数。注意 rg 的 -h 是 help（不是 grep 的 no-filename），用 --no-filename。
after=$( { rg --no-filename "$pattern" apps/ packages/ 2>/dev/null || true; } | wc -l | tr -d ' ')
after=${after:-0}

diff=$(( after - before ))

if (( diff > 0 )); then
  # 检查子 plan 是否登记了 arch-debt（grep -c 无匹配时输出 0 且退出 1，用 || true 兜住退出码）
  debt_logged=$(grep -c 'TODO(arch-debt)' "$spec" 2>/dev/null || true)
  debt_logged=${debt_logged:-0}
  echo "⚠ hack 标记新增 ${diff} 处（before=${before} after=${after}）"
  if (( debt_logged == 0 )); then
    echo "✗ 未在子 plan 登记架构债。"
    echo "   请在代码里标 \`// TODO(arch-debt): <理由>\` 并在子 plan / 总纲债清单登记，或消除该 hack。"
    exit 1
  fi
  echo "  已登记 $debt_logged 处 arch-debt，放行（请记得还债）"
  exit 0
fi

echo "✓ hack 计数 gate 通过（before=${before} after=${after}，无新增）"
