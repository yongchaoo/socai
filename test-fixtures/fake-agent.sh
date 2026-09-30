#!/bin/sh
# fake-agent.sh — ma e2e 测试用的多 backend CLI 替身（Batch 6）。
#
# 通过 MA_AGENT_BIN_<ID> 注入；按 argv 约定推断 backend（MA_FAKE_AGENT 可覆盖）：
#   claude  → claude -p <prompt> [--model] --output-format json ...
#   kimi    → kimi -p <prompt> -m <model> --output-format stream-json
#   codex   → codex exec <prompt> ...
#   cursor  → cursor-agent -p <prompt> -f --trust --output-format json
#
# MA_FAKE_EXIT=1 → 指定 agent infra fail（MA_FAKE_FAIL_AGENT=claude|kimi|...，默认 claude）。

if [ "${MA_FAKE_EXIT:-}" = "1" ]; then
  fail_agent="${MA_FAKE_FAIL_AGENT:-claude}"
else
  fail_agent=""
fi

# 解析 prompt 与 backend
prompt=""
agent="${MA_FAKE_AGENT:-}"

# shellcheck disable=SC2034
args="$*"
case "$1" in
  exec)
    agent="${agent:-codex}"
    prompt="$2"
    shift 2
    ;;
  --profile)
    # dsh --profile headless [--patch <yml>] <prompt>
    agent="${agent:-dsh}"
    shift
    [ -n "$1" ] && [ "$1" != "--patch" ] && shift
    while [ "$1" = "--patch" ]; do
      shift
      [ -n "$1" ] && shift
    done
    [ "$1" = "--" ] && shift
    prompt="${1:-}"
    ;;
  -p)
    shift
    prompt="$1"
    shift
    if [ -z "$agent" ]; then
      case " $* " in
        *" --trust "*) agent="cursor" ;;
        *" stream-json "*) agent="kimi" ;;
        *" --dangerously-skip-permissions "*) agent="claude" ;;
        *" --output-format json "*) agent="claude" ;;
        *) agent="claude" ;;
      esac
    fi
    ;;
  *)
    prompt="${1:-}"
    agent="${agent:-claude}"
    ;;
esac

if [ -n "$fail_agent" ]; then
  if [ "$fail_agent" = "all" ] || [ "$agent" = "$fail_agent" ]; then
    echo "fake-agent: forced infra fail ($agent)" >&2
    exit 1
  fi
fi

# 角色判定（与 fake-claude.sh 相同）
role="unknown"
case "$prompt" in
  *"你是 Triage"*) role="Triage" ;;
  *"你是 Executor"*) role="Executor" ;;
  *"你是 Reviewer"*) role="Reviewer" ;;
  *"你是计划审核者"*) role="PlanReviewer" ;;
  *"你是 diff 审核者"*) role="DiffReviewer" ;;
  *"你是 socai-executor"*) role="MaExec" ;;
  *"你是 Planner"*)
    case "$prompt" in
      *"greenfield"*) role="PlannerGreenfield" ;;
      *"DAG 模式"*) role="PlannerDag" ;;
      *) role="Planner" ;;
    esac
    ;;
esac

if [ -n "${MA_FAKE_CALL_LOG:-}" ]; then
  {
    printf '=== CALL role=%s agent=%s ===\n' "$role" "$agent"
    printf '%s\n' "$prompt"
  } >> "$MA_FAKE_CALL_LOG"
fi

emit_block() {
  printf '%s\n' '```socai-result'
  printf '%s\n' "$1"
  printf '%s\n' '```'
}

usage_tokens="${MA_FAKE_USAGE:-100}"

emit_usage_claude() {
  printf '%s\n' "{\"type\":\"result\",\"result\":\"ok\",\"usage\":{\"input_tokens\":${usage_tokens},\"output_tokens\":0}}"
}

emit_usage_kimi() {
  # 实证（fix Bug1）：kimi -p --output-format stream-json 不暴露 usage——真实输出格式为
  # {"role":"assistant",...} 后跟 {"role":"meta","type":"session.resume_hint",...}，无任何 token 字段。
  # 故 fake 也不发 usage：parseBackendUsage('kimi') 恒 null，spent 0 + usageMissing。
  printf '%s\n' '{"role":"meta","type":"session.resume_hint","session_id":"fake"}'
}

emit_usage_codex() {
  printf '%s\n' 'codex'
  printf '%s\n' 'ok'
  # 真实 codex exec：tokens used 统计走 stderr（Batch 6 review 实证）
  printf '%s\n' 'tokens used' >&2
  printf '%s\n' "$usage_tokens" >&2
}

emit_usage_cursor() {
  printf '%s\n' '{"type":"result","subtype":"success","result":"ok","usage":{"inputTokens":'"${usage_tokens}"',"outputTokens":0}}'
}

emit_usage() {
  case "$agent" in
    kimi) emit_usage_kimi ;;
    codex) emit_usage_codex ;;
    cursor) emit_usage_cursor ;;
    *) emit_usage_claude ;;
  esac
}

# step 2 文件链：executor prompt 不再 inline 带 accept/plan，marker 在 plan.md 文件里。
# 从 prompt 抠 plan.md 路径 + taskId → 读文件 → 抠 accept 的 test -f marker
# （DAG：按 taskId 查任务表行 `| <tid> | ... | `test -f <X>` |`；single：查 `Accept:` 行）。
# 模拟真实 agent「读 plan.md 照着做」。字符类排除反引号，避免吃掉表行 accept 的闭合反引号。
marker_from_plan() {
  planmd=$(printf '%s\n' "$prompt" | sed -n 's/.*读 `\([^`]*\)`.*/\1/p' | head -1)
  [ -z "$planmd" ] && return 0
  tid=$(printf '%s\n' "$prompt" | sed -n 's/.*id=`\([^`]*\)`.*/\1/p' | head -1)
  if grep -q '```socai-dag' "$planmd" 2>/dev/null; then
    grep "^| ${tid} |" "$planmd" 2>/dev/null | sed -n 's/.*test -f \([^ `]*\).*/\1/p' | head -1
  else
    grep '^Accept:' "$planmd" 2>/dev/null | sed -n 's/.*test -f \([^ `]*\).*/\1/p' | head -1
  fi
}

case "$role" in
  Triage)
    if [ "${MA_FAKE_MODE:-}" = "dag" ]; then
      printf '%s\n' '```socai-triage'
      printf '%s\n' '{"mode":"dag","reason":"fake：多任务可独立验收"}'
      printf '%s\n' '```'
    else
      printf '%s\n' '```socai-triage'
      printf '%s\n' '{"mode":"single","reason":"fake：单任务"}'
      printf '%s\n' '```'
    fi
    emit_usage
    ;;
  PlannerDag)
    case "${MA_FAKE_DAG:-}" in
      cycle)
        cat <<'DAG'
```socai-dag
{"reason":"fake cycle","tasks":[{"id":"t1","title":"a","deps":["t2"],"scope":["**"],"accept":"test -f t1.marker","prompt":"a"},{"id":"t2","title":"b","deps":["t1"],"scope":["**"],"accept":"test -f t2.marker","prompt":"b"}]}
```
DAG
        ;;
      diamond)
        cat <<'DAG'
```socai-dag
{"reason":"fake 4-task diamond：t1→t2,t3→t4","tasks":[{"id":"t1","title":"base","deps":[],"scope":["**"],"accept":"test -f t1.marker","prompt":"create t1"},{"id":"t2","title":"left","deps":["t1"],"scope":["**"],"accept":"test -f t2.marker","prompt":"create t2"},{"id":"t3","title":"right","deps":["t1"],"scope":["**"],"accept":"test -f t3.marker","prompt":"create t3"},{"id":"t4","title":"top","deps":["t2","t3"],"scope":["**"],"accept":"test -f t4.marker","prompt":"create t4"}]}
```
DAG
        ;;
      scope)
        cat <<'DAG'
```socai-dag
{"reason":"fake scope-gate","tasks":[{"id":"t1","title":"a","deps":[],"scope":["t1.marker"],"accept":"test -f t1.marker","prompt":"a"},{"id":"t2","title":"b","deps":["t1"],"scope":["t2.marker"],"accept":"test -f t2.marker","prompt":"b"}]}
```
DAG
        ;;
      *)
        cat <<'DAG'
```socai-dag
{"reason":"fake 3-task：t1→t2,t3","tasks":[{"id":"t1","title":"base","deps":[],"scope":["**"],"accept":"test -f t1.marker","prompt":"create t1"},{"id":"t2","title":"left","deps":["t1"],"scope":["**"],"accept":"test -f t2.marker","prompt":"create t2"},{"id":"t3","title":"right","deps":["t1"],"scope":["**"],"accept":"test -f t3.marker","prompt":"create t3"}]}
```
DAG
        ;;
    esac
    emit_usage
    ;;
  PlannerGreenfield)
    cat <<'DAG'
```socai-dag
{"reason":"fake greenfield scaffold","tasks":[{"id":"t1","title":"脚手架+冒烟","deps":[],"scope":["."],"accept":"bash smoke.sh","prompt":"create README.md and smoke.sh"}]}
```
DAG
    emit_usage
    ;;
  Planner)
    # Batch 2.4 证伪：Repro 默认 test -f FIXED.marker（marker 不存在→红=bug 真实）；钩子覆盖测不可复现/白名单拒
    if [ -n "${MA_FAKE_REPRO_GREEN:-}" ]; then repro="true"
    elif [ -n "${MA_FAKE_REPRO_BAD:-}" ]; then repro="bash t.sh && x"
    else repro="test -f FIXED.marker"; fi
    cat <<PLN
## 根因假设
fake-root-cause：检测依赖的 FIXED.marker 缺失，导致判断恒为否。

## 影响面
仅 worktree 根目录的文件存在性检测，无下游模块波及。

## 修复方案
创建 FIXED.marker 占位文件，恢复检测目标。

## 回归测试
test -f FIXED.marker 应退出 0。

Accept: test -f FIXED.marker
Repro: ${repro}
PLN
    emit_usage
    ;;
  Executor)
    case "$prompt" in
      *"只读调研模式"*)
        mdfile=$(echo "$prompt" | sed -n 's/.*`\([A-Za-z0-9._-]*\.md\)`.*/\1/p' | head -1)
        [ -z "$mdfile" ] && mdfile="research.md"
        printf '# 调研结论\n\nfake research doc\n' > "$mdfile" 2>/dev/null || true
        emit_block "{\"summary\":\"research doc ${mdfile}\",\"files\":[\"${mdfile}\"],\"verify\":\"wrote ${mdfile}\"}"
        emit_usage
        ;;
      *"greenfield 绿地模式"*)
        printf '# App\n\n启动：bash smoke.sh\n' > README.md 2>/dev/null || true
        printf '#!/bin/sh\necho ok\nexit 0\n' > smoke.sh 2>/dev/null || true
        chmod +x smoke.sh 2>/dev/null || true
        emit_block '{"summary":"scaffold + smoke","files":["README.md","smoke.sh"],"verify":"bash smoke.sh"}'
        emit_usage
        ;;
      *)
        # P0-2 测试钩子：DRIFT → executor 违反隔离动 git（建临时分支致 HEAD 漂移）；NOOP → 不产出任何改动。
        if [ -n "${MA_FAKE_EXEC_DRIFT:-}" ]; then
          # 模拟 executor 违反隔离：commit 致 worktree HEAD 前进（callExecutor 前后 rev-parse 比对会抓到）
          git commit --allow-empty -m "injected drift" 2>/dev/null || true
        fi
        m=$(marker_from_plan)
        if [ -n "${MA_FAKE_HANG_MARKER:-}" ] && [ "$m" = "$MA_FAKE_HANG_MARKER" ]; then
          sleep "${MA_FAKE_HANG_SECS:-30}"
        fi
        if [ -z "${MA_FAKE_EXEC_NOOP:-}" ]; then
          if [ -n "$m" ]; then
            printf 'fixed\n' > "$m" 2>/dev/null || true
          else
            m="FIXED.marker"
            printf 'fixed\n' > "$m" 2>/dev/null || true
          fi
        fi
        if [ -n "${MA_FAKE_SCOPE_VIOL:-}" ]; then
          printf 'leak\n' > "EXTRA.txt" 2>/dev/null || true
        fi
        emit_block "{\"summary\":\"create ${m:-noop}\",\"files\":[\"${m:-}\"],\"verify\":\"test -f ${m:-FIXED.marker}\"}"
        emit_usage
        ;;
    esac
    ;;
  Reviewer)
    if [ -n "${MA_FAKE_REVIEW_FAIL:-}" ]; then
      emit_block '{"pass":false,"rootCauseValid":false,"feedback":"fake：diff 非最小，存在无关改动"}'
    else
      emit_block '{"pass":true,"rootCauseValid":true,"feedback":""}'
    fi
    emit_usage
    ;;
  PlanReviewer)
    # socai-call plan-review 替身：吐 lt-review plan 的 15 维 markdown 报告（纯文本，extractAgentContent
    # 对 kimi/claude 都能去尾 usage 行取 body）。MA_FAKE_PLAN_REVIEW_PARTIAL=1 → 只吐 5 维（测 coverageWarn）。
    # MA_FAKE_PLAN_REVIEW_CONCERNS=1 → verdict CONCERNS（测 THEATER_RISK=1 报告头）。
    if [ -n "${MA_FAKE_PLAN_REVIEW_PARTIAL:-}" ]; then
      cat <<'PR'
计划审核：fake-master + fake-spec
- 依赖顺序：✅
- 验收点可观测性：✅
- 批次大小：✅
- 范围清晰度：✅
- 遗漏依赖：✅
- 结论：通过
PR
    elif [ -n "${MA_FAKE_PLAN_REVIEW_CONCERNS:-}" ]; then
      cat <<'PR'
计划审核：fake-master + fake-spec
- 依赖顺序：✅
- 验收点可观测性：❌（Batch 2 模糊）
- 批次大小：✅
- 范围清晰度：✅
- 遗漏依赖：✅
- 架构层归属：✅
- Invariant 可验证：✅
- 半完成态可发布：✅
- 回滚边界：✅
- 根因/症状比例：✅（20%，未超 40%）
- 契约绑定：✅
- Spec 同步：✅
- 否决方案(ADR)：✅
- 现状拓扑：✅
- 对抗式退出条件：✅
- 结论：需修订
- verdict：CONCERNS（blocker：验收点不可观测）
PR
    else
      cat <<'PR'
计划审核：fake-master + fake-spec
- 依赖顺序：✅
- 验收点可观测性：✅
- 批次大小：✅
- 范围清晰度：✅
- 遗漏依赖：✅
- 架构层归属：✅
- Invariant 可验证：✅
- 半完成态可发布：✅
- 回滚边界：✅
- 根因/症状比例：✅（20%，未超 40%）
- 契约绑定：✅
- Spec 同步：✅
- 否决方案(ADR)：✅
- 现状拓扑：✅
- 对抗式退出条件：✅
- 结论：通过
- 下一步：通过 → /lt-execute
PR
    fi
    emit_usage
    ;;
  DiffReviewer)
    # socai-call diff-review 替身：吐 diff 审核 markdown 报告。MA_FAKE_DIFF_REVIEW_PARTIAL=1 → 只吐 3 项（测 coverageWarn）。
    if [ -n "${MA_FAKE_DIFF_REVIEW_PARTIAL:-}" ]; then
      cat <<'DR'
diff 审核：fake-base..fake-head
- 严重 bug：✅
- 边界：✅
- verdict：APPROVE
DR
    else
      cat <<'DR'
diff 审核：fake-base..fake-head
- 严重 bug：✅
- 边界 / 异常路径：✅
- 安全：✅
- 测试覆盖：✅（新增 test 覆盖新分支）
- 半完成 / 遗漏：✅
- verdict：APPROVE
DR
    fi
    emit_usage
    ;;
  MaExec)
    # socai-call exec 替身：吐执行摘要 markdown（编排者读 stdout）。仅测 plumbing（真 executor 行为由 runAgent+真 CLI 验）。
    cat <<'EX'
## 执行摘要
fake：test-first 实现了 batch，跑过测试，已 commit 到分支。
- 实现：fake 模块 + fake 测试
- 测试：N pass / 0 fail
- commit：fake-hash
EX
    emit_usage
    ;;
  *)
    case "$prompt" in
      "reply exactly: ok")
        case "$agent" in
          kimi) emit_usage_kimi ;;
          codex) emit_usage_codex ;;
          cursor) emit_usage_cursor ;;
          *) emit_usage_claude ;;
        esac
        exit 0
        ;;
    esac
    echo "fake-agent: unknown role prompt" >&2
    exit 1
    ;;
esac
