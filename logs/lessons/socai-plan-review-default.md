---
paradigm_class: socai-orchestration
trigger_keywords: [plan-review, plan, blocker, CONCERNS, 计划审核, 写码前, trivial]
---
症状：plan-review 仅 1/13 run 执行过，但唯一一次（close-askuserquestion）就在写码前抓出 2 个 blocker，避免了一批返工。
根因：plan-review 在 SKILL 里是「出方案」可选层，无机械触发条件；attended 下靠人想起，auto 下无默认。
修复：非 trivial 目标（>1 批或任一子 plan risk: high）默认跑 plan-review 再进 executor；trivial 豁免；auto 模式不等确认直接跑，结果记 run jsonl。
防回归断言：非 trivial run 的 jsonl 应含 review phase=plan-review 事件；evolve-report 统计 plan-review 覆盖率（非 trivial run 中执行比例），低于 100% 报出。
