---
name: socai
description: >-
  SoCai 薄编排：目标 → 每批 spawn socai-executor subagent 实现 → 跑机械 gate → fixer 循环 →
  高风险 spawn socai-reviewer → 每批一 commit → 末尾按开工选定的 merge target 收口。编排者永不碰源码（铁律）。
  当用户敲 /socai 给目标，或说「socai / v3 流程 / subagent 流水线 / 放手跑这个」时用。
  触发词：/socai, socai, v3 流程, subagent 流水线, 放手跑。
---

# socai — 薄编排（subagent 执行 + spine + 机械 gate）

只有用户显式 `/socai <目标>` 才用本 skill。

你的角色是**编排者**。串场 + 管分支 + 跑 gate + 记进度。**你不写源码**（socai-executor 的活）、**不审**（socai-reviewer 的活）。

## ★ 铁律（最重要，违反则失效）
**编排者永不 Read/Edit/Write 源码文件。** 源码改造 100% 由 socai-executor subagent 做。
你只：
1. 读/写 `.socai/<slug>/`（你自己的脚手架：goal.md / 00-master.md / progress.md / 子 plan）——这是 spine，OK；**相对 cwd**（在 `app/` 下跑就建 `app/.socai/`）；
2. **spawn** socai-executor / socai-reviewer（按下面「宿主 spawn」表，禁止猜）；
3. **跑 gate 用 Bash**（`git log` / `node --test` / gate 脚本）——命令输出是文本，**不触发 harness 文件跟踪渗漏**。

**为什么**：原型实测（`docs/decisions/0002`）——编排者一用 Read/Edit/Write 碰源码，CC harness 就把后续 diff 注入编排者 context（每批 ~20-42 行），打破「恒定 context」。零触碰 = 零渗漏 = 编排者真的 thin、可跨窗口续。

## ★ 宿主 spawn（三选一，禁止猜）

先判定当前宿主，写进 `progress.md` 的 `host=`，再按该行 spawn。**禁止**用别的宿主的工具名 / 模型 slug。

判定（只判一次）：
- 本会话有 Task / Agent 工具，且能传 `subagent_type` + `model` → `host=cursor`
- 产品名是 Trae / Trae CN，或会话约定 `.trae/` → `host=trae`
- 产品名是 WorkBuddy / CodeBuddy → `host=workbuddy`
- 否则 → `host=unknown`，只走外部模式 `socai-call exec`（不假装能 spawn 原生 subagent）

路径（脚本只认这两处，不认 `~/.claude/skills` 当唯一全局）：
```
SOCAI_HOME="${SOCAI_HOME:-$HOME/.local/share/socai}"
# 项目仓 vendor 优先，否则 install.sh 装的 runtime
#   $SOCAI_HOME/runtime/   ← bug-memory.sh / run-log.sh / is-high-risk.sh / check-*.sh
#   $SOCAI_HOME/gates/     ← lt-execute gate 脚本
#   $SOCAI_HOME/agents/    ← socai-executor.md / socai-reviewer.md（fallback 内联用）
#   $SOCAI_LOG_ROOT        ← 默认 $SOCAI_HOME/logs
```

| host | 怎么 spawn executor / reviewer | 禁止 |
|---|---|---|
| cursor | Task / Agent，`subagent_type=socai-executor` 或 `socai-reviewer`；可传 `model`（config / `SOCAI_EXECUTOR_MODEL`，未配用会话默认）。类型不识别 → `generalPurpose` + 内联 `$SOCAI_HOME/agents/socai-executor.md`（或项目 `.claude/agents/`）+ 同一 model | 禁止对本批再跑 `socai-call exec`（那是 cursor-cli） |
| trae | 调用具名 subagent `socai-executor` / `socai-reviewer`（装在 `~/.trae/agents/`）。内置 Agent 可点名委托。类型不识别 → 通用 agent + 内联 `$SOCAI_HOME/agents/…`。**只用 Trae built-in 模型名** | 禁止假设有 Task / `subagent_type` / Cursor 模型 slug |
| workbuddy | 优先 spawn 自定义 agent `socai-executor` / `socai-reviewer`（`~/.workbuddy/agents/`）。没有 agent 工具 → 调 skill `socai-executor`（`context: fork`）。都不行 → 通用 + 内联 `$SOCAI_HOME/agents/…`。**只用 WorkBuddy 模型名** | 禁止传 Cursor / Trae 专属 slug |
| unknown | `socai-call exec` | 禁止假装能 spawn 原生 subagent |

host 若换不了 reviewer 模型（如 Trae 只用 built-in）→ progress 记 `THEATER_RISK=1`，review 仍跑，只当机械 gate 补充，不当跨模型保证。

## 核心约定
- 一次 `/socai` = 一个目标 = 一条新分支 `socai/<slug>` = 末尾按开工选定的 **merge target** 收口（见步骤 0，不默认回 main）。
- **闸门模式**：`attended`（默认，每批停问 y/n）/ `auto`（放手：yes 闸门全跳，gate+fixer 自跑，review CONCERNS 自动修一轮再审——CI/后台用）。
  - **auto 停点仅四**：review **BLOCKER** / 本批或收尾**产物验收失败** / **fixer 满 3** / **infra_fails≥2**。
  - **不停：仅因** `is-high-risk` 命中或 `risk: high`（高风险照常自跑，只多 spawn reviewer）。
  - **auto = 无人值守（长时间挂起，人不在）**：除四停点外**禁止任何形式提问/等确认**——不问「要不要 commit / 进下一批 / 选哪个 baseline / 要不要合支 / 审计划还是审结果」。所有决策点一律走推荐路线（见下），所做假设记 `progress.md`。
  - **auto 默认推荐路线**（决策点用户未指定时，直接采用，不问）：
    - baseline 歧义（脏树未指定）→ `wip-anchor-then-branch`（保 WIP 落锚点再切支，不丢工作）
    - merge target 未指定 → `keep-branch`（不擅自合 main，留支 + 报告交人）
    - 「用户本能 vs 实际」表填不出 2 行 → 用目标原文 + bug-memory 推最合理 2 行，progress 记 `AUTO_ASSUMED=1`，继续
    - 批间过渡 / review 通过 / 收尾最终确认 → 不停不问，直接进下一批 / 按 merge target 收口
    - 目标本身不清楚 → 按最合理解释前进并记录假设；仅当完全无法形成可执行目标时停（等同 BLOCKER 喊人）

## 流程

### 0. 开工
1. 确认目标；不清楚先问。
2. 切分支前**钉死开工 baseline + merge target**（各三选一，写入 `progress.md`；用户已在对话里选定的直接记录、不重问）：
   - **baseline**（工作区从哪起步）：`baseline=clean-cut`（干净树直接切支）/ `baseline=wip-anchor-then-branch`（先把 WIP 落成锚点 commit 再切）/ `baseline=reuse-head`（沿用当前 HEAD 切支）。`git status --porcelain` 非空且用户没指定 → attended **不进 executor，先问**（auto 不问，走默认 `wip-anchor-then-branch`）；禁止默默 `git add -A`。
   - **merge target**（收尾合去哪）：`merge=main` / `merge=integration:<branch>` / `merge=keep-branch`（不合任何支，留支交人）。`git merge-base --is-ancestor main HEAD` 为假，或 progress 有 WIP 锚点 / 用户已声明 main 不是集成支 → **禁止默认 squash** 回 main，收尾只提示已选 target。
3. 切分支 `socai/<slug>`（slug = 目标 kebab；已存在就复用）。**不碰 main**。
4. **召回历史教训**（Bash，只 redirect 不 Read 内容——守零渗漏铁律）：
   ```
   SOCAI_HOME="${SOCAI_HOME:-$HOME/.local/share/socai}"
   if [[ -x .claude/skills/socai/_runtime/bug-memory.sh ]]; then
     BUGMEM=.claude/skills/socai/_runtime/bug-memory.sh
   else
     BUGMEM="$SOCAI_HOME/runtime/bug-memory.sh"
   fi
   [[ -x "$BUGMEM" ]] || { echo "bug-memory.sh 不存在: $BUGMEM" >&2; exit 1; }
   bash "$BUGMEM" recall <slug> <query...>
   ```
   目标仓通常不 vendor 该脚本，必须走 `$SOCAI_HOME/runtime` 回退。禁止只跑仓内相对路径。
   - query = 目标的人话描述（如「coffee quiz 选择 颜色 反馈」）。
   - 产物 `.socai/<slug>/bug-memory.md` 供 executor 读；你只 redirect，不读内容。
   - life-kb 不存在/无命中 → 脚本在 bug-memory.md 写显式 `⚠️ bug-memory 降级` 标，不阻塞主流程。
   - life-kb 路径解析：`MA_LIFE_DIR`（显式设置但无 `src/cli/search.ts` → 直接按该路径报降级原因，不静默换库）→ `~/.config/socai/config.json` 的 `paths.life` → 仓旁 `../life` / `cwd/../life`。开工可先 `bug-memory.sh doctor`（非 0 = 记忆不可用，会打印解析到的路径与各依赖有无）。
   - node CLI 因缺 tsx / Ollama embedding `fetch failed` 挂掉时，脚本降到 `life-fts-fallback.py`（直接查 `data/life.db`）；**向量侧失败 ≠ 没有记忆**，不得因此写「life-kb 不可用」。
   - `recall` 的 `wrote …` 只打 stderr；**禁止** `recall … > bug-memory.md`（会把状态行写进记忆文件）。
   - **读 bug-memory.md 见 `⚠️ 降级` 标 → 在 `progress.md` 复述**（编排者须感知无历史教训兜底，executor 仍可读文件细节）。
5. 写 `.socai/<slug>/goal.md`（目标原文）+ **两层 plan 结构**（对齐 lt-plan `SKILL.md:54-58`）：
   - **总纲** `.socai/<slug>/00-master.md` — 短 ~100-200 行：「用户本能操作 vs 实际结果」表（2-3 行）+ 症状清单（按严重度）+ 根因 + 批次清单 + 依赖 + **非目标**。**不含每批详情**。
   - **子 plan** `.socai/<slug>/NN-<topic>.spec.md` — 每批一份 ~100-300 行，含该批 Spec/Invariants/Test/验收点/白名单。**executor 只读本批 spec**（context 隔离；禁止把全部批次详情塞进 master）。
   - trivial 目标（一句话、单批）→ master 可直接含该批 spec，可不建子 plan 文件。
   - **非目标**：只列「明确不做」的；拿不准是 bug 还是 feature 的交互，**禁止**写进非目标（默认当 bug 送 review）。
6. **判定 executor 模式**（一次，记进 `progress.md`）：查 `~/.config/socai/config.json` 的 `roles.executor` 或 `SOCAI_EXECUTOR_BACKEND` / `MA_EXECUTOR_BACKEND` env——**三选一**：
   - **原生模式**：未配外部 backend → 按「宿主 spawn」表 spawn `socai-executor`（继承会话模型）。progress 记 `executor=native` + `host=cursor|trae|workbuddy`。
   - **Cursor 宿主（cursor-host）**：`backend=cursor` **且** `host=cursor` → **不**走 `socai-call exec` / `cursor-agent` CLI。progress 记 `executor=cursor-host (<model> via Task)`（model 来自 config / `SOCAI_EXECUTOR_MODEL`，未配用会话默认）。
   - **外部模式（含 cursor-cli）**：`claude-deepseek` / `dsh` / `codex` / `claude-glm`，或 `backend=cursor` 但 `host≠cursor` → `socai-call exec`。`backend=cursor` 的外部路径 progress 记 `executor=cursor-cli`；`dsh` 记 `executor=dsh`。
   - 宿主自检（写进 skill，无探测脚本）：按「宿主 spawn」表判定 `host=`，不要用 Cursor 工具名去套 Trae / WorkBuddy。
   - 跨模型铁律：executor 与 reviewer 必须异模型族。host 能换 reviewer 模型时遵守；换不了则记 `THEATER_RISK=1`。**违反时** `socai-call` 解析 routing 会在 stderr 打 `⚠️ 同模型 theater 风险`（非阻塞），CONCERNS 报告头含 `THEATER_RISK=1`。
7. attended → yes 闸门；auto → 直接进。
8. **执行日志**（自进化语料，打到 `$SOCAI_LOG_ROOT`，默认 `~/.local/share/socai/logs`，不进目标仓 git）：
   ```
   SOCAI_HOME="${SOCAI_HOME:-$HOME/.local/share/socai}"
   if [[ -x .claude/skills/socai/_runtime/run-log.sh ]]; then
     RUNLOG=.claude/skills/socai/_runtime/run-log.sh
   else
     RUNLOG="$SOCAI_HOME/runtime/run-log.sh"
   fi
   ```
   - 开工后：`bash "$RUNLOG" start --slug <slug> --target-repo "$PWD" --goal "..." --mode auto|attended --baseline ... --merge ... --executor ... --reviewer ... --host cursor|trae|workbuddy|claude-code --model-orchestrator ... --model-executor ... --model-reviewer ...`
     stdout 一行 `run_id`；编排者只记 progress，不 Read 日志内容。
   - 计划写完：`bash "$RUNLOG" snapshot-plans --slug <slug> --from .socai/<slug>`（含 `*.prompt.md`）
   - 每批：`event --type batch_start|spawn|gate|review|fixer|infra --batch N --json '{...}'`
   - 开工 recall 后必记：`event --type recall --json '{"status":"ok|degraded|no-hit","hits":N}'`——recall 覆盖率是进化核心指标，不记等于没做
   - review 事件必带 concerns 主题词：`--json '{"verdict":"...","concerns_topics":["≤5 个关键词"]}'`——否则蒸馏只能看到 verdict，看不到哪里弱
   - 收尾：`bash "$RUNLOG" finish --run-id "$run_id" --status done|blocked|aborted --json '{...}'`（不传 slug 也必须清 `current/` 指针；**任何中断路径——blocked / 放弃 / 被取代 / 会话将断——都必须 finish**，开工 start 前若 `current/<slug>` 已存在 → 报有烂尾 run，先 finish 或续跑）
   - `check-test-gate.sh` 的 argv 是**测试命令**（如 `"pnpm --filter @lexi/agent test stream-response"`），**不是** spec.md 路径。
   - 目标仓 gate 若未实现 `LT_DIFF_BASE..HEAD`，已 commit 后会假绿——优先用 `$SOCAI_HOME/gates/`，或先对齐仓内副本。

### 0.1 常识/范式强检触发（机械信号，不靠语义判断）
满足任一 → 在 `00-master.md` 标「范式待审」，spawn reviewer 时点名「必查控件范式」：
1. 产物 HTML 命中选择类 UI。编排者用 Bash+node 跑 `isChoiceApp`（**只输出布尔，不读 HTML 内容、不渗漏**）：
   `node --input-type=module -e "import{isChoiceApp}from'${SOCAI_HOME:-$HOME/.local/share/socai}/runtime/lint-smoke.mjs';import{readFileSync}from'fs';console.log(isChoiceApp(readFileSync('<产物html>','utf8')))"`
2. `bug-memory.md` 的「范式保底检索」段非空（命中任意 paradigm_class 类教训，含 control-paradigm / sse-lifecycle 等）。
3. 「用户本能 vs 实际」表填不出 2 行 → attended **不进 executor，先回问用户**；auto 不问，按核心约定 auto 默认路线推 2 行 + 记 `AUTO_ASSUMED=1` 继续。
为什么：弱模型判不出「bug 还是 feature」（coffee-quiz 实测把锁死反认成 feature）；把判定降成机械信号（产物类型 + 文件非空 + 表行数），让走查（步骤 4）和 reviewer 常识清单去接。

### 1. 出方案（可选）
- trivial → 一句话方案，进步骤 2。
- 否则 spawn 一个 Explore/方案 subagent 调研出方案，落 `.socai/<slug>/00-master.md`（总纲层，不含每批详情）。**方案 subagent 也不改源码**。

### 2. 每批 N（核心循环，N = 1..K）
0. **开批钉死 batch_base（spawn 写手之前）**：
   ```
   batch_base=$(git rev-parse HEAD)
   ```
   写入 `.socai/<slug>/progress.md` 一行 `batch_base=<sha>`。本批所有看-diff 的 gate / `diff-review` / `is-high-risk.sh` 一律用 `LT_DIFF_BASE=$batch_base`（或把 base 参数设成该 sha），**禁止**在本批存在 `wip(batch):` 时用 `HEAD~1`（多笔 wip 会只看见最后一小段）。本批最终 commit 已在且标题不是 wip 后，划掉或改成 `batch_base=`。
   - **治理 commit 与 batch_base 收口**：功能收口清 `batch_base=` 之后，编排者自己改 `plans/` / `.socai/` 的治理 commit **不得**再用旧 `batch_base` 跑 whitelist / spec-sync（会把治理文档算进本批 diff）——用新 base，或依赖 whitelist / spec-sync 对 `plans/` `.socai/` 的豁免。
   - **续跑**：progress 里本批 `batch_base` 还在，或 `git log -1 --format=%s` 匹配 `^wip\(batch\):`，或工作区脏 → spawn prompt 写明禁止 reset/checkout 丢改动。
   - **开下一批前**：`git log -1 --format=%s` 若匹配 `^wip\(batch\):` → **不得开下一批**；喊写手收口压成最终 commit，或喊人。
   - **派写手（开工前，只认 `^risk:`）**：Bash 抽本批 spec 第一处 `risk: high` / `risk: low`（`grep -E '^risk:'`）。`risk: high` 且全局配了 `roles.executor_high_risk` → 本批用它（cursor-host 传其 model；外部 `socai-call exec --risk=high`）。**没配不强停**——仍用默认写手，progress 记 `HIGH_RISK_WEAK_EXECUTOR=1`。但**打包 / SEA / 权限 / sidecar** 类 `risk: high` 批须满足其一：配了 `roles.executor_high_risk`，或子 plan 声明了 `acceptance.artifact` 产物验收字段（完整协议见 B05 / 步骤 3 收尾）——只记账不算完成。缺 `risk:` → 默认写手 + `RISK_FIELD_MISSING=1`（规划债）。**禁止**用 `is-high-risk.sh` / 行数 / 文件名关键词派写手（那是审稿信号）。
   - **tags → 签名塞 prompt（检索，非常驻人格）**：子 plan 头有 `tags:`（如 `tauri,desktop`）时，用 Bash 抽 `.claude/skills/lt-review/references/bug-signatures.md` 中章名与 tag 有交集的段落，**redirect 追加**到本批 `batch-N.prompt.md`（或 spawn prompt）；没命中不加。示例：
     ```
     SPEC=.socai/<slug>/NN-….spec.md
     SIG=.claude/skills/lt-review/references/bug-signatures.md
     [[ -f "$SIG" ]] || SIG="$SOCAI_HOME/refs/bug-signatures.md"
     TAGS=$(grep -E '^tags:' "$SPEC" | head -1 | sed 's/^tags:[[:space:]]*//')
     # 章名含 tag 词则把该 ## 段 append 到 prompt（不 Read 进编排者对话）
     ```
1. **执行这一批**——按步骤 0 判定的 executor 模式三选一（spawn 一律走「宿主 spawn」表）：
   - **原生模式**（默认）：按 `host=` spawn socai-executor，传**本批** `NN-<topic>.spec.md` + 分支 `socai/<slug>` + 验收命令。它 test-first 实现 + commit + 回摘要。
     - fallback：socai-executor 不识别（agent 类型只 session 启动时加载）→ 通用 agent + 内联 `$SOCAI_HOME/agents/socai-executor.md`（或项目 `.claude/agents/socai-executor.md`）正文，行为等价（见 `docs/decisions/0002`）。
   - **Cursor 宿主（cursor-host）**：仅 `host=cursor`。用 Task/Agent **spawn `socai-executor`**，**显式** `model=<config model>`（未配用会话默认）。prompt 与原生相同。**禁止**对本批再跑 `socai-call exec`（那是 cursor-cli，每次冷启动 ~20–30s）。
     - fallback：`socai-executor` 类型不识别 → `generalPurpose` / `general-purpose` + 内联 executor 正文 + **同一 model**。
   - **外部模式**：把以下内容写进 `.socai/<slug>/batch-N.prompt.md`（顺序固定），在项目根（`socai/<slug>` 分支上）跑：
     1. `$SOCAI_HOME/agents/socai-executor.md`（或项目 `.claude/agents/socai-executor.md`）正文（role 纪律：`<restate>` / test-first / 一批一 commit / 回 ≤6 行摘要）
     2. **`<restate>` 提醒**：动手 edit 前先输出 ≤5 行硬约束复述（本批 spec 要点 + 验收命令），再改码
     3. 本批 `NN-<topic>.spec.md` 全文
     4. 验收命令清单
     ```
     socai-call exec .socai/<slug>/batch-N.prompt.md
     ```
       stdout = executor 摘要。executor（deepseek/cursor-cli/codex/dsh）在当前 worktree 改码 + commit。⚠️ cursor-cli 冷启动慢且有自主 git 毛病；Cursor IDE 内应走 cursor-host。默认 `--timeout` 未给时 **3600s**（`plan-review` / `diff-review` 仍默认 600）。
   - **三种模式都：你不读它改的源码，只收摘要**（铁律不变——外部模式编排者更不可能渗漏；宿主/原生靠 subagent 隔离）。
2. **跑机械 gate（Bash，不碰源码）**——按项目信号选跑。**socai 流程 executor 先 commit、编排者后跑 gate**，工作区 clean，看-diff 的 gate 须 `export LT_DIFF_BASE=<progress 里的 batch_base>`（本批 diff = `$batch_base..HEAD`）；未设则 gate 看暂存/工作区 diff（lt-execute commit 前跑，向后兼容）。gate 脚本目录解析：先查项目本地 `.claude/skills/lt-execute/references/gates/`，没有再查 `$SOCAI_HOME/gates/`（`install.sh` 装的）；命令里用解析出的绝对路径，如 `LT_DIFF_BASE=$batch_base $GATES_DIR/check-spec-sync.sh`：
   - **总跑**：测试（`node --test` 或项目测试命令）+ commit-msg（一批一 commit、msg 清晰）+ hack-count（无 console.log/调试残留）+ **test-gate FAIL_TO_PASS**（`check-test-gate.sh`：实现 revert 到 HEAD 后 test 须 fail，防假先行）
   - **`specs/` 存在时**：spec-sync（`check-spec-sync.sh`——行为源码改了 spec 必须同步）
   - **合同门（子 plan 有 `contract:` 或 high+tauri 须声明）**：`bash $SOCAI_HOME/runtime/check-source-contract.sh <本批spec> <目标仓根>`（项目仓有 `.claude/skills/socai/_runtime/` 则用仓内；缺文件/token 不等 → 非 0）。`LT_DIFF_BASE` 仍用本批 `batch_base`。
   - **高风险路径时**：contract-change（`check-contract-change.sh`）+ 触发 escalation
   - **可选**：file-whitelist（只动该动的）、invariant（项目不变量）
3. **gate 失败 → fixer 循环**：再按同模式 spawn executor（cursor-host 仍带同一 `model`；外部带失败进 prompt / `socai-call exec`）→ 重跑 gate。**attempts 口径**（记 `.socai/<slug>/progress.md`）：
   | 事件 | `batch<N>.attempts` | 说明 |
   |------|---------------------|------|
   | gate / review 红 → fixer | +1 | 吃封顶 3 |
   | 写手认输或测红放弃 | +1 | 同上 |
   | timeout / 空 stderr 的 CLI 死（infra） | **不计** attempt | 同批 `infra_fails` +1；累计 **2** → 停+喊人 |
   到 3 还不过 → 停 + 喊人（escalation，不裸奔、不无限重试、不修 A 破 B 螺旋）。
4. **高风险 diff → 跨模型 review**：编排者跑 `bash $SOCAI_HOME/runtime/is-high-risk.sh $batch_base HEAD`（项目仓有则用 `.claude/skills/socai/_runtime/is-high-risk.sh`；机械 grep diff **内容** 命中关键词 → exit 0）；**或** `git diff --stat $batch_base HEAD` 显示 >300 行大 diff（补充信号）。任一命中 → 按「宿主 spawn」表 spawn socai-reviewer，它跑 `socai-call diff-review $batch_base HEAD`（强模型审；异模型才不是 theater，同模型是）。trivial → 跳过。
   - **交互类 UI 产物**（选择/表单/多步流程——见 0.1 触发）即使 diff 小也 spawn socai-reviewer：常识/范式漏检不在行数信号里，靠 reviewer 固化清单兜底。
   - review CONCERNS + blocker → 回 executor（同模式）修 → 再 review（也吃 fixer 封顶 3）。
5. 写 `.socai/<slug>/progress.md`（更新：done 批次 / 当前批 / 在等什么；本批收口后清 `batch_base=`）。
6. attended → yes 闸门；非末批 → **先确认 HEAD 不是 `wip(batch):`**，再回 2 出下一批（可能需先 /lt-plan 补子 plan）。

### 3. 收尾
- **产物验收（声明了才跑，跑了才算数）**：全批 gate 绿后，对每份含独占行 `acceptance.artifact: kind=... max=... [path=...]` 的子 plan 跑
  `bash $SOCAI_HOME/runtime/check-artifact.sh <子plan>`（项目仓有则用 `.claude/skills/socai/_runtime/check-artifact.sh`；无字段 → exit 0 跳过；协议全文见 B05 / `specs/socai/orchestration.spec.md` 收尾产物测量节）。
  - `kind=app-size`：量 mount 后安装 `.app`（`du -sm`）≤ `max`；找不到 `.app`/`.dmg` → 非 0 fail-loud，**禁止**用 staging / `du resources` / `--check` 数字顶替（desktop-slim 257M 假绿教训）。
  - 非 0 → 停：回 fixer 或喊人。auto 停点之「产物验收失败」即此命令非 0。
- **distill（自进化闭环，finish 前必评估）**：从本 run jsonl 提炼教训入库，让下一次 recall 有货。
  - **机械触发**（满足任一 → 必须蒸馏 ≥1 条）：本 run jsonl 含 gate 红（`fail>0` / `result=fail`）/ `fixer` 事件 / review `CONCERNS` / `infra` 事件 / 假绿标（`false_green`）。全绿无波折 → 豁免。
  - **做法**：编排者读**自己的** run jsonl（`$SOCAI_LOG_ROOT/runs/<run_id>.jsonl`——自己的日志，不触零渗漏铁律；>200 行可 spawn subagent 按 `_runtime/distill.prompt.md` 蒸馏）→ 每条教训写四元组（症状/根因/修复/防回归断言）+ frontmatter（`paradigm_class` / `trigger_keywords`）→ 落 `$SOCAI_LOG_ROOT/lessons/<主题kebab>.md`（默认 `~/.local/share/socai/logs/lessons/`）→ `bash "$BUGMEM" ingest <file>`（`inserted=false` = 已有同内容，正常）。
  - **质量机械校验**（不满足不 ingest）：四段齐全非空；防回归断言含可执行命令或明确禁止句式；`trigger_keywords` ≥3 且含本 run 实际出现过的词。
  - **疑点不许断言**：根因未核实 → 根因段写「待核 + 可能方向」，修复段只立规则，禁止把猜测写成事实（093013 样本）。
  - `finish --json` 必带 `distill=ingested:<N>|skipped_clean`，run 自描述。
- 全批 done + gate 过 + 用户最终 review（auto 模式跳过人工确认，直接收口）→ 按 progress 里的 **merge target** 收口：
  - `merge=main` / `merge=integration:<branch>` → **squash-merge** `socai/<slug>` 到该支：
    ```
    git checkout <target> && git merge --squash socai/<slug> && git commit -m "<一句话目标>"
    ```
  - `merge=keep-branch` → 不合任何支，留 `socai/<slug>` 交人；**禁止默认 squash** 回 main。
- 删 `socai/<slug>` 分支（`merge=keep-branch` 时保留）。
- 提醒：`.socai/<slug>/` 是临时脚手架，确认无 SSOT 残留后人工删；长期治理落 `specs/`。

## 闸门怎么停（attended）
每阶段结束输出：**当前状态 + 产物路径 + 下一步**，然后显式问「继续 `<下一步>`？(y/n)」。`n` → 问改什么。别自作主张冲。

## 不做
- **不自治无限重试**（fixer 封顶 3，超了喊人）。
- **不碰源码**（铁律——Read/Edit/Write 源码一律走 socai-executor）。
- **不在 main 上改**（永远先切 `socai/<slug>`）。
- **不自动合 main**（squash 由人 yes 后才做）。
- **不并行多目标**（day-1 顺序）。

## 跟踪进度
任务清单（TodoWrite 或宿主等价工具）：`[开工✓ / 方案✓ / B1 执行☐ gate☐ / B2 … / squash☐]`；每批 yes 后更新 `.socai/<slug>/progress.md`。
