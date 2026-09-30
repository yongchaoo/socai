---
paradigm_class: socai-orchestration
trigger_keywords: [check-test-gate, spec.md, Permission denied, test command, FAIL_TO_PASS]
---
症状：编排者跑 `check-test-gate.sh <子plan.spec.md>` → Permission denied / 先行 test 未全绿。
根因：`check-test-gate.sh` 的 argv1 是可 eval 的测试命令（如 `pnpm --filter @lexi/agent test stream-response`），不是 spec 路径；把 spec 当命令执行会失败。
修复：从子 plan「验收点」抽出真实命令传给 test-gate；或包装器读 spec 的 Test/验收点再 exec。禁止把 .md 路径当 cmd。
防回归断言：`check-test-gate.sh .socai/x/01.spec.md` 不得被 skill 写成推荐用法；SKILL 示例必须含引号包裹的 pnpm/node 测试命令。
