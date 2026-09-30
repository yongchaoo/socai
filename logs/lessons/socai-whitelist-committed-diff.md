---
paradigm_class: socai-orchestration
trigger_keywords: [check-file-whitelist, LT_DIFF_BASE, 无改动, vendored, target-repo, gates]
---
症状：socai 已 commit 后跑目标仓 `.claude/skills/lt-execute/.../check-file-whitelist.sh`，输出「通过（无改动）」，$batch_base..HEAD 实际有几十个文件。
根因：假绿来自**目标仓 vendored 旧 gate**（只看暂存/工作区，忽略 LT_DIFF_BASE）。SoCai 全局 `~/.claude/skills/lt-execute` 副本已支持 range。编排者 skill 写「先查项目本地 gates」会选中旧脚本。
修复：仓内 whitelist/spec-sync 对齐 SoCai：设了 LT_DIFF_BASE 则 `git diff $LT_DIFF_BASE..HEAD`；未设且工作区空则 warn「socai 必须 export LT_DIFF_BASE」。编排者优先全局 SoCai gates，或先对齐仓内副本。禁止记成「SoCai whitelist 不会看 range」。
防回归断言：Lexi `check-file-whitelist.sh` 含 `LT_DIFF_BASE` 与 `..HEAD`；clean tree + `LT_DIFF_BASE=$parent` 能列出已提交文件，不得报「无改动」通过（除非 range 真空）。
