#!/usr/bin/env bash
# Gate: 先行 test 必须 red→green，且无新增 skip（防假先行）
#
# Usage: check-test-gate.sh "<test command>"
#
# 三步检查：
# (a) 暂存 diff 中无新增 .skip / .todo / it.skip / test.skip / describe.skip
# (b) 跑给定的 test 命令，必须全绿
# (c) FAIL_TO_PASS：暂存 diff 中的实现文件 revert 到 HEAD 后 test 须 fail（防 expect(true).toBe(true) 假先行）
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

cmd="${1:-}"
if [[ -z "$cmd" ]]; then
  echo "✗ 用法: $0 \"<test command>\"" >&2
  echo "  例: $0 \"pnpm exec vitest run <test 文件>\"  或  \"npm test\"" >&2
  exit 2
fi

# 禁止 cd 进 crate：revert 用仓库根相对路径，cd 会污染 cwd、使 FAIL_TO_PASS 测量点错乱
cd_cargo_re='cd[[:space:]]+[^[:space:]]+[[:space:]]*&&[[:space:]]*cargo[[:space:]]+test'
if [[ "$cmd" =~ $cd_cargo_re ]]; then
  echo "✗ test gate 失败：禁止 cd 进 crate 跑 cargo test" >&2
  echo "  改用: cargo test --manifest-path <crate>/Cargo.toml（在仓库根跑）" >&2
  exit 1
fi

is_test_file() {
  local f="$1"
  [[ "$f" =~ \.(test|spec)\.(mjs|js|ts|tsx|cjs|jsx)$ ]] && return 0
  [[ "$f" =~ (^|/)(test|tests|__tests__)(/|$) ]] && return 0
  return 1
}

# Rust 方案 A：revert 后原 cmd exit 0 时，仅 HEAD 有的新测必须被观察到没过。
# 不得报假先行/WEAK_VERIFY，也不得 orphan-skip（检出 orphan 后 exit 0）当通过。
# 依赖全局：cargo_args head_tests deleted_files reverted_files f2p_tmp cmd
rust_fail_to_pass_observed() {
  local reverted_tests disappeared t rc out observed=0 df rf stem restored
  local unobserved=()
  reverted_tests=$(cargo test $cargo_args -- --list 2>/dev/null | sed -n 's/: test$//p' | sort -u || true)
  disappeared=$(comm -23 <(printf '%s\n' "$head_tests") <(printf '%s\n' "$reverted_tests") || true)

  if [[ -z "$disappeared" ]]; then
    echo "✗ test gate 失败：FAIL_TO_PASS / WEAK_VERIFY — 实现前 test 已绿（假先行）"
    echo "  本批 test 须在实现前至少 fail 一次。写真实断言，勿 expect(true).toBe(true) 蒙混。"
    exit 1
  fi

  while IFS= read -r t; do
    [[ -z "$t" ]] && continue
    out=$(cargo test $cargo_args "$t" -- --exact 2>&1) && rc=0 || rc=$?
    if ((rc != 0)); then
      echo "  ✓ $t — 实现前非 0（观察到没过）"
      observed=$((observed + 1))
    else
      unobserved+=("$t")
    fi
  done <<< "$disappeared"

  if ((${#unobserved[@]} > 0)); then
    # orphan：新测随新 .rs 被删未编译（0 matched 且 exit 0）。
    # 改策略：恢复 mod 接线文件（新 .rs 仍删），要求 compile-fail。
    restored=0
    for df in "${deleted_files[@]}"; do
      [[ "$df" == *.rs ]] || continue
      stem=$(basename "$df" .rs)
      for rf in "${reverted_files[@]}"; do
        [[ "$rf" == *.rs ]] || continue
        if grep -qE "(^|[[:space:]])mod[[:space:]]+${stem}[[:space:]]*;" "$f2p_tmp/$rf" 2>/dev/null; then
          cp "$f2p_tmp/$rf" "$rf"
          restored=1
        fi
      done
    done
    if ((restored == 1)); then
      echo "→ FAIL_TO_PASS(Rust)：新测 orphan，恢复 mod 接线（新 .rs 仍删）要求 compile-fail..."
      if eval "$cmd"; then
        echo "✗ test gate 失败：FAIL_TO_PASS — Rust 新测未被观察到没过（mod 接线已恢复、新 .rs 仍删，却 exit 0）"
        exit 1
      fi
      echo "  ✓ compile-fail：${#unobserved[@]} 条 orphan 新测被观察到没过"
      observed=$((observed + ${#unobserved[@]}))
      unobserved=()
    fi
  fi

  if ((${#unobserved[@]} > 0)); then
    echo "✗ test gate 失败：FAIL_TO_PASS — Rust 新测未被观察到没过："
    printf '  - %s\n' "${unobserved[@]}"
    echo "  把新测拆进新模块（mod 接线 + 新 .rs）或 tests/ 独立文件，使 revert 后可观察到失败。"
    exit 1
  fi

  echo "✓ FAIL_TO_PASS(Rust)：${observed} 条仅 HEAD 有的新测被观察到没过（orphan 未 skip）"
}

# (a) 检查 diff 无新增 skip
if [[ -n "${LT_DIFF_BASE:-}" ]]; then
  diff_u0=$(git diff "${LT_DIFF_BASE}"..HEAD -U0)
else
  diff_u0=$(git diff --cached -U0 2>/dev/null || true)
fi
new_skips=$(echo "$diff_u0" \
  | grep -E '^\+' \
  | grep -E '\.(skip|todo)\(|it\.skip|test\.skip|describe\.skip|\.skip\(' \
  || true)

if [[ -n "$new_skips" ]]; then
  echo "✗ test gate 失败：检测到新增 skip/todo："
  echo "$new_skips"
  echo ""
  echo "先行 test 不能 skip。如确实无法跑，回 /lt-plan 在 Test (先行) 标 N/A 并写理由。"
  exit 1
fi

# (b) 跑 test 命令
echo "→ 跑先行 test：${cmd}"
if ! eval "$cmd"; then
  echo "✗ test gate 失败：先行 test 未全绿"
  echo "修到绿再 commit，或在子 plan 标 N/A 写理由（需 /lt-plan 修订）。"
  exit 1
fi

# (c) FAIL_TO_PASS：实现文件 revert 到 base 后 test 须 fail
if [[ -n "${LT_DIFF_BASE:-}" ]]; then
  changed_files=$(git diff "${LT_DIFF_BASE}"..HEAD --name-only --diff-filter=ACMR)
else
  changed_files=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
fi
impl_files=()
if [[ -n "$changed_files" ]]; then
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if ! is_test_file "$f"; then
      impl_files+=("$f")
    fi
  done <<< "$changed_files"
fi

f2p_status=""
if ((${#impl_files[@]} > 0)); then
  echo "→ FAIL_TO_PASS 校验（${#impl_files[@]} 个实现文件）..."

  # Rust：cmd 含 cargo test 且 diff 含 *.rs → revert 前记测试名集合，orphan 新测须被观察到没过
  rust_mode=0
  cargo_args=""
  head_tests=""
  if [[ "$cmd" == *"cargo test"* ]]; then
    for f in "${impl_files[@]}"; do
      [[ "$f" == *.rs ]] && rust_mode=1 && break
    done
    if ((rust_mode == 1)); then
      if [[ "$cmd" =~ cargo[[:space:]]+test([^|>&;]*) ]]; then
        cargo_args="${BASH_REMATCH[1]}"
      fi
      head_tests=$(cargo test $cargo_args -- --list 2>/dev/null | sed -n 's/: test$//p' | sort -u || true)
      if [[ -z "$head_tests" ]]; then
        echo "⚠ cargo test -- --list 为空，Rust FAIL_TO_PASS 回退为通用校验" >&2
        rust_mode=0
      fi
    fi
  fi

  f2p_tmp=$(mktemp -d)
  f2p_restore() {
    [[ -d "$f2p_tmp" ]] || return 0
    for f in "${impl_files[@]}"; do
      if [[ -f "$f2p_tmp/$f" ]]; then
        cp "$f2p_tmp/$f" "$f"
      fi
    done
  }
  f2p_cleanup() { rm -rf "$f2p_tmp"; }
  trap 'f2p_restore; f2p_cleanup' EXIT

  deleted_files=()
  reverted_files=()
  for f in "${impl_files[@]}"; do
    mkdir -p "$f2p_tmp/$(dirname "$f")"
    if [[ -n "${LT_DIFF_BASE:-}" ]]; then
      cp "$f" "$f2p_tmp/$f" 2>/dev/null || git show "HEAD:$f" > "$f2p_tmp/$f"
      if git cat-file -e "${LT_DIFF_BASE}:$f" 2>/dev/null; then
        git show "${LT_DIFF_BASE}:$f" > "$f"
        reverted_files+=("$f")
      else
        rm -f "$f"
        deleted_files+=("$f")
      fi
    else
      git show ":$f" > "$f2p_tmp/$f"
      if git cat-file -e "HEAD:$f" 2>/dev/null; then
        git show "HEAD:$f" > "$f"
        reverted_files+=("$f")
      else
        rm -f "$f"
        deleted_files+=("$f")
      fi
    fi
  done

  echo "→ FAIL_TO_PASS：无实现版本跑 test（须 fail）..."
  if eval "$cmd"; then
    if ((rust_mode == 1)); then
      rust_fail_to_pass_observed
    else
      echo "✗ test gate 失败：FAIL_TO_PASS / WEAK_VERIFY — 实现前 test 已绿（假先行）"
      echo "  本批 test 须在实现前至少 fail 一次。写真实断言，勿 expect(true).toBe(true) 蒙混。"
      exit 1
    fi
  fi

  f2p_restore
  f2p_cleanup
  trap - EXIT
  echo "✓ FAIL_TO_PASS：实现前 fail、实现后 pass"
  f2p_status="FAIL_TO_PASS 已验"
elif [[ -n "$changed_files" ]]; then
  echo "✗ test gate 失败：无可 revert 实现文件，无法验证 FAIL_TO_PASS" >&2
  echo "  实现若在 *.test.mjs 内联或本批仅改测试，须拆出独立 impl 文件。" >&2
  exit 1
else
  f2p_status="FAIL_TO_PASS 跳过：无改动"
fi

echo "✓ test gate 通过：先行 test 全绿，无新增 skip，${f2p_status}"
