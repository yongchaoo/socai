#!/usr/bin/env bash
# Gate: 改用户可见行为 MUST 同步 specs/ spec（长期治理，防行为契约丢失）
#
# Usage: check-spec-sync.sh <spec.md>
#
# 从子 plan 的 `## Spec 同步` 段读取 spec 同步声明，与 git 改动互验：
# 1. 段缺失 → 拒（子 plan 必须有此字段，即使是 N/A）
# 2. 标 N/A 但无独占行 `spec-sync: exempt=<token>`（token ∈ infra|docs|lockfile|style|tooling|ci）→ 拒；
#    旧「基础设施/运维/docs-only」等散落关键词仅作迁移 warn，不再单独让 gate 绿
# 3. 标 N/A 但 diff 改了行为源码（routes/console/bff-lib/agent/contracts/db-schema）→ 拒（矛盾）
#    例外：强豁免（运维/基础设施/CI/部署/索引治理/内部可靠性/expand-only/迁移账本等）→ 软通过 + warn，
#          由 /lt-review 维度 9 复核 spec 是否真无用户可见行为
# 4. 列了 specs/ 路径但该路径不在 diff 里 → 拒（声明了没真改）
# 5. 列了路径且都在 diff 里 → 通过
#
# 豁免字段：spec-sync: exempt=<token> 独占一行（允许行首空白与 -/* 列表符）；
#          有合法字段且无 specs/ 路径 → 视为合法 N/A（仍跑强豁免/behavior_paths 逻辑）。
#
# 依据：改用户可见行为 MUST 同步 spec；新增路径 MUST 有 spec；改已有逻辑 MUST 更新 spec。
# 边界：本 gate 只验「子 plan 声明 vs diff 一致」；spec 内容质量（GWT 是否写真行为）
#       静态扫不出，靠 /lt-review 维度 9 兜底。
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

# 提取 `## Spec 同步` 段（到下一个 ## 之前）
section=$(awk '
  /^## Spec 同步/ { flag=1; next }
  /^## /          { flag=0 }
  flag            { print }
' "$spec")

if [[ -z "$section" ]]; then
  echo "✗ spec-sync gate 失败：子 plan 缺「## Spec 同步」字段。"
  echo "   即使是 N/A 也 MUST 有此字段 + 独占行豁免字段 spec-sync: exempt=<token>（infra|docs|lockfile|style|tooling|ci）。"
  echo "   回 /lt-plan 补字段。"
  exit 1
fi

# 暂存优先，否则工作区；LT_DIFF_BASE 设了则用 range diff（socai commit 后跑 gate）
if [[ -n "${LT_DIFF_BASE:-}" ]]; then
  changed=$(git diff "${LT_DIFF_BASE}"..HEAD --name-only)
else
  changed=$(git diff --cached --name-only 2>/dev/null)
  [[ -z "$changed" ]] && changed=$(git diff --name-only 2>/dev/null)
fi

# 声明的 specs/ 路径（section 里的反引号路径或裸路径；支持文件或目录前缀）
declared=$(echo "$section" | grep -oE 'specs/[A-Za-z0-9_./-]+' || true)

# 是否标 N/A
is_na=0
echo "$section" | grep -qiE 'N/A|不适用|豁免' && is_na=1

# 显式豁免字段（B04 起 N/A 唯一认可的豁免方式）：独占一行
#   spec-sync: exempt=<token>    token ∈ infra|docs|lockfile|style|tooling|ci
# 允许行首空白与 - / * 列表符；字段混在正文里不算。
exempt_line=$(echo "$section" | grep -iE '^[[:space:]]*([-*][[:space:]]*)?spec-sync:[[:space:]]*exempt=[^[:space:]]+[[:space:]]*$' | head -n1 || true)
exempt_token=""
exempt_valid=0
if [[ -n "$exempt_line" ]]; then
  exempt_token=$(printf '%s' "$exempt_line" | grep -oiE 'exempt=[^[:space:]]+' | head -n1 | cut -d= -f2 | tr '[:upper:]' '[:lower:]')
  case "$exempt_token" in
    infra|docs|lockfile|style|tooling|ci) exempt_valid=1 ;;
  esac
fi

# 旧豁免理由关键词：B04 起仅作迁移 warn，不再单独让 gate 绿
has_legacy_keyword=0
echo "$section" | grep -qiE '纯样式|样式|文案|docs-only|lockfile|常量|css|像素|工具脚本|研发脚本|内部工具|运维|基础设施|CI|部署|索引|可靠性|内部可靠性|扩容|expand-only|迁移|契约 expand|纯索引|DB schema' && has_legacy_keyword=1

# 有合法 exempt 字段 → 视为合法 N/A
(( exempt_valid == 1 )) && is_na=1

# 强豁免（触及 behavior_paths 但非用户可见行为：内部可靠性/基础设施/索引治理等）
# 命中时 behavior_changed 由硬拒降级为软通过 + warn，由 /lt-review 维度 9 兜底
has_strong_exempt=0
echo "$section" | grep -qiE '运维|基础设施|CI 工程配置|CI 配置|部署|索引治理|纯索引|内部可靠性|可靠性|expand-only|契约 expand|DB schema|迁移账本|纯迁移' && has_strong_exempt=1

# diff 里是否改了行为源码（用户可见行为高发区）。
# 项目无关默认空（不臆测哪些目录算"行为源码"）→ 设 BEHAVIOR_PATHS 启用 N/A 与行为改动的矛盾检查。
# 例：BEHAVIOR_PATHS='src/routes|src/api|src/app|packages/shared/contracts'
behavior_paths="${BEHAVIOR_PATHS:-}"
behavior_changed=0
if [[ -n "$changed" && -n "$behavior_paths" ]]; then
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    # 测试文件不构成用户可见行为变更（纯测试改动不应触发 behavior_changed）
    [[ "$f" == *.test.ts || "$f" == *.test.tsx || "$f" == *.test.js ]] && continue
    if echo "$f" | grep -qE "^($behavior_paths)"; then behavior_changed=1; break; fi
  done <<< "$changed"
fi

# 分支判定（顺序：declared 非空优先走路径校验，避免 N/A 字样误判跳过路径检查）
if [[ -n "$declared" ]]; then
  # 列了 specs/ 路径 → 验每个路径都在 diff 里（支持目录前缀，与 check-file-whitelist 一致）
  missing=""
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    hit=0
    if [[ -n "$changed" ]]; then
      while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        if [[ "$f" == "$p" || "$f" == "$p"* ]]; then { hit=1; break; }; fi
      done <<< "$changed"
    fi
    (( hit == 0 )) && missing="${missing}  - ${p}
"
  done <<< "$declared"

  if [[ -n "$missing" ]]; then
    echo "✗ spec-sync gate 失败：子 plan 声明要同步以下 spec 但 diff 里没有："
    printf '%s' "$missing"
    echo "   execute 步骤 4.5 MUST 本 commit 同步 spec，不许 defer。"
    exit 1
  fi
  echo "✓ spec-sync gate 通过（声明 $(echo "$declared" | wc -l | tr -d ' ') 个 spec，均在 diff 内）"
  exit 0
fi

# 没列路径 → 必须是 N/A
if (( is_na == 0 )); then
  echo "✗ spec-sync gate 失败：「## Spec 同步」非 N/A 也未列出 specs/*.spec.md 路径。"
  echo "   列出要新建/更新的 spec 文件，或标 N/A + 独占行豁免字段 spec-sync: exempt=<token>。"
  exit 1
fi

if [[ -n "$exempt_line" && "$exempt_valid" == 0 ]]; then
  echo "✗ spec-sync gate 失败：spec-sync: exempt=${exempt_token} 的 token 不在白名单。"
  echo "   合法 token：infra|docs|lockfile|style|tooling|ci。"
  exit 1
fi

if (( exempt_valid == 0 )); then
  if (( has_legacy_keyword == 1 )); then
    echo "⚠ spec-sync: 段内旧豁免关键词（基础设施/运维/docs-only/...）自 B04 起仅作迁移 warn，不再让 gate 变绿。"
  fi
  echo "✗ spec-sync gate 失败：标 N/A 但缺显式豁免字段。"
  echo "   在「## Spec 同步」段独占一行写：spec-sync: exempt=<token>（token ∈ infra|docs|lockfile|style|tooling|ci）。"
  exit 1
fi

if (( behavior_changed == 1 )); then
  if (( has_strong_exempt == 1 )); then
    echo "⚠ spec-sync gate 软通过（N/A + 强豁免理由 + 触及 behavior_paths 但属内部可靠性/基础设施/索引治理/迁移账本类）："
    echo "   请 /lt-review 维度 9 复核 spec 是否真无用户可见行为；若 review 判定有用户可见行为，回 /lt-plan 补 spec。"
  else
    echo "✗ spec-sync gate 失败：标 N/A 但 diff 改了行为源码（BEHAVIOR_PATHS 匹配的路径）。"
    echo "   改用户可见行为 MUST 同步 specs/ spec，N/A 与行为改动矛盾。"
    echo "   要么补 spec，要么回 /lt-plan 补 spec-sync: exempt=<token> 并写明强豁免理由（运维/基础设施/索引治理/迁移账本等）。"
    exit 1
  fi
fi

echo "✓ spec-sync gate 通过（N/A + spec-sync: exempt=${exempt_token} + 无行为源码改动）"
