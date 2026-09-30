# ADR 0002：v3 subagent 原型验证（exp1 打破复利 + exp2 零渗漏）

- **状态**：ACCEPTED（地基假设已实证）
- **日期**：2026-08-01
- **关联**：`specs/ma-v3-architecture.spec.md`、`docs/decisions/0001`、原始数据 `/tmp/ma-v3-proto/EXPERIMENT.md`

## 背景
ADR 0001 定下 v3 方向（subagent 执行 + spine + 机械 gate）。其「执行层」依赖一条地基假设 **H1**：CC 原生 subagent 隔离 context，打破 v2「一个 session 戴多 hat」的 context 复利。本 ADR 记两次原型实验：验 H1，及其在真实 CC harness 里的落地性 **H2**。

## Experiment 1 — H1：subagent 打破 context 复利 ✓

3 批顺序改造 `calc.js`（add/sub → mul/div → history），每批一个**独立** general-purpose subagent（隔离 context）。subagent 自报 `work_volume`（读+写+命令输出 = v2 inline 模式下会灌进编排者 context 的量）vs 返回 `summary`（v3 实际进编排者的量）。

| Batch | work_volume | summary | leverage | subagent ctx（返回后丢） | tests |
|-------|-------------|---------|----------|--------------------------|-------|
| B1    | 94          | ~12 行  | 7.8×     | 175 行                   | 6/0   |
| B2    | 153         | ~12 行  | 12.8×    | 220 行                   | 13/0  |
| B3    | 331         | ~12 行  | 27.6×    | 360 行                   | 19/0  |
| **累计** | **578**（94→153→331 单调膨胀） | **~36**（恒定） | **~16×** | — | — |

**结论**：`work_volume` 跨批增长（文件越大读越多、改造越重写越多），`summary` 跨批恒定；leverage 随批复杂度上升（7.8×→12.8×→27.6×）。每批 subagent 自身 ctx 有界且**返回即丢**（B1 不进 B2）。**H1 成立——编排者 context 每批只长摘要量级，不随批数膨胀。复利被打破。**

**Caveat（exp1）**：编排者用 Write 创建了 starter 文件 → CC harness 每批把 subagent 改的 file diff **自动注入**编排者 context（~20-42 行）。需 exp2 闭合。

## Experiment 2 — H2：零渗漏隔离 ✓

**假设**：编排者不碰工作文件 → harness 不再 auto-surface diff → 编排者负载 = 纯 summary。
**设置**：`/tmp/ma-v3-proto2`，编排者只 `mkdir + git init`（**不 Write 任何 calc 文件**），subagent 从零起。

| Batch | work_volume | summary | auto-surface 渗漏 | tests |
|-------|-------------|---------|-------------------|-------|
| B1    | 82          | ~10 行  | **0 行** ✓        | 6/0   |
| B2    | 150         | ~11 行  | **0 行** ✓        | 13/0  |

B2 subagent **读+改**了已有 calc 文件也**没漏给编排者**——因为编排者从没碰过它们，harness 没在编排者侧跟踪。**H2 成立。**

## 结论 + 落地铁律

v3 地基两面验通：① subagent 隔离打破复利（exp1，leverage ~16×）② 零渗漏在真实 harness 里成立（exp2）。exp1 的 caveat 已闭合。

> **★ 落地铁律（v3 编排者必须遵守）**：编排者**永不 Read/Edit/Write 源码文件**。源码改造 100% 由 executor subagent 做。编排者只：
> 1. 读/写 `.socai/<slug>/`（自己的脚手架：goal / master / 子 plan / progress；相对 cwd）；
> 2. spawn executor/reviewer subagent（Agent 工具）；
> 3. 跑 gate（**Bash**：`git` / `node --test` / gate 脚本——命令输出是文本，**不触发文件跟踪渗漏**）。

## 措辞修正（spec）
`specs/ma-v3-architecture.spec.md` 原写「总 token 显著下降」偏强。实测：v3 每批 subagent 重载 system prompt（固定开销 × N），**系统总 token 未必降**。真正赢 = **① 编排者 context 恒定（不糊、可跨窗口续）② 每批 fresh 聚焦（不背前批）**。spec 已据此修。

## 未单独验（用户判定不必验）
- **spine 跨窗口续命**（kill + resume）：状态全在 git + `.socai/`，性质上成立，用户判定「肯定有效」，不单独验。
- **机械 gate + auto-fix**：进入 v3 build（ADR 0001 验证计划 step 3）时实测。

## 补充（2026-08）：Cursor 宿主 Task（cursor-host）

`roles.executor.backend=cursor` 在 Cursor IDE 内改为 Task spawn `socai-executor` + 显式 composer model（**cursor-host**），避免 `cursor-agent` CLI 每次 ~20–30s 冷启动；非 Cursor 宿主仍走 CLI（**cursor-cli**）。隔离仍靠 subagent；契约见 `specs/ma-v3-architecture.spec.md` 与 `.claude/skills/socai/SKILL.md`。
