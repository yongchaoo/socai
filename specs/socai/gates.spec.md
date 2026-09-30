# socai gates — 门禁行为契约

> 机械校验：`node --test test-fixtures/file-whitelist-exempt.test.mjs`（白名单豁免）。
> 后批只追加新节，不得重写已钉 GWT。

## 文件白名单自动豁免（check-file-whitelist.sh）

```GWT
Given 子 plan「涉及文件白名单」含 path/foo.ts（或 .js/.mjs/.rs 等源文件）
When diff 新增 path/foo.test.ts / foo.spec.ts / foo.test.mjs 等同茎测试
Then gate 不判越权（exit 0）
And 非同茎测试（如 path/other.test.ts）仍判越权（exit 1）
```

```GWT
Given 白名单命中 dir/Cargo.toml（或其目录前缀）
When diff 新增同目录 dir/Cargo.lock
Then gate 不判越权（exit 0）
And 白名单命中 dir/package.json 时，dir/pnpm-lock.yaml / dir/package-lock.json 同理豁免
```

```GWT
Given 任意子 plan 白名单
When diff 新增 plans/** 或 .socai/** 下文件（编排者治理文档）
Then gate 不判越权（exit 0）
```

```GWT
Given 子 plan 白名单仅含 src/foo.ts
When diff 新增白名单外业务源码 src/bar.ts
Then gate 判越权（exit 1）并在输出中点名该文件
```

## FAIL_TO_PASS：Rust orphan 模块与禁止 cd 进 crate（check-test-gate.sh）

```GWT
Given 验收 cmd 匹配 cd <dir> && cargo test
When check-test-gate.sh 校验
Then 非 0 退出，并提示改用 cargo test --manifest-path <crate>/Cargo.toml
```

```GWT
Given 验收 cmd 含 cargo test 且 diff 含 *.rs 实现文件
When revert 实现后原 cmd exit 0 且仅 HEAD 有的测试名消失（orphan 模块）
Then gate 不得报「假先行 / WEAK_VERIFY」，也不得 orphan-skip 当通过
And 对每条仅 HEAD 有的测试名跑 cargo test <name> -- --exact 要求非 0
And 匹配 0 条且 exit 0 时恢复 mod 接线（新 .rs 仍删）要求 compile-fail
And 仅当每条新测都被观察到没过才判 FAIL_TO_PASS 通过（exit 0）
```

```GWT
Given JS/TS 批次（diff 不含 *.rs）的假先行 fixture
When revert 实现后 test 仍绿
Then gate 仍判 FAIL_TO_PASS / WEAK_VERIFY（exit 1），行为不随 Rust 分支改变
```

## spec-sync 显式豁免字段（check-spec-sync.sh）

```GWT
Given 子 plan「## Spec 同步」段仅写「N/A——基础设施」等旧关键词、无独占行字段
When check-spec-sync.sh 校验
Then gate 拒（exit 1），旧关键词仅作迁移 warn，不得单独让 gate 绿
```

```GWT
Given 段内独占一行 `spec-sync: exempt=infra`（token ∈ infra|docs|lockfile|style|tooling|ci）且无 specs/ 路径
When check-spec-sync.sh 校验
Then 视为合法 N/A（exit 0），仍跑强豁免/behavior_paths 逻辑
And token 不在白名单（如 exempt=bogus）→ 拒（exit 1）
And 字段混在正文里（非独占行）→ 拒（exit 1）
```

## is-high-risk 词边界（is-high-risk.sh）

```GWT
Given diff 仅新增 `status=PASSED` / `assertPassed` / `passed:`（含子串 sse）
When is-high-risk.sh 校验
Then exit 1（非高风险），纯单词关键词按词边界匹配
```

```GWT
Given diff 含真 SSE（EventSource / text/event-stream / 独立词 sse）
When is-high-risk.sh 校验
Then exit 0（高风险）
And 含符号的模式（tauri::）保持子串匹配，不加词边界
```

## check-artifact.sh（acceptance.artifact app-size 收尾测量，B05）

> 机械校验：`node --test test-fixtures/check-artifact.test.mjs`。

```GWT
Given spec 无 acceptance.artifact 独占行
When check-artifact.sh <spec> 运行
Then exit 0（跳过）
```

```GWT
Given acceptance.artifact: kind=app-size max=<N>M path=<dir>，dir 下有 .app（或 .dmg 可 mount）
When check-artifact.sh 运行
Then du -sm 量安装 .app；≤ max → exit 0 且 stdout 一行 ARTIFACT path=... size_mb=... max=...
And > max → 非 0（ARTIFACT 行仍打 stdout，失败原因走 stderr）
```

```GWT
Given 声明 kind=app-size 但 path 目录无 .app 且无 .dmg
When check-artifact.sh 运行
Then 非 0（fail-loud），禁止用 staging / --check 数字顶替
```
