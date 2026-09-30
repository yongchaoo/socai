---
name: lt-review
description: >-
  Use /lt-review to review batch plans or batch execution results for long tasks.
  Two modes: plan (dependency, acceptance, architecture dimensions) and batch
  (tests, logs, UI traversal, network, connectivity, process survival, e2e,
  architecture properties, anti-whack-a-mole, report-vs-diff cross-audit,
  adversarial closure). Assume the fix/report is wrong; separate currently-green,
  batch-closed, phase-root-cause, and SSOT-reproducible.
  Use when the user invokes /lt-review, or asks to review a plan or batch N.
  Not the built-in /review (Bugbot/Security). Trigger terms: review计划,
  审核批次, 检查执行结果, 看看log, 遍历页面, 对抗式review, 真的修好了吗.
disable-model-invocation: true
---

# 审核者：多维度验证（含架构属性）

Use this skill only when the user explicitly invokes `/lt-review` or asks to review a long-task plan or batch.

你的角色是**审核者**。验证规划者的计划或执行者的交付物是否真的对。
你不写代码（除非 bug 少且明确时兼修，见末尾），你只负责"从多个维度验证并产出报告"。

## 默认立场：对抗式收口

**假设 execute 的修复/结论有问题**，再找证据推翻或坐实。  
禁止把「当前绿」写成「本批通过」或「阶段全修好」。分层定义与适用/N/A 见 [references/adversarial-review.md](./references/adversarial-review.md)。

| 层 | 含义 | 未满足时最多能写 |
|----|------|------------------|
| 当前绿 | 此刻与本批相关的探测通过 | 「当前绿」 |
| 本批契约闭合 | 子 plan **本批** Spec/验收/Inv 子集满足 | 「本批未闭合」 |
| 阶段根因闭合 | 总纲根因表点名项已消掉（常非每批要求） | 「阶段仍开放→Batch X」 |
| 可重复交付 | 该变更**所属 SSOT 域**可重建（代码→git；集群→git 声明式；节点→装机…） | 「活状态手修，未进 SSOT」 |

**适用**：有修故障/宣称验收 PASS/行为闭环时必做。纯 docs/文案等 → 整节 `N/A（理由）`。  
**禁止**：无运维变更却逼答「装机/CNI」；有故障宣称却整节省略。

## 为什么不能只看单测

单测 pass 只说明"代码跑了"，不说明"功能对了"，更不说明"架构没烂"。长任务中多次出现：

- 子路由不渲染（框架语义差异，typecheck 看不出）
- API 404（路由未挂载，单测没覆盖该路径）
- log 刷 error 但单测看不见（静默失败）
- SDK 字段名不匹配导致功能静默失效（deny 了但错误信息丢失）
- **每批都过 review 但架构静默烂掉**（hack 堆积、跨层耦合新增、invariant 被悄悄破）
- **止血当根因、活状态手修当交付**（探测绿一次就报闭环，SSOT 未更新，换环境复发）

所以审核必须多维度。架构维度防"打地鼠"；对抗式收口防"绿了就宣称本批/阶段修好"。

## 两种模式

根据上下文判断：

- **有最近 commit + 批次号** → review batch N（审核执行结果）
- **有总纲 + 子 plan 但无相关 commit** → review plan（审核计划）
- **两种上下文都有** → 问用户"审计划还是审执行结果？"
- **都没有** → 问用户要审什么

### 模式 1：review plan（审核计划）

**触发**：用户说"review 计划""审核 plan""看看这个拆分对不对"

**输入**：总纲 `00-master.md` + 子 plan `*.spec.md`

**审核维度**：

| 维度 | 检查什么 | 反模式信号 |
|------|----------|------------|
| 依赖顺序 | 基础设施先于业务 | 下游批次排在上游前面 |
| 验收点可观测性 | 每个 acceptance point 能 curl/看页面/grep log | "功能正常"这种模糊话 |
| 批次大小 | 单批 diff < 800 行 | 一批 3000 行 |
| 范围清晰度 | 每批"不做什么"也写明 | 只写做什么，边界模糊 |
| 遗漏依赖 | session/env/shared contract 有没有漏 | 迁路由但忘迁 session |
| **架构层归属** | 每批落在明确一层 | 横跨 3+ 层 |
| **Invariant 可验证** | 全部能机器扫，无废话 | "保持架构清晰" |
| **半完成态可发布** | 每批 commit 后系统可跑 | 做完这批跑不了等下批 |
| **回滚边界** | 每批可独立回滚 | 连锁回滚 |
| **根因/症状比例** | symptom+scaffold ≤ 40% | 全 symptom（打地鼠） |
| **契约绑定** | contract 改动批与消费方适配绑定 | 拆开了 |
| **Spec 同步** | 改用户可见行为的批次有 `## Spec 同步` 字段且指向 `specs/` | 缺字段 / 改行为但 spec 推到后续批 |
| **否决方案(ADR)** | 总纲写了 ≥1 条 | 无 ADR，执行者会自己换路径 |
| **现状拓扑** | 第 0 步没跳过 | 直接拆批次 |
| **对抗式退出条件** | 区分「当前绿 / 本批闭合 / 阶段根因」；运维手改批有对应 SSOT 或显式标一次性；半完成态写明根因留给哪批 | 每批都要求阶段根因归零；白名单无 SSOT 却写阶段闭环 |

**输出**：

```
计划审核：<总纲路径> + <子plan>
- 依赖顺序：✅ / ❌（哪批有问题）
- 验收点可观测性：✅ / ❌（哪些批次模糊）
- 批次大小：✅ / ❌（哪批太大）
- 范围清晰度：✅ / ❌
- 遗漏依赖：✅ / ❌（漏了什么）
- 架构层归属：✅ / ❌（哪批横跨多层）
- Invariant 可验证：✅ / ❌（哪些是废话）
- 半完成态可发布：✅ / ❌（哪批不可发布，建议 expand/contract 重拆）
- 回滚边界：✅ / ❌（哪批连锁）
- 根因/症状比例：✅ / ❌（占比 X%，超 40% 回炉）
- 契约绑定：✅ / ❌
- Spec 同步：✅ / ❌（哪批改行为但缺 spec 同步字段 / 推到后续批）
- 否决方案(ADR)：✅ / ❌
- 现状拓扑：✅ / ❌
- 对抗式退出条件：✅ / ❌（哪批混淆本批闭合与阶段闭环 / 手改无 SSOT）
- 结论：通过 / 需修订（具体建议）
- 下一步：通过 → /lt-execute <子plan> 1；需修订 → 回 /lt-plan 修订
```

### 模式 2：review batch N（审核执行结果）

**触发**：用户说"审核批次 N""检查执行结果""看看 log 有没有报错""遍历页面"

**输入**：子 plan 路径 + 总纲路径 + 批次号 + 最近 commit hash

**前置条件**：相关服务必须已启动。没启动先启动并用 `lsof -i :<port>` 确认监听。
服务没起来就审核 = 纸上谈兵。

**审核维度**（适用于本批的维度，缺一不可；不适用的标注 N/A 并说明原因）：

判断维度适用性：先读子 plan 本批范围——涉及 API 路由 → 网络/连通必查；涉及 console 页面 → UI 遍历必查；触及 Invariant → 维度 8 必查。

#### 1. 单测 / 契约测试

```bash
pnpm --filter <pkg> exec vitest run <相关测试>
pnpm test:contract  # 涉及 shared contracts 时
```

基线维度，不能跳过。**额外确认先行 test 真的 red→green 且非假先行**：

- `git show HEAD` 看 test 和 impl 是否在同一 commit（一batch一commit 模型下通常都是，无法靠 commit 顺序区分先后）
- **因此改读 test 本身的断言力**：test 的 assertion 是否真的能在**没有 impl 时 fail**？
  - ✅ 好：`expect(parseResult(input)).toEqual(expected)`——没 impl 时 `parseResult` 抛错或返 undefined，test 红
  - ❌ 假先行信号：`expect(true).toBe(true)` / 只 mock 不断言 / assertion 永真 / test 只测"不抛错"而非"结果对"
  - 如果 test 即使删掉 impl 也能绿 → 假先行，打回 `/lt-execute` 重写 test
- 查 commit 里无新增 `it.skip`/`test.todo`（gate 已拦，review 复核）

#### 2. Log 驱动的 bug 检查（核心维度）

发现静默失败的唯一途径。单测看不见的 error，log 里全有。

1. 标记当前 log 位置（`wc -l <log>` 或记时间戳），区分"本批新产生的"错误
2. 按子 plan 验收点触发对应操作——不要泛泛"触发典型用户操作"
3. 收集所有相关服务 log：
   ```bash
   tail -50 <服务log> | grep -iE "error|warn|fail"
   ```
4. 分类错误：
   - **本批引入的**：必须修复或转新任务
   - **历史遗留的**：记录但不阻塞本批（避免范围蔓延）
   - **噪音**（如 health check ECONNREFUSED）：建议降级日志级别

真实案例：`Hook PreToolUse:Skill denied this tool` 就是 log 驱动发现的——单测全绿，
但 log 里 Skill 调用全部被 deny。

#### 3. UI 按钮遍历

本批涉及 console/bff 路由时，遍历受影响页面的所有按钮/功能。

1. 定位受影响页面：根据本批改的路由 grep console 调用方
2. 读页面组件，找出所有 `<button>`、`onClick`、表单 submit
3. 逐个触发：列表加载 / 新建 / 编辑 / 删除 / 搜索 / 筛选 / 分页 / 空状态 / 错误状态
4. Playwright 自动化困难 → 标"⏳ 建议人工补充遍历"，不要因难就跳过

#### 4. 网络请求检查

UI 遍历时同步检查浏览器 devtools Network（或 curl 模拟）：

- **404**：路由未挂载（catch-all 下线后常见）
- **401**：auth header 缺失（`X-User-Id` 注入失败？session 过期？）
- **500**：服务端异常，去 log 找 stack trace
- **CORS**：跨域请求被拦（vite proxy 配置错？）
- **cookie 丢失**：会话 cookie 没带上
- **请求重复**：`useRouter()` 不稳定导致无限 fetch

#### 5. 跨服务连通

```bash
curl http://localhost:<port>/health   # 各服务（按本项目实际端口）
```

各服务都通才算 pass。

#### 6. 服务进程存活检查（流式 / SSE 批次必查）

流式路由客户端断开时若写入未 guard，未捕获异常会 **kill 整个服务进程**。
单测 + curl 全绿，但浏览器一操作就 500——进程已死。

1. 触发本批操作后，**再次** `curl http://127.0.0.1:<port>/health`（不只操作前查一次）
2. `lsof -i :<port>` 或 `ps aux | grep <运行时进程关键字>` 确认进程还活着
3. 进程死了 → log 找未捕获异常 stack（如 `ERR_INVALID_STATE` / `Controller is already closed`）
4. 必须有 e2e「客户端中途断开后服务仍存活」用例，curl 测不出

#### 7. 浏览器 e2e（UI / 流式批次必查，curl 不可替代）

curl 不发起 EventSource、不 abort stream、不渲染前端 Provider/Context，测不出：
- 流式客户端断开导致进程崩
- 缺 Provider / Context（`... must be used within ...`）
- URL 跳转回老路由

1. 跑项目的 Playwright smoke 脚本（如有）或同类浏览器自动化
2. 用真实 URL + 登录态跑完整流程
3. Network 面板看 EventSource 是否 reconnect、是否有 5xx
4. 没现成脚本 → 标「⏳ 建议人工浏览器遍历」，不要因 curl 绿就放行

#### 8. 架构属性（核心维度，防打地鼠的最后一道闸）

这一步防止"每批通过 review 但架构静默烂掉"。execute 跑过 gate，review **独立再跑**确认（不信 execute 报告）。

- **契约未破**：契约测试绿（`test:contract`，涉及共享契约时）
- **无新循环依赖**：dep graph 检查（`madge --circular <源码根>` 或自写脚本）
- **hack 标记不升**：`rg -c "TODO|FIXME|@ts-ignore|@ts-expect-error|hack|XXX" <源码根>` 本批前后对比，上升的须在债清单登记
- **跨层耦合未新增**：扫 import graph，无违反总纲 Invariants 的新跨层 import（如前端直连后端内部实现）
- **半完成态可运行**：本批 commit 后各服务 health 仍通、前端仍能开——整个系统还活着，不只本批功能对
- **Invariant 守卫**：跑总纲 Invariants 对应的守卫脚本（`../lt-execute/references/gates/`）全绿
- **报告 vs diff 互审（越狱检测）**：execute 自报"改了 X 个文件"，review 直接 `git show HEAD --stat` 验。报告与实际不一致 → 越狱信号，强制回 execute 解释。同时验：
  - 报告说"先行 test red→green"，`git show HEAD` 里 test 是否真在同一 commit
  - 报告说"白名单内"，实际 diff 文件是否真在白名单
  - 报告说"无新 hack"，hack 计数是否真没升
- **打地鼠信号检测**：
  - 本批修复的 bug 中 **root-cause 修复** vs **symptom 修补** 各几个；symptom 占比高 = 架构在烂
  - 同一处代码**本批改了且上批也改过**（`git log -p <file> | grep` 看是否连续两批动同一行）→ 拆分错误警报，回 `/lt-plan` 重拆
  - 本批引入的 `TODO(arch-debt)` 是否进了总纲债清单（没进 = 偷偷欠债）

gate 脚本位置：`../lt-execute/references/gates/`（review 直接跑这些脚本做独立验证）。

#### 9. Spec 同步（specs/，长期治理，不可跳）

防"代码改了、行为契约没人记"——长任务跨多批，spec 不同步 = 半年后无人知系统该干嘛。

- `git show HEAD --stat` 看本 commit 是否含 `specs/*.spec.md` 变更
- **直接跑 `check-spec-sync.sh <子plan>`**（独立验 execute 报告，不信 execute 自报）：声明 vs diff 一致、N/A 豁免理由、N/A 与行为改动不矛盾
- 对照子 plan `## Spec 同步` 字段：列出的 spec 文件是否真改了
- **改用户可见行为（新端点 / UI 交互 / 状态机 / API 语义 / 错误场景）但无 spec 变更** → 打回 `/lt-execute` 补 spec，不许 merge
- spec 内容检查：GWT 写的是用户可见行为 + 边界/失败模式，不是私有签名 / CSS / 实现顺序
- 子 plan 标 N/A 的批次：核对理由是否属豁免类（纯样式/文案/docs-only/lockfile/常量）；非豁免却标 N/A → 越狱信号
- 依据：新增路径由仓库 governance hook 阻断（如有）；改已有逻辑由 `check-spec-sync.sh` gate + review 维度 9 兜底

#### 10. 对抗式收口（按适用；有故障/验收宣称时必做）

**立场**：假设本批修复/结论有问题。完整清单与 SSOT 域表见 [references/adversarial-review.md](./references/adversarial-review.md)。

对每个「宣称修好/通过」的项，按适用回答（单测绿不能代替；不适用写 `N/A（理由）`）：

1. **本批根因还是症状？** 对照子 plan/总纲**本批负责**的那行（不无限上溯）。
2. **权威状态在哪？** 代码→git；集群→git 声明式；密钥→注入流程；节点→装机/库存——对应该域 SSOT，勿统一逼「装机」。
3. **对该域有意义的重建后还在吗？**（重部署/重装依赖/新环境等，按域选）。
4. **本批验收证了什么？** 对照本批验收点；未跑的标未证。
5. **残留是否诚实？** 有无把「当前绿」写成「阶段全修好」？阶段缺口留给哪批？
6. **废招是否写入正式 docs？**
7. **会否固化易漂移的瞬时值且无校验？**
8. **验证入口是否子 plan 假定的真实路径？**（非调试旁路。）

**裁决**（与「半完成态可发布」一致）：

- **本批通过** = 本批契约闭合 ✅，且未谎报阶段根因已闭合；可重复交付按本批 SSOT 域 ✅ 或合法 N/A。
- **本批通过 + 阶段未闭合** = 合法；对抗式一节 MUST 写「阶段根因→Batch X」。
- **当前绿但本批未闭合**（验收未证完 / 症状当本批根因）→ 不得写本批「通过」。
- **末批/阶段宣称闭环** 但阶段根因 ❌ 或总纲退出 Inv 未证 → 不得写阶段「通过」。
- 纯 docs/文案等：整节 `N/A（理由）`，不得省略标题。

**输出**：

```
批次审核：Batch N — <主题>
- 单测：✅ / ❌ / N/A
- 先行 test red→green：✅ / ❌ / N/A
- Log：✅ / ❌ / N/A（发现 N 个本批引入的 error，附证据）
- UI 遍历：✅ / ❌ / N/A / ⏳ 人工补充
- 网络请求：✅ / ❌（哪些 4xx/5xx）
- 跨服务连通：✅ / ❌
- 服务进程存活：✅ / ❌ / N/A
- 浏览器 e2e：✅ / ❌ / N/A / ⏳ 人工
- 架构属性：
  - 契约未破：✅ / ❌ / N/A
  - 无新循环依赖：✅ / ❌
  - hack 标记：✅ / ❌（新增 N 处，已/未登记债清单）
  - 跨层耦合：✅ / ❌
  - 半完成态可运行：✅ / ❌
  - invariant 守卫：✅ / ❌
  - 报告 vs diff 一致：✅ / ❌（越狱信号）
  - 打地鼠信号：无 / 有（<描述>）
- Spec 同步：✅ / ❌ / N/A（specs/<file> 新建/更新；或改行为但缺 spec → 打回）
- 对抗式收口：
  - 适用：必做 / N/A（理由）
  - 当前绿：✅ / ❌（证据）
  - 本批契约闭合：✅ / ❌
  - 阶段根因闭合：✅ / ❌ / ⚠️ 非本批职责（→Batch X）
  - 可重复交付：✅ / ❌ / N/A（SSOT 域：…；缺口…）
  - 未证项：[ … ]
  - 残留 follow-up：[ … ]
  - 废招风险：无 / 有（…）
- Bug 列表：
  1. <bug 描述>（log 证据 / 复现步骤）
  2. ...
- 结论：通过 / 通过但阶段未闭合 / 当前绿但本批未闭合 / 需修复
- 下一步：
  - 通过且非末批 → /lt-execute <plan> <N+1>
  - 通过且末批且阶段闭合 → **提醒人工**删除 `plans/<phase>/`
  - 通过但阶段未闭合 → 下一批继续；勿删 plans、勿宣称阶段 done
  - 当前绿但本批未闭合 → 补本批验收/SSOT 或降级结论；不得假装 Batch done
  - 需修复 → /lt-execute <plan> N fix
  - 打地鼠信号有 → 回 /lt-plan 重拆
```

### 计划收尾（末批通过后提醒人工，不自动删）

`plans/` **不是长期治理**：全批执行完、末批 review 通过后，在报告里**提醒用户人工删除**整个 `plans/<phase>/`。**agent MUST NOT 自动删**——由人确认后自己删（或人明确要求再删）。

提醒模板：

```
末批已通过。`plans/<phase>/` 是临时脚手架，建议人工删除。
删除前请确认：
- [ ] 用户可见行为已落在 specs/
- [ ] 仍有 force 的 WHY 已迁到项目 decisions/ADR（如适用）
- [ ] 没有 SSOT 只留在即将删除的 plans/ 里
```

## 退出条件

- 审核报告产出（含对抗式收口分层结论，或整节 N/A 理由）
- 有 bug：明确列出 bug + 证据 + 建议下一步
- **本批契约闭合**且未谎报阶段状态：可写本批「通过」（阶段未闭合须点明）
- **仅当前绿、本批未闭合**：不得写本批「通过 / Batch done」
- **末批通过且阶段闭合**：报告里已提醒人工删 `plans/<phase>/`（不自动删）
- **Spec 同步缺失**：明确打回 `/lt-execute` 补 `specs/` spec，不许 merge
- **打地鼠信号有**：明确建议回 `/lt-plan` 重拆，不要只修当前批

## 跟踪进度

跨批次审核用 TodoWrite 跟踪"Batch 1 review ✅ / Batch 2 review ❌（2 bug）/ Batch 3 pending"。

## 兼修模式

如果 bug 数量少（≤2）、修复 diff < 50 行、不涉及架构变更或跨服务影响，审核者可直接修：
- 修完 → 重新验证 → 报告通过
- 适合收尾阶段

超出以上任一条件（3+ bug、diff > 50 行、涉及架构或跨服务、触及 Invariant）转回 `/lt-execute`——
审核者 context 被修复工作污染后，后续审核盲区会变大。保持角色边界。

## 不做的事

- **不拆任务**（/lt-plan 的活）
- **不做大范围代码改动**（/lt-execute 的活，兼修模式例外）
- **不跳过 log 检查**——log 是发现静默失败的唯一途径
- **不只跑单测就放行**——单测全绿但运行时崩溃是最常见的失败模式
- **不把历史遗留 error 当本批 bug 修**——范围蔓延，记下来转独立任务
- **不只跑 curl 就放行 SSE / 流式批次**——curl 测不出 EventSource 断开导致的进程崩
- **不跳过架构维度（维度 8）**——每批过 review 但架构静默烂掉就是漏了这一步
- **不跳过 Spec 同步维度（维度 9）**——代码改了行为但 specs/ 没动 = 行为契约丢失，长任务跨批累积后无人知系统该干嘛
- **不把「当前绿」写成「本批通过」或「阶段全修好」**——分层写；半完成态允许本批过、阶段仍开放
- **不用基础设施题折磨无关批次**——可重复交付按 SSOT 域；无运维变更勿逼装机/CNI
- **不把非 SSOT 活状态手修当成可重复交付**——对应该域权威源缺失则 ❌
- **不自动删除 `plans/`**——末批通过后只提醒人工删；长期治理只留 `specs/` + 项目 decisions/ADR（如有）
- **不信 execute 的自测报告**——独立跑 gate / `git show HEAD` 验，报告 vs diff 互审

## 项目专属速查

本项目踩过的坑、审核硬性检查项，记进 `references/bug-signatures.md`（症状→根因→验证手段）。审核涉及已知高风险模式（流式 / schema 迁移 / 深度组件复用 / 契约改动）时，先翻该表，把对应检查加进本次审核。每审完一个难定位的 bug，回填一条。

## 深度参考

- 对抗式收口（适用/N/A、SSOT 域、分层裁决）：`references/adversarial-review.md`
- 症状→根因速查（项目自填）：`references/bug-signatures.md`
- **硬约束 gate（review 独立再跑）**：`../lt-execute/references/gates/README.md`
