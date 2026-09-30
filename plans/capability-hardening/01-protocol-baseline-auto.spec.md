# Batch 01 — 开工协议：baseline / merge target / auto / batch_base

risk: low
tags: socai,orchestration

## Spec（行为契约）

- 输入：用户 `/socai` 时工作区可能脏；main 可能只是 init 锚点；闸门 `attended` 或 `auto`。
- 输出：SKILL 强制编排者在 spawn 第一批写手前问清（或从 progress 读到）两项，并按 auto 新语义跑。
- 边界：用户已在对话里选定的，写入 `.socai/<slug>/progress.md`，不再重问。
- 失败模式：未问就切支 / 未问就 squash main → 视为协议违反（review 用 grep SKILL + 场景 GWT）。

### 开工 baseline（三选一，必须写入 progress）

`baseline=clean-cut` | `wip-anchor-then-branch` | `reuse-head`

脏工作区（`git status --porcelain` 非空）且用户没指定 → **不进 executor，先问**。禁止默默 `git add -A`。

### merge target（三选一，必须写入 progress）

`merge=main` | `merge=integration:<branch>` | `merge=keep-branch`

`git merge-base --is-ancestor main HEAD` 为假，或 `main..HEAD` 含明显非本目标历史（progress 里有 WIP 锚点 / 用户已声明 main 不是集成支）→ **禁止默认 squash**。收尾只提示用户已选的 target。

### auto 语义（改条文，对齐 desktop-slim 实际跑法）

- auto：**跳过每批 y/n**；gate+fixer 自跑；review CONCERNS 自动修一轮再审。
- 停：review **BLOCKER**，或本批 / 收尾 **产物验收失败**，或 fixer 满 3，或 infra_fails≥2。
- 不停：仅因 `is-high-risk` 命中或 `risk: high`。

attended 仍每批问 y/n。

### 治理 commit 与 batch_base

本批功能 commit 已落、标题不是 `wip(batch):` 之后，编排者自己改 `plans/` / `.socai/` 的治理提交：

- 不得继续用旧 `batch_base` 跑 whitelist（会把 plan 文档算进本批 diff）；或
- whitelist / spec-sync 对 `plans/` `.socai/` 豁免（B02 落地后走豁免）。

本批至少把 SKILL 写成：「功能收口后清 `batch_base=`；其后治理 commit 用新 base 或依赖豁免」。

### 高风险写手

`HIGH_RISK_WEAK_EXECUTOR=1` 仍允许默认写手，但 **打包 / SEA / 权限 / sidecar** 类 `risk: high` 必须满足其一：配了 `roles.executor_high_risk`，或子 plan 声明了产物验收字段（完整语义 **B05** 落地 `acceptance.artifact` + `check-artifact.sh`）。本批 SKILL **只许出现指针**：「打包类 high 须有产物验收字段，见 B05」，不得在本批写完整测量协议。只记账不算完成。

## Invariants（本批继承）

- SKILL 不得再写「auto = 高风险默认 pause」且同时「默认 squash 回 main」而不提 merge target。
- 编排者仍不碰目标仓业务源码；本批只改 SoCai 的 SKILL / specs / 测试。

## Test（先行，commit 前必须 red→green）

- `test-fixtures/protocol-baseline.test.mjs`（新建）
  - 从 SKILL.md 抽出「脏树必须问 baseline」「禁止未指定时默认 squash main」「auto 停点含 BLOCKER/产物验收、不含仅 high-risk pause」三条，断言原文存在、旧句「高风险才 pause 等人」不存在（或仅出现在「已废止」注释且测试不认）。
  - 可用对 SKILL 的字符串/小节锚点测试——这是协议批，机械验条文，不验模型是否遵守。
- 更新 `specs/ma-v3-architecture.spec.md` 或新增 `specs/socai/orchestration.spec.md` 的 GWT，与上同义。

先行：先加测试（对当前 SKILL 应红），再改 SKILL 转绿。

## 验收点（机器可跑）

- `node --test test-fixtures/protocol-baseline.test.mjs` 绿
- `rg -n "高风险才 pause" .claude/skills/socai/SKILL.md` 无有效条文命中
- `rg -n "baseline=|merge=keep-branch" .claude/skills/socai/SKILL.md` 均有
- SKILL 可含「产物验收字段 / B05」指针；**不得**在本批定义 `acceptance.artifact` 的完整测量协议

## Spec 同步（specs/，长期治理）

- 新增/更新：`specs/socai/orchestration.spec.md`
- 形式：GWT（baseline / merge target / auto 停点 / batch_base 收口）
- 同步更新 `specs/ma-v3-architecture.spec.md` 里与 auto/squash 冲突的旧句（若有）

## 涉及文件白名单

- `.claude/skills/socai/SKILL.md`
- `specs/socai/orchestration.spec.md`
- `specs/ma-v3-architecture.spec.md`
- `test-fixtures/protocol-baseline.test.mjs`
- `.claude/skills/lt-review/references/bug-signatures.md`（追加 `## socai / protocol` 一行表）

## 回滚影响

- 回滚本批：系统仍可运行 ✅（只是编排者回到旧默认 squash/auto pause）

## 不做什么

- 不写编排者「探测脏树」的独立 CLI（skill 条文 + 测试锚点即可）
- 不改 gate 脚本（B02–B04）
- 不改 bug-memory.sh（B06）

## 否决方案（本批级）

- 用「编排者自己判断 main 能不能 squash」替代强制三选一：否决，desktop-slim 证明会拖到收尾才发现。
