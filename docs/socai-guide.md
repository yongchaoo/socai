# socai 用户手册

> 薄编排器：给一个目标，拆成批次，每批派一个独立 subagent 写码；编排者只跑测试/规范门禁、绝不碰源码；末尾压成一个 commit 合回主干。
>
> 相关：入口 `AGENTS.md` · 行为契约 `specs/ma-v3-architecture.spec.md` · 方向决策 `docs/decisions/0001` · 原型验证 `docs/decisions/0002` · 编排 skill `.claude/skills/socai/SKILL.md`

## 它解决什么

**不是「比直接用 Claude Code 更聪明」，是「更不容易在长任务里坏掉」。**

真实工况：弱模型 + 有效上下文远小于标称（长 context 注意力稀释）+ 会话会断。在这套工况下，socai 靠「每批独立上下文 + 状态全在文件 + 机械门禁」保住任务——**坏得更慢、能续命**。

价值区：**中等偏大、需求有点模糊**的真任务。小清晰任务直接让 Claude Code 干就行。

## 前身（已删除）

v1 自治 CLI、v2 `/ma` role-play skill 已从仓库移除（见 ADR 0001）。spine + `socai-backends`/`socai-call` 留在现行 `/socai`。

## 三层架构

| 层 | 机制 | 治什么 |
|----|------|--------|
| **执行** | 每批 spawn `socai-executor`（全新隔离上下文）→ 写码+测试+commit+回摘要，内部上下文返回即丢 | v2 的慢 / token 多 / 糊（一个 session 戴多 hat，上下文单调膨胀） |
| **持久（spine）** | 状态全在 `.socai/<slug>/`（goal / master / 子 plan / progress；相对 cwd，不进 git）+ git commit | 会话断了能续（session 无关） |
| **自治** | 机械 gate（test / spec-sync / lint）+ fixer 封顶 3 + 高风险 escalation | 不靠人盯也能放手跑 |

## ★ 铁律（让它 work 的那一条）

> **编排者永不 Read / Edit / Write 源码。** 源码改造 100% 由 `socai-executor` 做。编排者只：
> 1. 写 `.socai/<slug>/`（自己的脚手架：goal / master / 子 plan / progress；相对 cwd）；
> 2. **spawn** subagent（Agent 工具）；
> 3. **Bash** 跑 gate（`git` / `node --test` / gate 脚本——命令输出是文本，不触发文件跟踪渗漏）。

**为什么**：原型实测（ADR 0002 exp2）——编排者一用 Read/Write 碰源码，CC harness 就把后续 diff 自动注入编排者上下文（每批 ~20-42 行），「恒定上下文」当场破。零触碰 = 零渗漏 = 编排者真的薄、可跨窗口续。

## 跑一次发生了什么（attended 模式）

```
/socai "目标"
 ├─ 0. 切分支 socai/<slug>，写 goal.md + 00-master.md（批次拆分 + 验收点）        [yes]
 ├─ 1. 出方案（trivial 跳过；否则 spawn 调研 subagent）                            [yes]
 └─ 2. 每批 N = 1..K：
      ├─ spawn socai-executor(batch spec) → test-first 写码 + commit + 回摘要         ← 编排者不读源码
      ├─ Bash 跑 gate：test / commit-msg / hack-count（specs/ 在 → spec-sync）
      ├─ gate 挂 → spawn fixer（带失败）→ 重跑，封顶 3 轮 → 还不行喊人
      ├─ 高风险 diff（auth/schema/contract/大 diff）→ spawn socai-reviewer
      │                                         → socai-call diff-review（强模型审）
      └─ 写 progress.md                                                             [yes，非末批回 2]
 └─ 3. 全批过 → squash-merge socai/<slug> 回 main（一个 commit）+ 删分支
```

跑 10 批，编排者上下文还是扁平的——每批只吸收 socai-executor 的 ~6 行摘要 + gate 的命令输出，不背源码、不背测试全文。

**Executor 模式（三选一）**：
- **原生**：未配 `roles.executor` → 宿主会话模型 spawn `socai-executor`。
- **Cursor 宿主（cursor-host）**：`backend:"cursor"` **且** 编排者在 Cursor IDE 里 → Task spawn `socai-executor` + 显式 `model`（来自 config，未配用会话默认）。**不**跑 `socai-call exec` / `cursor-agent`（避开 CLI ~20–30s 冷启动）。
- **外部**：`claude-deepseek` / `codex` / `claude-glm`，或 `backend:"cursor"` 但不在 Cursor（Claude Code / CI）→ `socai-call exec .socai/<slug>/batch-N.prompt.md`（progress 记 `cursor-cli`）。gate / fixer / review / squash 不变。

## 怎么用

### 前置
- `socai verify` 探各 backend 连通（claude / kimi / codex / cursor / sparring）。
- **executor（写码）**：默认**原生** socai-executor subagent（= 会话模型 glm）。想换执行后端 → 配 `~/.config/socai/config.json`：
  ```json
  { "roles": { "executor": { "backend": "cursor", "model": "composer-2.5-fast" } } }
  ```
  - **Cursor IDE 内**：上式 → **cursor-host**（Task + composer）。在 Cursor 里敲 `/socai` 即可。
  - **Claude Code / CI**：同配置 → **cursor-cli**（`socai-call exec` → `cursor-agent`；冷启动慢）。或改 `backend:"claude-deepseek"` 走外部 CLI（**优先 deepseek**——cursor-cli 有自主 git 毛病，README 踩坑#3）。
  - ✅ **deepseek 已通（2026-08-01 实测）**：`claude-deepseek` 真路由到 deepseek（`modelUsage: deepseek-v4-flash` 实证）。解法三件套（`socai-backends` 已内置）：① 空 `CLAUDE_CONFIG_DIR`（隔离开本机 OAuth）② `ANTHROPIC_API_KEY`（非 AUTH_TOKEN）③ `SOCAI_DEEPSEEK_KEY`（兼容 `MA_DEEPSEEK_KEY`）。**用前 `echo 'export SOCAI_DEEPSEEK_KEY=sk-...' >> ~/.zshenv`**——放 `.zshenv`，**别放 `.zshrc`**。`claude-glm` 同理（`SOCAI_GLM_KEY` / `MA_GLM_KEY`）。
- **reviewer（审码）**：跨模型 review（推荐）：配
  ```json
  { "roles": { "reviewer": { "backend": "kimi", "model": "k3" } } }
  ```
  不配就全会话模型（review 变同模型 theater，但 gate 照常工作）。
- **★ 跨模型铁律**：executor 与 reviewer 必须**异模型族**。executor=deepseek/cursor（含 cursor-host）→ reviewer 可 glm（原生 socai-reviewer）/kimi；executor=glm（原生）→ reviewer 必须 kimi/codex（via socai-call）。

### 跑（Cursor / Trae / WorkBuddy，目标项目目录）
```
/socai <你的目标>
```
- 默认 **attended**：每批停问 y/n，你拍板。
- 说「**放手跑 / auto 模式**」→ yes 闸门全跳，gate + fixer 自跑；停点仅 BLOCKER / 产物验收失败 / fixer 满 3 / infra_fails≥2。

### 两个硬约束
1. 在**新窗口 / 新 session** 里敲 `/socai`——agent 类型（socai-executor / socai-reviewer）只在 session 启动时加载（skill 是热加载，agent 类型不是）。
2. 挑**中等偏大、需求有点模糊**的真任务——那才是 socai 价值区。

### 跨项目用 — 跑 install.sh
```bash
./install.sh                          # 默认 --host=all：Cursor + Trae + WorkBuddy
./install.sh --host=cursor            # 只要一个宿主
./install.sh --verify                 # runtime + 已装宿主
```
装完任何项目 `/socai` 都能用。本仓是 source of truth（软链；失败则 copy）。
脚本落 `$SOCAI_HOME`（默认 `~/.local/share/socai`），不依赖 `~/.claude/skills` 当唯一全局。

## 各文件角色

| 文件 | 角色 |
|------|------|
| `.claude/skills/socai/SKILL.md` | 编排者 skill（`/socai` 触发）：铁律 + 流程 + attended/auto |
| `.claude/agents/socai-executor.md` | 执行 subagent 类型：一批 = test-first + 一 commit + 回摘要 |
| `.claude/agents/socai-reviewer.md` | review subagent 类型：跨模型审 diff / plan（走 socai-call） |
| `socai-call.mjs`（`~/.local/bin/socai-call`） | 多模型薄壳：`plan-review` + `diff-review`（审）+ `exec`（外部 executor spawn） |
| `.claude/skills/lt-execute/references/gates/*.sh` | 机械 gate 脚本（复用）：test / spec-sync / hack-count / contract-change / whitelist / invariant |

## 三条设计原理

1. **打破上下文复利**：v2 一个 session 戴多 hat → 上下文单调膨胀，批 N 为批 1..N-1 全部上下文买单。socai 每批独立 subagent → 编排者上下文恒定（实测 leverage ~16×，见 ADR 0002）。
2. **状态在文件不在记忆**：goal / master / progress + git commit = session 无关。会话断了，新窗口从断点接着跑（spine 续命）。
3. **门禁不靠 AI 判断**：test / spec-sync / lint 是确定性命令抓机械问题；语义层靠**异模型** review 兜（同模型 review 是 theater）；都兜不住才喊人——**不学 v1 用代码模拟永不犯错的人**。

## attempts / infra 口径（auto 长跑）

开批时 progress 记 `batch_base=<sha>`；看-diff 的门与 `diff-review` 用它当底，不用 `HEAD~1`（有 `wip(batch):` 时尤其）。

| 事件 | `batch<N>.attempts` | 其它 |
|------|---------------------|------|
| gate / review 红 → fixer | +1（封顶 3） | — |
| 写手认输或测红放弃 | +1 | — |
| timeout / 空 stderr 的 CLI 死 | **不计** | 同批 `infra_fails` +1；累计 **2** → 停+喊人 |

`socai-call exec` 默认等 3600s；`plan-review` / `diff-review` 仍 600s。HEAD 仍是 `wip(batch):` 时不得开下一批。

## 现状 / 边界（诚实）

- ✅ **地基已验**（ADR 0002：subagent 隔离打破复利 + 零渗漏在真实 harness 成立）。
- ✅ **MVP + 硬化建好**（executor / reviewer / 编排 skill / gate + diff-review + fixer 封顶），125 测试绿。
- ⚠️ **kimi 当前到用量上限（403）**——跨模型 review（plan/diff）会降级到会话模型，直到额度刷新。代码无误，是账号限额。
- ⚠️ **机械 gate 抓机械不抓语义**（plan 对错 / scope 解读 / 幻觉代码抓不到）→ 语义层靠异模型 reviewer 兜，不保证全抓。
- ⚠️ **auto-fix 可能修 A 破 B**（螺旋）→ 靠封顶 3 + 真兜底到人。
- ⚠️ **跨窗口续命**（kill + resume）按性质成立，没单独验过。
- 🔜 **还没在真任务上端到端跑过**——下一步就是新窗口拿真目标试。
