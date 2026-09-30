---
paradigm_class: socai-orchestration
trigger_keywords: [bug-memory, recall, path, fallback, vendor, LIFE_DIR, doctor]
---
症状：socai 开工跑 `bash .claude/skills/socai/_runtime/bug-memory.sh recall` 在目标仓（如 Lexi）No such file；progress 标 bug-memory 降级，life-kb 实际可用。
根因：SKILL 写死目标仓相对路径；SoCai 脚本只装在 ~/.claude/skills/socai/_runtime（或 SoCai 仓），目标仓通常不 vendor 该脚本。
修复：先试仓内路径，不存在则用 $HOME/.claude/skills/socai/_runtime/bug-memory.sh；开工先 doctor，仅 doctor 非 0 才写降级。
防回归断言：目标仓无 .claude/skills/socai/_runtime/bug-memory.sh 时 recall 仍 exit 0 且 bug-memory.md 无「脚本不存在」降级（life doctor 绿则有命中或「无命中」而非 path missing）。
