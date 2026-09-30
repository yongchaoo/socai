# Batch 05 — 产物验收：量安装物，不量 staging

risk: low
tags: socai,orchestration,tauri

## Spec（行为契约）

- 输入：子 plan 可选字段 `acceptance.artifact`（独占行，便于编排者 grep）。
- 输出：有该字段时， socai **收尾**（或该批 gate 后）必须跑测量命令；只跑 `--check` / `du staging` 不算完成。

### 字段格式

```
acceptance.artifact: kind=app-size max=250M measure=du-app
```

`kind` 初版只要求实现：

| kind | 测量 | 通过 |
|------|------|------|
| `app-size` | mount 最新 `*.dmg` 或读未清理的 `*.app`，`du -sm` | ≤ `max`（单位 M） |
| `cmd` | 子 plan `## 验收点` 里已有的命令 | exit 0（本 kind 可不新写脚本） |

编排者用 Bash 跑，不 Read 产物内容。建议脚本：

`.claude/skills/socai/_runtime/check-artifact.sh <spec.md>`

- 无 `acceptance.artifact` → exit 0（跳过）
- `kind=app-size` 找不到 `.app`/`.dmg` → 非 0（fail-loud，禁止用 staging 数字顶替）
- stdout 一行：`ARTIFACT path=... size_mb=... max=...`

### SKILL 收尾

全批 done 后：若任一批 spec 含 `acceptance.artifact`，编排者必须跑 `check-artifact.sh`（对每份声明了字段的子 plan，或对最后一份打包批）。失败 → 停，fixer 或喊人。`--check` 只能当快检。

B01 已改 auto 停点；本批把「产物验收失败」接到具体命令。

### desktop-slim 对照

staging 232M、门禁 250M 绿；mount `Lexi.app` = 257M（211+26 壳之后才 237M）。测量点必须是 `.app`，resources 门禁只是预算。

## Invariants

- 声明了 `app-size` 则收尾必须量安装 `.app`，不得用 staging/`--check` 代替。

## Test（先行）

- `test-fixtures/check-artifact.test.mjs`
  - 无字段 spec → 脚本 exit 0
  - `kind=app-size` + fixture 目录里放一个假 `Lexi.app`（可用空目录 + 若干文件凑 `du`）超过 max → 非 0
  - 同 fixture 低于 max → 0
  - 声明 app-size 但目录无 app/dmg → 非 0
- SKILL.md 含 `check-artifact.sh` / `acceptance.artifact` 锚点（可放本测试或 B01 测试文件增一条）

先行：脚本不存在时测试红，再实现。

## 验收点

- `node --test test-fixtures/check-artifact.test.mjs` 绿
- `bash .claude/skills/socai/_runtime/check-artifact.sh plans/capability-hardening/05-artifact-acceptance.spec.md`：本 spec **不要**给自己加 `acceptance.artifact`（避免自指找 .app）。另用 fixture spec 测。

## Spec 同步

- 更新：`specs/socai/orchestration.spec.md`（收尾产物测量 GWT）
- 更新：`specs/socai/gates.spec.md`（`check-artifact.sh` 行为）

## 涉及文件白名单

- `.claude/skills/socai/_runtime/check-artifact.sh`
- `.claude/skills/socai/SKILL.md`
- `.claude/skills/lt-plan/SKILL.md`（子 plan 模板加 `acceptance.artifact` 可选字段）
- `test-fixtures/check-artifact.test.mjs`
- `test-fixtures/artifact-app-size/`（假 .app fixture）
- `specs/socai/orchestration.spec.md`
- `specs/socai/gates.spec.md`
- `test-fixtures/protocol-baseline.test.mjs`（B01 有「SKILL 不得含 acceptance.artifact」硬负断言，本批落地字段时必须改掉该行，否则回归红）

## 回滚影响

- 回滚本批：系统仍可运行 ✅

## 不做什么

- 不把体积门禁写进目标仓 `build-desktop.sh`（那是产品仓的事）
- 不在 SoCai CI 真打 tauri
- 不做 Windows/nsis 测量

## 否决方案

- 只在 reviewer 清单加「请确认量的是 .app」：否决，B08 review 已漏壳。
- 把 max 写死 250：否决，字段在子 plan。
