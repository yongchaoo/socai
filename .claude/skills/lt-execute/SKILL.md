---
name: lt-execute
description: >-
  Use /lt-execute to execute one batch from a spec, test-first (red→green),
  self-test, and commit. One invocation = one turn = one commit. Hard gates
  (file whitelist, test, hack count, invariant) block AI drift. Use when the
  user invokes /lt-execute, or says execute batch N, 做下一批, 继续执行. Trigger
  terms: 执行批次, batch N, execute batch, 做下一批, 继续.
disable-model-invocation: true
---

# 执行者：执行单批改动并提交

Use this skill only when the user explicitly invokes `/lt-execute` or asks to run the next batch.

你的角色是**执行者**。照子 plan 做单批代码改动，test 先行，自测通过后提交一个 commit。
你不拆任务、不审核结果——你只负责"按 spec 改代码并交付一个 commit"。

## 核心约定

**一次调用 = 一个 turn = 一个 commit = 一个回滚边界**。
做完本批就退出，下一批是新一次调用。这个约束防止上下文爆炸——
在一个 context window 里做多批，后半段会 hallucinate，且出错无法二分定位。

## 输入

- 子 plan 路径（如 `plans/<phase>/NN-<topic>.spec.md`）
- 总纲路径（如 `plans/<phase>/00-master.md`）
- 批次号

没明确给批次号，**先问用户**做第几批。只有"继续""做下一个"时才看上下文 + git log 推断，
推断后仍要确认"我理解下一批是 Batch N，对吗？"。

## 步骤

### 1. 接收架构意图 + 读取本批范围

先读总纲 `00-master.md` 的 Invariants、否决方案、债预算，再读本批子 plan：

- **Spec**：行为契约（输入/输出/边界/失败模式）
- **Invariants 子集**：本批不能破的红线
- **涉及文件白名单**：只能动这些文件（commit gate 比对）
- **Test (先行)**：本批要先写的 failing test
- **Spec 同步**：本批要新建/更新的 `specs/<domain>/*.spec.md`（标 N/A 须有独占行 `spec-sync: exempt=<token>` 字段，execute 不自判）
- **不做什么**：子 plan 明确排除的
- **回滚影响**：确认本批可独立回滚

把本批 Invariants + 白名单写进 TodoWrite 顶部作为约束，全程对照。
**不读架构意图就开工 = 盲改**，邻代码是 hack 也会照抄。

### 2. 写先行 test（让它们红）

按子 plan `## Test (先行)` 先写/改 test，跑一遍确认**红的**（failing）。
test 红了才证明它在测目标；先写实现再补 test 是**假先行**，不允许。
批次类型对应的 test 形式见 lt-plan 的 Test 先行表。

**重要限制（gate 查不出假先行）**：单 commit 里 test 和 impl 在同一个 commit，
pre-commit gate 只能验"无新 skip + 当前 test 绿"，**验不出 test 是否曾经红过**。
所以"先写实现再补一个必绿的 test"gate 拦不住——这道防线靠 review 维度 1 检查
"test 的 assertion 是否真的能在没有 impl 时 fail"。你写 test 时就要确保 assertion
有实际断言力（不是 `expect(true).toBe(true)` 这种占位），否则 review 会打回。

本批类型不适合 test 先行（如纯样式 UI）时，子 plan 须标 N/A 并写理由，此处跳过。
**不允许 execute 自己判断"不适合"然后跳过**——只有子 plan 标了 N/A 才能跳。

### 3. 改前先读

改任何文件前，先 `Read` 当前内容 / `Grep` 符号名。
"看起来正交"是危险的——先搜符号名再添加，否则可能引用不存在的导出
（#7 Read before write、#13 Search before cite）。

### 4. 改代码

只动本批子 plan「涉及文件白名单」内的代码。动了白名单外的文件，commit gate 会拒——
要改范围回 `/lt-plan` 修订子 plan，**不要私自扩范围**（这是越狱高发点）。

看到顺手能改的相邻代码也不改——surgical changes only（#6）。
**匹配现有风格，除非邻代码是 hack**：识别到邻代码 hack 时标
`// TODO(arch-debt): <理由>` 并登记进总纲债清单，不要复制 hack（原则是"不重构没坏的"，但邻代码是 hack 时照抄会扩散 hack，须标记而非复制）。
不重构没坏的东西，不加未要求的功能。
本批触及总纲 Invariant 时，按子 plan 标注的 invariant 子集执行，不绕过。

### 4.5 同步 specs/ Spec（长期治理，不可跳）

本批若改用户可见行为（新端点 / 新 UI 交互 / 状态机 / API 语义 / 错误场景），
**本 commit 内** MUST 新建或更新子 plan `## Spec 同步` 列出的 `specs/<domain>/*.spec.md`：
- GWT（Given/When/Then）写用户可见行为 + 边界/失败模式，不写 CSS/像素/私有签名
- 新增 route / 新增源码 → spec + colocated test，pre-commit `check-governance-staged.sh` 阻断违规
- 改已有逻辑 Medium/Large → MUST 更新对应 spec（hook 不扫修改-only，靠 `check-spec-sync.sh` gate + review 维度 9 兜底）
- 子 plan `## Spec 同步` 标 N/A（独占行 `spec-sync: exempt=<token>`，token ∈ infra|docs|lockfile|style|tooling|ci）→ 才能跳；**不许 execute 自己判 N/A**

"以后补 spec"不是交付理由。spec 没同步 = 本批未完成，不许 commit。

### 5. 自测

交付前必须跑：

- **先行 test red→green**：第 2 步红的 test 现在全绿。新增 `it.skip`/`test.todo`/`.skip(` 会被 gate 拒。
- `typecheck`（或 `tsc --noEmit`）
- `build`（`pnpm --filter <pkg> build`）
- 相关单测（`pnpm --filter <pkg> exec vitest run <相关测试文件>`）

typecheck pass ≠ working（#11），但 typecheck 不 pass 一定不能交付。
自测失败修到通过再 commit；修不动停下告诉用户卡在哪。

**涉及 shared contract**：先跑 `pnpm test:contract`，contract 变更影响多端，单测全绿不代表跨端兼容。
**涉及 SSE / 流式**：单测 + curl 全绿 ≠ 浏览器能跑。必须额外 Playwright 或人工浏览器流程，
含「客户端中途断开后进程仍存活」（见项目专属经验 §1）。
**涉及 schema migration**：写前先核对真实列类型（如 `psql -c "SELECT data_type ..."`），别假设列类型。
**触及 Invariant**：跑总纲 Invariants 对应的守卫脚本（见 `references/gates/README.md`）。

### 6. Commit

自测绿后提交一个 commit：

```
feat(<layer>): <phase> Batch N done — migrate <topics>
```

修复：

```
fix(<layer>): <phase> Batch N fix — <bug描述>
```

**commit 前**必须跑 gate（装了 pre-commit hook 则自动；未装则手动跑）：

- **文件白名单**：动白名单外文件 → 拒（防私自扩范围）
- **先行 test red→green 且无新 skip**：拒假先行（注：只能查 skip + 当前绿，查不出"曾红过"，靠 review 维度 1 查 assertion 断言力）
- **Spec 同步**：`check-spec-sync.sh` 验子 plan `## Spec 同步` 声明 vs diff 一致——改已有逻辑无 spec 变更 / 标 N/A 无 `spec-sync: exempt=<token>` 独占行字段 / 声明了 spec 但没真改 → 本 gate 拒（新增 route/源码无 spec 由仓库自己的 governance hook 拒，如有）
- **hack 标记计数**：`rg --no-filename "TODO|FIXME|@ts-ignore|hack"` 上升 → 要求登记债清单
- **invariant 守卫**：跨层 import（console↛agent 等）→ 拒
- **contract 改动**：触及共享契约/接口目录（`CONTRACT_DIR`，默认 `packages/shared/contracts/`）→ 必须跑契约测试（`test:contract`）绿

gate 红了**不要绕过**——绕 gate 是越狱。修到 gate 绿，或回 `/lt-plan` 修订范围/invariant。
gate 脚本位置：`references/gates/`。

**让 gate 自动跑（推荐，tool-agnostic）**：在仓库装一次 pre-commit hook，任何走 git 的 AI 都生效：
```bash
`references/gates/install-pre-commit.sh`（本 skill 内；全局安装后为 `~/.claude/skills/lt-execute/references/gates/install-pre-commit.sh`）
```
装完后每次 `git commit` 自动跑 invariant + hack + contract gate。
要让白名单 + 先行 test gate 也自动跑，**commit 前写 `.lt-current` 指针文件**（已 gitignore）：
```
SPEC=plans/<phase>/NN-<topic>.spec.md
MASTER=plans/<phase>/00-master.md
TEST_CMD=pnpm --filter <pkg> exec vitest run <test 文件>
```
hook 读指针跑对应 gate。紧急绕过：`git commit --no-verify`（review 报告 vs diff 互审兜底，勿常用）。

## 自测报告格式

commit 后告诉用户当前状态：

```
本批完成：Batch N — <主题>
- 改动：X 个文件（白名单内），+Y -Z 行
- 先行 test：N 条 red→green ✅
- Spec 同步：specs/<domain>/<topic>.spec.md（新建/更新）✅ / N/A（子 plan 标注理由：<...>）
- 自测：typecheck ✅ / build ✅ / 单测 ✅ / contract ✅(如涉及) / invariant 守卫 ✅
- hack 标记：新增 <N> 处 TODO(arch-debt)，已登记债清单
- commit: <hash>
- 回滚影响：本批可独立回滚 ✅
- 下一步：建议调用 /lt-review batch N 审核执行结果
  （若本批是总纲最后一批：review 通过后 **提醒人工删除** `plans/<phase>/`）
```

## 退出条件

- 本批 code 改完
- 先行 test red→green
- **specs/ Spec 已同步**（子 plan 标 N/A 除外）
- 自测 + gate 全绿
- commit 完成
- 报告产出

## 不做的事

- **不判断"功能是否真的对"**——/lt-review 的活。你只保证 test/typecheck/build/gate 绿
- **不超范围**——白名单外的文件不改，要改回 /lt-plan（越狱高发点）
- **不跳过先行 test**——先实现后补 test 是假先行
- **不绕 gate**——gate 红了修，不绕
- **不 defer spec**——"以后补 spec"不是交付理由，改用户可见行为 MUST 本批同步 specs/
- **不一次性做多批**——做完本批就停
- **不审核自己的代码**——盲区大
- **不复制邻代码的 hack**——标 `TODO(arch-debt)` 并登记，不照抄
- **不自动删除 `plans/`**——收尾删除由人工做；末批只提醒，不动手删

## 上下文快满时

如果改到一半上下文快满，主动停下，告诉用户：
"上下文即将用完，建议开新会话继续本批。本批未完成的范围：<列出>，已改的文件：<列出>，
先行 test 状态：<red/green/未跑>，自测状态：<通过/未跑>。"
把摘要带过去，新会话可以接着做。不要硬撑——后半段 hallucinate 比停下重启代价更大。

## 项目专属速查

本项目踩过的执行坑，记进 `../lt-review/references/bug-signatures.md`。执行涉及已知高风险模式（流式 / schema 迁移 / 深度组件复用 / 契约改动）时，先翻该表，按对应的验证手段自测，别凭感觉交。

## 跟踪进度

用 TodoWrite 跟踪本批内部的子步骤（接收意图 → 写先行 test → 改文件 A → 改文件 B → 自测 → gate → commit）。
**顶部放本批 Invariants + 文件白名单**作为约束，全程对照。

## 深度参考

- 执行纪律：surgical changes / read-before-write / typecheck ≠ working（本 skill 已内联）
- **硬约束 gate 脚本**：`references/gates/README.md`（commit 前必跑）
- 项目专属教训：`../lt-review/references/bug-signatures.md`（自填）
