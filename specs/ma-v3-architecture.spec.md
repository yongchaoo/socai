# socai v3 架构 — 行为契约（SSOT）

> 目标架构 = **subagent 执行 + spine 持久 + 机械 gate 自治**。本文件是行为契约（GWT）。
> 探索推理见 `docs/decisions/0001-ma-from-roleplay-to-subagent-spine-gate.md`；状态见 `AGENTS.md`。

## 设计目标（为什么是这个架构）

- v2 的慢 / token 多 / 糊，根因 = 「一个 session 戴多顶 hat」，context 单调膨胀，批 N 为批 1..N-1 全部 context 买单。
- v3 用 subagent 的 context 隔离打破复利；spine 让 subagent 安全（它会丢 context）；机械 gate 让任务能放手跑。
- 价值锚点：**reliability（坏得更慢、能续命）**，不是「想得更深」。

## 范围

- **in**：编排者（小 context）+ executor/reviewer subagent 类型 + spine 文件 + 机械 gate + risk escalation。
- **out**（v1 已否决，不复活）：worktree DAG / accept-spec / scope 门禁 / HEAD 检查 / reviewer-AI fallback / 代码复刻人的判断。

---

## 行为契约

### 执行层：subagent context 隔离

```GWT
Given 一个多批任务（≥3 批）
When 编排者每批 spawn 一个 executor subagent（隔离 context），subagent commit 后只回摘要
Then 主 context 增长 ≈ 恒定（每批只 + 摘要 + 文件指针），不随批数线性膨胀
And 总 token 相比 v2（同任务）显著下降（实测数 TBD）
And 任一批的代码细节不在主 context（grep 主 transcript 不含该批源码）
```

```GWT
Given executor subagent 完成一批
When 它返回前
Then 它必须先 commit 到 socai/<slug> 分支 + 更新 .socai/<slug>/progress
Otherwise 状态丢失（subagent context 被丢弃）— 这是 spine 的强制项，不是建议
```

```GWT
Given 编排者在 Cursor IDE 宿主 + roles.executor.backend=cursor（model 如 composer-2.5-fast）
When 执行一批
Then 用 Task/Agent spawn socai-executor 并显式传 model（cursor-host）
And 不调用 socai-call exec / cursor-agent CLI
And progress.md 记 executor=cursor-host
```

```GWT
Given roles.executor.backend=cursor 但宿主不是 Cursor（Claude Code / CI / 仅 Bash）
When 执行一批
Then 走外部模式 socai-call exec（cursor-cli）
And progress.md 可记 executor=cursor-cli
```

```GWT
Given roles.executor.backend=dsh（或 SOCAI_EXECUTOR_BACKEND=dsh）
When 执行一批
Then 走外部模式 socai-call exec，spawn dsh --profile headless -- <prompt>（OpenAI chat/completions，不走 Anthropic；`--` 防止 frontmatter `---` 被 commander 当成 option）
And 默认 --patch 关掉 dsh 内部 subagent/ralph（防 headless 根 idle 提前收工）
And progress.md 记 executor=dsh
```

### 持久层：spine（durable + resumable）

中间产物路径：`.socai/<slug>/`（相对 cwd，`.gitignore` 不进 git）。两层 plan 结构（对齐 lt-plan）：
- **总纲** `00-master.md` — 短 ~100-200 行：目标 + 批次清单 + 依赖；**不含每批详情**。
- **子 plan** `NN-<topic>.spec.md` — 每批一份 ~100-300 行；**executor 只读本批 spec**。

```GWT
Given 任务跑到第 N 批时会话中断（context 满 / 进程死 / 人为关窗）
When 在新窗口 resume（读 .socai/<slug>/ + git log）
Then 新窗口能从第 N 批断点继续，不重跑 1..N-1 批
And 不依赖任何会话内记忆（goal/master/progress 全在文件 + git）
```

```GWT
Given 弱模型（glm-5.2）+ 短有效 context（effective < 200K）
When 跑一个中等任务
Then 每批 commit + test 把幻觉钉在外部真相（git + 测试）上，下一批从已验证状态起步
And 幻觉爆炸半径限在一批内（不像单跑那样全任务漂移）
```

### 自治层：机械 gate + escalation

```GWT
Given 放手模式（auto，非 attended）
When 每批 executor commit 后
Then 自动跑机械 gate：test / lint / spec-sync / commit-msg（确定性命令，非 AI 判断）
And 全过 → 进下一批（不停等 yes）
And auto 停点与开工 baseline / merge target 协议见 specs/socai/orchestration.spec.md（auto 不因 is-high-risk / risk: high 停；收尾不默认 squash 回 main）
```

```GWT
Given executor 本批暂存了实现文件 + 先行 test
When check-test-gate 跑 FAIL_TO_PASS 校验
Then 实现文件 revert 到 HEAD 后跑 test 必须 fail
And revert 恢复后跑 test 必须 pass
And 若实现前 test 已绿（如 expect(true).toBe(true) 假先行）→ gate 以 WEAK_VERIFY 拒绝 commit
And 校验不依赖 executor 自标记，由 git 暂存 diff + 前后双跑机械判定
```

```GWT
Given socai 流程 executor 已 commit、工作区 clean，且 progress.md 有本批 batch_base=<sha>
When 编排者跑看-diff 的 gate（spec-sync / test-gate FAIL_TO_PASS / file-whitelist / contract-change）或 diff-review / is-high-risk
Then 须设 LT_DIFF_BASE=$batch_base（禁止在本批存在 wip(batch): 时用 HEAD~1）
And gate / review 用 git diff $LT_DIFF_BASE..HEAD 算本批改动（含多笔 wip 的整窗）
And 未设 LT_DIFF_BASE 时 gate 仍看暂存/工作区 diff（lt-execute commit 前跑，向后兼容）
And commit-msg gate 不受影响（看 log 不看 diff）
```

```GWT
Given 本批 HEAD 的 subject 匹配 ^wip\(batch\):
When 编排者准备开下一批
Then 不得开下一批；须喊写手收口压成最终 commit，或喊人
```

```GWT
Given socai-call 无 --timeout flag
When 跑 exec
Then 默认超时 3600 秒
And 跑 plan-review 或 diff-review 时默认仍为 600 秒
```

```GWT
Given 一批 fixer / review 循环
When 计 attempts
Then gate/review 红或写手认输 → batch.attempts +1（封顶 3）
And timeout / 空 stderr 的 CLI 死 → 不计 attempt，同批 infra_fails +1；累计 2 → 停+喊人
```

```GWT
Given 某 gate 失败（如 test 挂）
When 自动修复
Then spawn fixer subagent（带失败信息）→ 重跑 gate；封顶 N 轮（默认 3）
And N 轮仍失败 → 停 + 喊人（不裸奔、不无限重试）
```

```GWT
Given 子 plan 声明 contract: kind tauri-command（js + rust 路径）
When 编排者跑 check-source-contract.sh <子plan> <目标仓根>
Then JS invoke('X') 的 X 集合须等于 Rust #[tauri::command] 后 fn 名集合
And 不等 → 非 0 并打印两侧 token；缺文件 → 非 0
And 门脚本在 SoCai 仓，不依赖目标仓测试当法官
```

```GWT
Given 子 plan 无 contract: 块
When 跑 check-source-contract.sh
Then 退出 0（跳过）
And 若 risk: high 且 tags 含 tauri 且无 contract: none（附理由）→ 非 0（逼规划声明）
```

```GWT
Given 编排者开批、spawn 写手之前
When Bash 抽子 plan 第一处 ^risk: high$ 或 ^risk: low$
Then 写手模型已按 risk 选定（经 resolveRouting / roles.executor_high_risk）
And risk: high 且未配 executor_high_risk → 仍用默认写手，不退出；progress 可记 HIGH_RISK_WEAK_EXECUTOR=1
And risk: low 或缺字段 → 默认写手（缺字段记 RISK_FIELD_MISSING=1）
And 不得用 is-high-risk.sh / diff 行数 / 宽关键词派写手（那些是审稿信号）
```

```GWT
Given 一批 diff 经 is-high-risk.sh 机械 grep（git diff 内容命中 auth/schema/contract/stream 等关键词 → exit 0）
Or git diff --stat 显示 >300 行大 diff（补充信号）
When gate 跑完
Then spawn 异模型 reviewer（socai-reviewer + socai-call diff-review）
And trivial diff（脚本 exit 非 0 且非大 diff）自动过
And 编排者不解读 diff --stat 语义判高风险（弱模型 oracle 不可靠，改机械 grep）
```

### review：跨模型对抗（仅异模型成立）

```GWT
Given reviewer 配成异模型（kimi/codex，经 socai-call 或包成 agent type 内部 shell-out）
When spawn reviewer subagent 审一批 diff
Then 它能抓到同模型（glm↔glm）抓不到的问题
（实证：open-rush 实验 kimi 抓「B3 必须依赖 B2」，会话模型自审漏）
```

```GWT
Given reviewer 跑原生（继承父模型 = glm）
When 审 glm 自己的产出
Then 视为同模型 theater — 不计入有效 review，需切异模型或显式标降级
```

```GWT
Given socai-call plan-review 或 diff-review 解析 executor 与 reviewer routing
When 两者 backend 属同模型族（claude-glm↔claude-glm、native-glm↔claude-glm 等）
Then stderr 打 `⚠️ 同模型 theater 风险:executor=X reviewer=Y`（非阻塞，exit code 不变）
And 报告含 CONCERNS 时 stdout 头部含 `THEATER_RISK=1`
And 族定义：claude-glm / claude-deepseek / dsh / cursor / codex / kimi / claude / sparring 各算一族；原生会话 glm subagent 与 claude-glm 同属 glm 族
```

### bug-memory：life-kb 召回 + 降级显式 + frontmatter 范式

编排者步骤 0.3 调用 `bug-memory.sh recall`；产物 `.socai/<slug>/bug-memory.md` 供 executor 读。编排者只 redirect、不读内容（零渗漏）；见 `⚠️ 降级` 标时在 progress.md 复述。

life-kb 路径解析（含 MA_LIFE_DIR fail-fast）/ doctor 自检 / FTS fallback / ingest 去重 / wrote→stderr 的行为契约见 `specs/socai/bug-memory.spec.md`（B06）。

life-kb `knowledge.content` 头部可选 YAML frontmatter（socai 侧消费，ingest 写入后续）：

```yaml
---
paradigm_class: sse-lifecycle   # 或 control-paradigm / form-submit / ...
trigger_keywords: [eventsource, sse, reconnect, stream]  # 英文，绕 CJK FTS5 分词
---
<原有 content>
```

```GWT
Given life-kb 目录不存在，或主检索 query 无命中
When bug-memory.sh recall 跑完
Then .socai/<slug>/bug-memory.md 含显式「⚠️ bug-memory 降级:本任务无历史教训兜底」
And 流程不阻塞（exit 0，编排者可继续）
And 编排者读 stderr/文件见降级标后须在 progress.md 复述
```

```GWT
Given life-kb 有条目 content 头部含 paradigm_class + trigger_keywords frontmatter
When bug-memory.sh 跑范式保底检索
Then 按各 paradigm_class 用 trigger_keywords（英文 OR 检索）捞对应教训，绕 CJK 分词缺陷
And 不只硬编码 control-paradigm 一类
```

```GWT
Given life-kb 条目无 frontmatter（老条目）
When bug-memory.sh 跑范式保底检索且 scan 未发现 frontmatter
Then 回退现有 control-paradigm 硬编码英文检索（choice select radio …）
And 召回不退化
```

---

## 已知边界（不解决，文档化）

- **机械 gate 抓机械不抓语义**：plan 对错 / scope 解读 / 幻觉代码抓不到 → 语义层靠异模型 reviewer 兜，且不保证全抓（实验里子 agent 幻觉就靠手动 verify）。
- **auto-fix 会螺旋**（修 A 破 B）→ 靠 N 封顶 + 真兜底到人。
- **跨模型 review 仍要 shell out**（原生 subagent 继承 glm）→ 包成 agent type 隐藏 flaky CLI（kimi extract 偶发抽空的坑见记忆）。

## 待验证（prototype 先验，地基假设）

- [ ] subagent 真打破 context 复利：主 context 恒定、总 token 降（vs v2 同任务）。
- [ ] 跨窗口 resume 真能从断点续（强制中断实验）。
- [ ] 机械 gate + auto-fix 在中等任务上放手跑不螺旋。
- [ ] 降条件重跑 direct vs /ma（cap context ~200K + 强制中断 + 全程弱模型）→ expose spine 价值（luxury regime 比错了）。
