# ADR 0001：ma 从 role-play 流水线 → subagent + spine + 机械 gate

- **状态**：ACCEPTED；落地为现行 `/socai`（原 v3）。v1 CLI / v2 `/ma` skill 已从仓库删除（2026-08-04）
- **日期**：2026-08-01
- **关联**：`specs/ma-v3-architecture.spec.md`、`AGENTS.md`、记忆 `ma-pipeline-state`

## 版本状态

| 版本 | 状态 | 结论 |
|------|------|------|
| **v1**（自治 CLI） | ❌ 已删除 | 用代码复刻「永不犯错的人」= 无解，不复活 |
| **v2**（`/ma` skill） | ❌ 已删除 | spine 并入 `/socai`；role-play 层跟 direct 打平 |
| **socai**（原 v3：subagent + spine + gate） | ✅ 现行 | 入口 `/socai` |

## 背景：5 轮 A/B 都没赢 direct CC

v2 设计为串行 role-play 流水线：`sparring 出方案 → /lt-plan → /lt-review(计划) → 每批 /lt-execute + /lt-review(执行)`，每步 yes 闸门。做了 5 轮 direct vs /ma 公平对比（lexi 租户提示词、open-rush opencode runtime 等），结论：

- **小 / 清晰任务**：direct（仔细的 CC）≈ /ma，甚至略优。/ma 多花一轮 sparring 证伪 out-of-scope，仪式开销。
- **硬 / 多 package 任务**（open-rush）：/ma 终于显出差异化（深度 + e2e 真跑验证 + 留痕），但**不是碾压**——direct 靠 competence + 简单架构没掉队。

## 诊断：为什么打不过 direct —— 类目错位，不是工具差距

一句：**v2 是串行 role-play，而一个够强的单个 agent 内部本来就在做这些事。** /ma 不是叠加能力，是把同一能力切五段、中间塞 yes 闸门。

1. **跟 CC 默认纪律大面积重叠**：read-before-write / plan mode / Explore subagent / verify-claims 是 CC 默认，不是 /ma 发明。"direct"≠裸跑，是 CC 默认前置 + 人盯着。/ma 是在其上再叠仪式。
2. **review 跑最弱档**：sparring = glm↔glm 同模型对抗 = 自己审自己；强模型 review 钩子 day-1 关。review 优势被结构性压低。

## 关键修正（用户点破）：1M context 把 /ma 的真优势 neutralize 了

前 5 轮 A/B **全在 1M context + 强条件**下跑——恰好是 neutralize 掉 /ma 真正优势的 regime。真实工况是**弱模型 + 有效 context 远小于标称**（长 context 注意力稀释，中段照样丢）**+ 会话会断**。在这个 regime 下，v2 的 batching + commit + durable 是**承重的（spine），不是仪式**：

- **commit / 批 = 钉死幻觉爆炸半径**：弱模型不会不幻觉，但每批小 + commit + test = 幻觉钉在外部真相（git + 测试）上，下一批从已验证状态起步。这是 grounding。
- **durable 产物 = session 无关状态**：goal/master/spec 落文件 = 任何窗口能续。resumability。
- **分批 = bounded drift**：长单跑必然漂（忘早期决策 / 重复劳动 / 自相矛盾），批把漂移框在小范围。

→ **再定位**：ma 的价值不是「想得更深」，是「坏得更慢、能续命」。前 5 次「/ma 是不是更聪明」的提问本身错了；正确问题是「/ma 在条件降级时是不是更可靠」。

## 解法：spine vs role-play 拆分，换执行机制

把 v2 里两件绑死的事拆开：

- **spine**（durable 产物 + 每批 commit + 跨窗口续）= 承重墙，**留**。
- **role-play**（5 具名角色 + yes 闸门）= 跟单 agent 默认重叠，**削**。

削掉的角色执行换成三层（= v3）：

1. **执行 = CC 原生 subagent**。v2 慢 / token 多 / 糊的根 = 一个 session 戴多 hat，context 单调膨胀，批 N 为批 1..N-1 全部 context 买单。subagent 的 context 隔离打破复利：每批隔离 context、回摘要、内部丢弃，主 context 恒定。
2. **持久 = spine（强制）**。subagent 丢 context → 凡没写进文件的返回就没 → spine 从「锦上添花」升级成「用 subagent 的前提」。两者互相成就，不是二选一。
3. **自治 = 机械 gate + escalation**。替 yes 闸门：test / spec-sync / lint / commit-msg 自动跑；失败 spawn fixer（封顶 N）；高风险 diff pause 等人。这是 v1 的正确替代——v1 死在用代码复刻人，正确解法是机械 gate + escalade 真人，不是多几个 AI 角色。

role-play 五闸门塌缩成按需 spawn 的 executor / reviewer subagent 类型。

## v1 为什么放弃（不复活）

v1（`socai.mjs`）复杂性 100% 在「监管」（worktree 完美隔离 / accept-spec / scope 门禁 / HEAD 检查 / retry×3 / reviewer AI / resume 对账），0% 在产物链。根因：**去掉了人，把人的每个判断用代码复刻** = 模拟永不犯错的人 = 无解，大厂也没整出来。代码留 repo 不退役（`runAgent` / `resolveRouting` 被 v2 复用），但方向上否决。

## 业界参照

- **Anthropic 多 agent 研究系统**（orchestrator-worker）：多 agent 的增量在**并行广度**（同时探 N 个方向），不在把一件事切五段；吃 ~15x token 换覆盖面。→ 映射：并行 Explore subagent 扫面是免费增量，串行 planner→executor 不是。
- **long-horizon agent reliability 共识**（Devin / Cursor / CC background agent）：checkpoint 到持久存储、bound 任务单元、状态可 resume。spine 不是 ma 发明，是「让弱模型长任务可靠」的标准答案。
- **单强 agent + 选择性委派**（Devin / Cursor / CC 原生 subagent）：业界往「一个能干的 agent」收敛，不是「几个角色跳舞」。MetaGPT / ChatDev 那套 SOP 角色扮演退潮，同理——强模型时代，编排协调的开销 > 分工收益。

## 已知边界（别过卖）

- 机械 gate 抓机械不抓语义（plan 对错 / scope / 幻觉代码）→ 语义层靠异模型 reviewer 兜，不保证全抓。
- auto-fix 会螺旋（修 A 破 B）→ N 封顶 + 真兜底到人。
- 原生 subagent 继承父模型（glm）→ 同模型 review 是 theater；跨模型 review 仍 shell out（kimi/codex 经 socai-call），包成 agent type 隐藏 flaky。

## 验证计划（下一步）

1. **prototype 验地基假设**（cheap 先做）：中等任务，每批 execute 换成 spawn subagent，对比主 context 增长 + 总 token。验「context 真不膨胀、token 真降」。不通就停，别投全量。
2. **降条件重跑 direct vs /ma**：cap context ~200K + 强制中断续跑 + 全程弱模型。expose spine 价值（luxury regime 比错了）。
3. 验通后写 v3 完整改造方案（对照 `.claude/skills/ma/SKILL.md` 标删留 + 新增 agent type + gate 命令清单）。
