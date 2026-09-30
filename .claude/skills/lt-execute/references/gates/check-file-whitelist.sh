#!/usr/bin/env bash
# Gate: 禁止动子 plan 白名单外的文件（防私自扩范围 / 越狱）
#
# Usage: check-file-whitelist.sh <spec.md>
#
# 从子 plan 的 `## 涉及文件白名单` 段提取白名单（`- path` 列表），
# 与 git 暂存/工作区改动文件比对，任一改动不在白名单内 → 拒。
#
# 白名单条目支持目录前缀（如 `apps/bff/routes/` 匹配其下所有文件）。
set -euo pipefail

verify_lt_diff_base() {
  if [[ -n "${LT_DIFF_BASE:-}" ]]; then
    if ! git rev-parse --verify "${LT_DIFF_BASE}^{commit}" >/dev/null 2>&1; then
      echo "✗ LT_DIFF_BASE 无效: ${LT_DIFF_BASE}" >&2
      exit 1
    fi
  fi
}

verify_lt_diff_base

spec="${1:-}"
if [[ -z "$spec" || ! -f "$spec" ]]; then
  echo "✗ 用法: $0 <spec.md>" >&2
  echo "  spec 不存在: ${spec:-（未提供）}" >&2
  exit 2
fi

# 提取白名单：从 "## 涉及文件白名单" 到下一个 "## " 之间的 `- xxx` 行
# 只取每行首个 path token（路径字符集），丢弃行内 `（新增：说明）` 等注释，
# 兼容干净格式 `- `path`` 与带说明格式 `- `path`（新增：…）`（check-spec-sync 同款提取口径）。
whitelist=$(awk '
  /^## 涉及文件白名单/ { flag=1; next }
  /^## /               { flag=0 }
  flag && /^[[:space:]]*-/ {
    line=$0
    sub(/^[[:space:]]*-[[:space:]]*/,"",line)
    gsub(/`/,"",line)
    # 用字符串 ERE（勿写 /.../）：字符类含 / 时会提前结束正则字面量
    if (match(line, "^[A-Za-z0-9_./@-]+")) print substr(line, RSTART, RLENGTH)
  }
' "$spec")

if [[ -z "$whitelist" ]]; then
  echo "✗ 白名单为空，无法校验。子 plan 必须列「涉及文件白名单」。" >&2
  exit 2
fi

# 暂存优先，否则工作区；LT_DIFF_BASE 设了则用 range diff（socai commit 后跑 gate）
if [[ -n "${LT_DIFF_BASE:-}" ]]; then
  staged=$(git diff "${LT_DIFF_BASE}"..HEAD --name-only)
else
  staged=$(git diff --cached --name-only 2>/dev/null)
  [[ -z "$staged" ]] && staged=$(git diff --name-only 2>/dev/null)
fi
if [[ -z "$staged" ]]; then
  echo "✓ 文件白名单 gate 通过（无改动）"
  exit 0
fi

whitelisted() {
  local f="$1" w
  while IFS= read -r w; do
    [[ -z "$w" ]] && continue
    # 白名单条目作为前缀匹配（目录或文件）
    if [[ "$f" == "$w" || "$f" == "$w"* ]]; then return 0; fi
  done <<< "$whitelist"
  return 1
}

# 自动豁免（capability-hardening B02）：
# 1. 同茎测试：白名单有 path/foo.ts → path/foo.test.* / foo.spec.* 豁免
# 2. lockfile：白名单命中 dir/Cargo.toml → dir/Cargo.lock；
#    dir/package.json → dir/pnpm-lock.yaml / dir/package-lock.json
# 3. 脚手架：plans/**、.socai/** 豁免
# 豁免不得扩成「任意新文件都过」：非同茎测试 / 白名单外业务源码仍拒。
exempted() {
  local f="$1"
  case "$f" in
    plans/*|.socai/*) return 0 ;;
  esac
  # 同茎测试：foo.test.<ext> / foo.spec.<ext>，要求白名单含同茎源文件 foo.<ext>
  if [[ "$f" =~ ^(.+)\.(test|spec)\.[A-Za-z0-9]+$ ]]; then
    local stem="${BASH_REMATCH[1]}" w
    while IFS= read -r w; do
      [[ -z "$w" ]] && continue
      if [[ "$w" == "$stem".* ]]; then return 0; fi
    done <<< "$whitelist"
  fi
  # lockfile：白名单命中同目录 manifest 即豁免
  local dir base
  dir="$(dirname "$f")"
  base="$(basename "$f")"
  case "$base" in
    Cargo.lock)
      whitelisted "$dir/Cargo.toml" && return 0 ;;
    pnpm-lock.yaml|package-lock.json)
      whitelisted "$dir/package.json" && return 0 ;;
  esac
  return 1
}

violations=""
count=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  count=$((count + 1))
  hit=0
  whitelisted "$f" && hit=1
  [[ $hit -eq 0 ]] && exempted "$f" && hit=1
  [[ $hit -eq 0 ]] && violations="${violations}  - ${f}
"
done <<< "$staged"

if [[ -n "$violations" ]]; then
  echo "✗ 文件白名单 gate 失败：以下文件不在子 plan 白名单内："
  printf '%s' "$violations"
  echo ""
  echo "要改范围请回 /lt-plan 修订子 plan 的「涉及文件白名单」，不要私自扩范围。"
  exit 1
fi

echo "✓ 文件白名单 gate 通过（$count 个改动文件均在白名单内）"
