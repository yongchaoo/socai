# socai

多 agent 薄编排：给目标 → 拆批 → 每批独立 subagent 写码 → 机械 gate → 高风险 review → 按 merge target 收口。

价值不是「想得更深」，是「坏得更慢、能续命」。

## 快速开始

```bash
git clone <repo> socai && cd socai && ./install.sh
./install.sh --verify
```

默认装到 Cursor + Trae + WorkBuddy。只要其中一个：

```bash
./install.sh --host=cursor
./install.sh --host=trae
./install.sh --host=workbuddy
```

装完**开一个新会话**（agent 类型只在启动时加载），在目标项目敲：

```
/socai <你的目标>
```

可选外部执行者：`echo 'export SOCAI_DEEPSEEK_KEY=sk-...' >> ~/.zshenv`

手册：[`docs/socai-guide.md`](docs/socai-guide.md)。

## 支持的宿主

| 宿主 | 状态 | skills | agents |
|---|---|---|---|
| Cursor | 支持 | `~/.agents/skills/`（兼 `~/.claude/skills/`） | `~/.claude/agents/` + `~/.cursor/agents/` |
| Trae | 支持（本机目录已探测） | `~/.trae/skills/` | `~/.trae/agents/` |
| WorkBuddy | 支持（本机目录已探测） | `~/.workbuddy/skills/` | `~/.workbuddy/agents/`（`allowed-tools` + `context: fork`） |
| DeepSeek Harness | 只当 executor backend | — | 配 `roles.executor.backend=dsh` |
| Claude Code | 不作为目标宿主 | 兼容目录仍会装一份 | — |

限制：
- 装完必须新开会话。
- 跨模型 review 取决于宿主能否换 reviewer 模型；换不了则只剩机械 gate（progress 记 `THEATER_RISK=1`）。
- `lexi-*` 三个 skill 是 Lexi registry 工具，跟编排无关，可忽略。

## 路径

| 变量 | 默认 | 用途 |
|---|---|---|
| `SOCAI_HOME` | `~/.local/share/socai` | runtime / gates / agents |
| `SOCAI_LOG_ROOT` | `$SOCAI_HOME/logs` | 执行日志（不进目标仓） |

## 仓库里有什么

| 路径 | 角色 |
|------|------|
| `.claude/skills/socai/` | `/socai` 编排 skill |
| `.claude/agents/socai-executor.md` | 批次执行 subagent |
| `.claude/agents/socai-reviewer.md` | 对抗 review subagent |
| `socai-call.mjs` | `plan-review` / `diff-review` / `exec` |
| `install.sh` | 全局安装（软链优先，失败则 copy） |

## 测试

```bash
node --test socai.test.mjs test-fixtures/*.test.mjs
```
