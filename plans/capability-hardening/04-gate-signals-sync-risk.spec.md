# Batch 04 — spec-sync 显式豁免 + is-high-risk 词边界

risk: low
tags: socai,gates

## Spec（行为契约）

### spec-sync

- 输入：子 plan `## Spec 同步` 段。
- 输出：N/A 豁免只认**显式字段**，不靠段落里出现「基础设施」等词。

字段（独占一行，便于 grep）：

```
spec-sync: exempt=<token>
```

`token` 白名单：`infra` | `docs` | `lockfile` | `style` | `tooling` | `ci`

- 有 `spec-sync: exempt=infra` 且无 `specs/` 路径 → 视为合法 N/A（仍跑强豁免/behavior_paths 逻辑，行为与今日「强豁免」一致）。
- **仅**正文写了「N/A——纯依赖卫生 / 基础设施」但无 `spec-sync: exempt=` → **拒**（desktop-slim B01/B02 那种改措辞过关不再成立）。
- 旧关键词表可留作 **warn** 一轮，不得单独让 gate 绿。
- 列了 `specs/` 且在 diff 内 → 仍通过（与现逻辑同）。

### is-high-risk

- 输入：`is-high-risk.sh <base> <head>` + `high-risk-keywords.txt`
- 输出：用词边界匹配，避免子串假阳。

desktop-slim B01：diff 里 `PASSED` 命中关键词 `sse`。

- `PASSED`、`assertPassed`、`passed:` **不得**因 `sse` 命中。
- 真命中：`EventSource`、`text/event-stream`、独立词 `sse`（`\bsse\b` 或等价 ERE）。
- 实现：`grep -iE` 对每个关键词加边界；`sse` / `sql` 等短词必须 `\b`；保留 `tauri::` 这类符号模式。
- 更新 `test-fixtures/is-high-risk.test.mjs`：加 `PASSED` 假阳 fixture（期望 exit 1 = 非高风险）。

## Invariants

- spec-sync：豁免只认 `spec-sync: exempt=<token>`。
- is-high-risk：`PASSED` 不得因子串 `sse` 命中。

## Test（先行）

- 扩展 `test-fixtures/gate-base.test.mjs` 或新建 `test-fixtures/spec-sync-exempt.test.mjs`
  - 段内仅「N/A 基础设施」无字段 → 当前可能绿，改完须红
  - `spec-sync: exempt=infra` → 绿
- `test-fixtures/is-high-risk.test.mjs`
  - 新 fixture：`02-head` 只加 `status=PASSED` → exit 1
  - 旧 stream fixture 仍 exit 0

先行：先加断言（现状：关键词豁免绿、PASSED 假阳 exit 0），再改脚本。

## 验收点

- `node --test test-fixtures/is-high-risk.test.mjs test-fixtures/spec-sync-exempt.test.mjs` 绿
- `test-fixtures/gate-base.test.mjs` 仍绿

## Spec 同步

- 更新：`specs/socai/gates.spec.md`（exempt 字段 + 词边界）
- 更新 `lt-plan` / `lt-execute` SKILL 里「豁免理由关键词」说明，指向新字段（避免规划者继续写「请写基础设施四个字」）

## 涉及文件白名单

- `.claude/skills/lt-execute/references/gates/check-spec-sync.sh`
- `.claude/skills/lt-execute/references/gates/README.md`
- `.claude/skills/lt-plan/SKILL.md`（Spec 同步豁免写法）
- `.claude/skills/lt-execute/SKILL.md`（若提到关键词豁免）
- `.claude/skills/socai/_runtime/is-high-risk.sh`
- `.claude/skills/socai/_runtime/high-risk-keywords.txt`（仅当要标「短词须边界」，或保持文件、逻辑全在 sh）
- `test-fixtures/is-high-risk.test.mjs`
- `test-fixtures/is-high-risk/`（新 fixture 目录，若有）
- `test-fixtures/spec-sync-exempt.test.mjs`
- `specs/socai/gates.spec.md`

## 回滚影响

- 回滚本批：系统仍可运行 ✅

## 不做什么

- 不改 BEHAVIOR_PATHS 默认值
- 不把 is-high-risk 改成 LLM 判断
- **不批量改** desktop-lexi 或其他目标仓已有 `plans/*.spec.md`。本字段落地后，旧 plan 只写「N/A 基础设施」会红——由使用方补 `spec-sync: exempt=`。SoCai 仓内本任务自己的子 plan 可顺手补字段（本批白名单若要动 `plans/capability-hardening/*.spec.md` 须先回 /lt-plan 扩名单；默认不动）。

## 否决方案

- 继续加长关键词同义词表来「覆盖基础设施」：否决，还是文书 gate。
- 去掉 sse 关键词：否决，真 SSE 批还要机械升温。
