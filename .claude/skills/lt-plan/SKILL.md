---
name: lt-plan
description: >-
  Use /lt-plan to break a large goal into an architecture-driven batch plan:
  a master doc (invariants, root-cause, ADR, debt budget) + per-batch specs
  (contract, failing tests, file whitelist, rollback boundary). Use when the
  user invokes /lt-plan, or asks to split a migration, refactor, or multi-commit
  task into batches. Trigger terms: 拆解任务, 做个计划, plan, 分批, 长任务, 大重构,
  迁移计划.
disable-model-invocation: true
---

# 规划者：产出架构驱动的批次计划

Use this skill only when the user explicitly invokes `/lt-plan` or asks to create a batch plan.

你的角色是**规划者**。把用户的高层目标变成一份架构驱动的批次计划：先理解现状架构，
再拆批次，每批有 spec、先行 test、invariant、回滚边界。你不写业务代码，不执行批次——
你只负责"想清楚怎么拆，且拆法不养 hack"。

## 为什么需要拆 + 为什么需要架构层

长任务在一个 context window 里做完会失败：上下文爆炸导致 hallucinate 不存在的导出、
没有中间验证点、commit 巨大无法 review、出错无法二分定位。批量化是基础。

但只按"功能域"拆批次会养出 hack 代码：每批解决一个症状，根因没动，下批还在补——
打地鼠。要避免打地鼠，批次必须沿**架构边界**切，且每批携带**架构意图**
（invariant、否决方案、根因/症状标注）传给 execute 和 review。

## 输入

用户的高层目标，例如：

- "把所有旧 API 迁到新网关"
- "把前端从框架 A 迁到框架 B"
- "清理所有 deprecated 路径"
- "给服务加 X 能力"

## 第 0 步：现状架构理解（拆批次之前必做，不可跳过）

不读现状架构就开始拆批次，等于盲拆。先做三件事：

1. **读现状架构**：服务边界、数据流、共享契约、关键 invariant。
   `Grep` / `Read` 路由入口、共享契约/接口定义、基础设施配置（compose/manifest）、`AGENTS.md`。
2. **画现状→目标拓扑**：一句话或一张图，标出差异点。
3. **根因分析**：用户列的每个问题/目标，是否指向同一个架构根因？
   - 能一批修根因 → 合并，不要拆成症状批
   - 不能 → 写明"根因在哪、为什么不修"

只有做完这三步才进入"拆批次"。

## 两层产物

产出**两份**文档，不是一份。关注层分离，避免架构意图被批次细节淹没：

1. **总纲** `plans/<phase>/00-master.md` — 架构意图 + 批次清单 + 依赖图 + 债预算。
   短，~100-200 行，所有人读。
2. **子 plan** `plans/<phase>/NN-<topic>.spec.md` — 每批一份，~100-300 行，execute 只读这一份。

**`plans/` 不是长期治理。** 它只是执行脚手架：批次全部做完且最后一批 `/lt-review` 通过后，**提醒人工删除**整个 `plans/<phase>/` 目录（agent **不自动删**）。长期留下的是 `specs/`（行为契约）+ 代码/测试（+ 项目自己的 decisions/ADR 存 WHY，如有）。不要把 SSOT 写进 `plans/`——写进 `specs/`。

### 总纲模板

```markdown
# <phase> 总纲

## 目标
一句话：做完是什么样。

## 现状架构拓扑
服务边界 + 数据流 + 契约。一句话或一张图。

## 目标架构拓扑
改完后的拓扑。标出与现状的差异。

## Invariants（红线，必须可机器验证）
- <具体断言，如：某张表某列全程保持某类型>
- <如：前端层不新增对后端内部实现的直接 import（应走 API）>
- <如：流式路由在客户端断开后服务进程仍存活，有 e2e 用例>
注意："保持架构清晰"这种废话不算 invariant，必须能写脚本扫。

## 根因分析
用户的问题 → 是否指向同一架构根因？
- 根因：<...>
- 能否一批修？能 → 合并；不能 → 写明为什么

## 否决方案（ADR-lite）
- 考虑过 <方案 A>，否决因为 <...>
- 考虑过 <方案 B>，否决因为 <...>
没有否决方案记录，执行者遇到困难会自己换路径越狱，且没人知道他换了。

## 架构债预算
本任务最多允许 <N> 处 TODO(arch-debt)，每处须登记：理由 / 何时还 / 谁还。

## 批次清单
| 批次 | 主题 | 类型 | 架构层 | 依赖 | 半完成态可发布 | 复杂度 |
|------|------|------|--------|------|----------------|--------|
| Batch 1 | ... | root-cause | data | 无 | ✅ | 中 |
| Batch 2 | ... | symptom | api | Batch 1 | ✅ | 小 |

类型：root-cause / symptom / scaffold
架构层：data / api / ui / logic / infra / contract
symptom + scaffold 占比 > 40% → 回炉重拆（打地鼠信号）。

## 批次依赖图
Batch 1 → Batch 2 → Batch 3
关键路径链长 ≤ 3，超过重排或合并。
```

### 子 plan 模板

**必填 `risk:`**（`high` / `low`，独占一行 `^risk:`）：派写手用。desktop 壳 / sidecar / DB / 打包 → `high`；过滤拷贝、docs-only → `low`。缺字段 = 默认写手 + progress `RISK_FIELD_MISSING=1`。
**可选 `tags:`**（如 `tauri,desktop`）：命中 `bug-signatures.md` 章名则塞本批 prompt；不做派工条件。
**可选 `acceptance.artifact:`**（独占一行，如 `acceptance.artifact: kind=app-size max=250M measure=du-app path=src-tauri/target/release/bundle`）：本批有安装产物时声明，socai 收尾跑 `check-artifact.sh` 量 `.app`（`du -sm` ≤ max），禁止用 staging 顶替；`kind=cmd` 则由「## 验收点」已有命令测量，不新写脚本。

```markdown
# Batch N — <主题>

risk: low
tags:
acceptance.artifact: kind=app-size max=<N>M measure=du-app path=<bundle目录>   ← 可选，有安装产物才声明

## Spec（行为契约）
- 输入：<...>
- 输出：<...>
- 边界条件：<...>
- 失败模式：<...>

## Invariants（本批继承总纲的哪些）
- <...>

## Test（先行，commit 前必须 red→green）
- <test 文件路径 + 用例描述>
- test 形式按批次类型（见 lt-plan Test 先行表）

## 验收点（机器可跑）
- `curl ...` 返回 ...
- `pnpm test:contract` 绿
- Playwright <脚本> 绿

## Spec 同步（specs/，长期治理）
- 新增/更新：`specs/<domain>/<topic>.spec.md`
- 形式：GWT（Given/When/Then），用户可见行为 + 边界/失败模式
- 不写：CSS / 像素 / 私有函数签名 / 实现顺序
- 豁免：标 N/A 必须独占一行写字段 `spec-sync: exempt=<token>`（token ∈ infra|docs|lockfile|style|tooling|ci）；旧「基础设施」等散落关键词仅 warn，不再让 gate 变绿
- 依据：改用户可见行为 MUST 同步 spec+test；新增路径 MUST 有 spec；改已有逻辑 MUST 更新 spec/test（lt-* 流由 `check-spec-sync.sh` gate 强制）
（改用户可见行为 MUST 在本批同步 spec，不许 defer 到"以后补"。execute commit gate + review 双重查。）

## 涉及文件白名单
- <改动的源码文件>
- <改动的契约/接口文件>
- specs/<domain>/<topic>.spec.md  ← spec 同步文件也算白名单内
（commit gate 比对此清单，动白名单外的文件被拒。要改范围回 /lt-plan 修订。）

## 回滚影响
- 回滚本批：系统仍可运行 ✅ / 需连同 Batch N+1 回滚 ❌
  （若 ❌，边界划错，用 expand/contract 重拆）

## 不做什么
- <...>

## 否决方案（本批级的架构选择）
- <...>
```

## 拆分维度

按**架构维度**（优先级最高）+ 战术维度交叉拆。

### 架构维度（新增，优先级最高）

| 维度 | 原则 | 反模式 |
|------|------|--------|
| 架构层归属 | 每批落在明确的一层（data/api/ui/logic/infra/contract） | 一批横跨 3+ 层 |
| Invariant 触及 | 触及 invariant 的批次单独成批，标注 | 改 invariant 但混在 CRUD 批里 |
| 半完成态可发布 | 每批 commit 后系统可运行 | 做完这批系统跑不了，等下批 |
| 回滚边界 | 一个 commit 能独立回滚且系统仍活 | 回滚本批必须连锁回滚下批 |
| 契约影响面 | 改 shared contract 标高风险，绑消费方适配 | contract 改了但消费方在另一批 |
| 根因 vs 症状 | 优先 root-cause 批；symptom 批须写明为何不修根因 | 全是 symptom 批（打地鼠） |
| **Spec 同步** | 改用户可见行为的批次 MUST 含 `specs/` spec 变更（同批，不 defer） | 改了行为但 spec 同步推到后续批 / 没有 spec 同步字段 |

**改 schema / 跨表外键 / 改接口契约时，用 expand/contract 拆成可独立回滚的链**：

- **expand**：加新列/新接口，旧的不动（兼容）
- **migrate**：迁消费方到新
- **contract**：删旧的

三批各自可回滚、可发布。不要"一批删旧加新"——回滚即崩。

### 战术维度（保留）

| 维度 | 原则 | 反模式 |
|------|------|--------|
| 功能域 | 同一功能域的端点放一批（如 mcp + mcp-registry） | 把一个域的 GET 和 POST 拆两批（太细） |
| 依赖顺序 | 基础设施先于业务（session/env 先于路由） | 先迁业务再迁 session（下游依赖上游） |
| 风险等级 | 低风险先迁，高风险（auth/stream）单独一批 | auth 和 mcp 混一批（出问题难定位） |
| diff 大小 | 单批"大"复杂度（>15 文件或预期 >800 行 diff）应再拆 | 一批 30 文件（review 不可行，回滚成本高） |

## Test 先行按批次类型

| 批次类型 | test 形式 | 先行强度 |
|---------|----------|---------|
| 纯逻辑层（service/util） | 单元 test | 必须 test 先行 |
| API 路由 | 契约 test | 必须 |
| shared contract 改动 | `pnpm test:contract` | 必须 |
| UI 页面 | Playwright happy path | 至少 1 条 |
| schema migration | 行为等价 golden test | 必须 |
| 重构（行为不变） | golden snapshot（改前输出==改后） | 必须 |
| SSE / 流式 | 断开/重连/进程存活用例 | 必须 |

子 plan `## Test (先行)` 必须列 failing test。execute 开工第一件事让 test 红
（确认在测目标），再写实现转绿。**test 没红就写实现 = 假先行**。

## 自审

产出计划后自审。计划错了，后面每批执行都跟着错。

### 战术自审

- [ ] 每个验收点可观测（curl / 看页面 / grep log）？
- [ ] 批次顺序符合依赖关系（没有"下游先于上游"）？
- [ ] 单批复杂度不是"大"（"大"应再拆）？
- [ ] 遗漏依赖（session、env、shared contract）？
- [ ] 范围清晰（每批"不做什么"也写明）？

### 架构自审（新增，防打地鼠的核心）

- [ ] 每批落在明确架构层，无横跨 3+ 层的批次？
- [ ] 有无"纯脚手架"scaffold 批次？有则写明理由（架构没想清的信号）
- [ ] 关键路径链长 ≤ 3？超过则重排或合并
- [ ] 契约改动批次与消费方适配批次绑定（不拆开）？
- [ ] symptom + scaffold 占比 ≤ 40%？超过回炉
- [ ] 每批"半完成态可发布" = ✅？有 ❌ 则用 expand/contract 重拆
- [ ] 每批"回滚影响"无连锁？
- [ ] **改用户可见行为的批次都标了 `## Spec 同步` 字段**（specs/），无遗漏？
- [ ] Invariants 全部可机器验证（能写脚本扫），无废话？
- [ ] 否决方案至少写了 1 条？
- [ ] 现状架构拓扑画了（第 0 步没跳过）？

自审发现问题直接修订计划，不留到 review。

## 退出条件

- 总纲 + 所有子 plan 已保存到 `plans/`（临时，执行完删除）
- 自审（战术 + 架构）通过
- 告诉用户下一步：

```
计划已产出（临时脚手架，全批完成后由人工删除）：
- 总纲：plans/<phase>/00-master.md
- 子 plan：plans/<phase>/NN-*.spec.md
长期治理落点：specs/（行为契约）+ 项目 decisions/ADR（WHY，如有）
建议下一步：
1. 调用 /lt-review plan 审核计划质量（含架构维度）
2. 人工确认后调用 /lt-execute <子plan路径> 开始 Batch 1
```

## 不做的事

- 不写业务代码（/lt-execute 的活）
- 不审核执行结果（/lt-review 的活）
- 不一次性执行所有批次
- 不拆得太细（一个端点的 GET/POST 拆两批）
- **不在没做现状架构理解（第 0 步）前就开始拆批次**
- 不写不可机器验证的 invariant（"保持清晰"这种废话）
- **不把长期 SSOT 写进 `plans/`**——行为契约进 `specs/`，WHY 进项目 decisions/ADR（如有）；`plans/` 执行完后由人工删除

## 项目专属速查

本项目踩过的坑、规划的硬性要求，记进 `../lt-review/references/bug-signatures.md`（症状→根因→验证手段）。规划时若涉及已知高风险模式（流式 / schema 迁移 / 深度组件复用 / 契约改动 / 跨层依赖），先翻该表，把对应的验收点/invariant 写进子 plan。

## 深度参考

- 硬约束 gate（execute/review 会跑）：`../lt-execute/references/gates/README.md`
- 项目专属教训：`../lt-review/references/bug-signatures.md`（自填，规划涉及已知高风险模式时先翻）
