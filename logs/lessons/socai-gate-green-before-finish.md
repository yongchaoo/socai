---
paradigm_class: socai-orchestration
trigger_keywords: [gate, fail, APPROVE, run_finish, 假绿, 收尾, done, greenwash]
---
症状：093013 的 gate 三次报 fail=1（含 fixer 后一次），run 却 status=done + review APPROVE 收尾——红 gate 与绿收尾并存。
根因：待核（两种可能：fail 字段被当警告跳过 / 编排者绕过 gate 直接收尾）。无论哪种，收尾前缺「最后 gate 必须全绿」的机械核验。
修复：run_finish --status done 前，编排者必须确认本 run 最后一个 gate 事件全绿（fail=0 或 result=pass/green）；有未豁免的红 → 禁止 done，回 fixer 或按 blocked 收尾。
防回归断言：evolve-report 校验——status=done 的 run 末尾不得存在未翻绿的 gate fail 事件；命中即报 greenwash 嫌疑（093013 为首个样本）。
