# socai 执行日志（自进化语料）

落点：`$SOCAI_LOG_ROOT`（默认 `$HOME/.local/share/socai/logs`；`SOCAI_HOME` 覆盖家目录）。

| 目录 | 内容 | git |
|------|------|-----|
| `runs/*.jsonl` | 每次 `/socai` 一行一事：开工、计划快照、batch、gate、review、模型、收尾 | ignore |
| `snapshots/<run_id>/plans/` | 该次写出的 goal / 00-master / NN-*.spec.md | ignore |
| `current/<slug>` | 进行中的 run_id 指针 | ignore |
| `lessons/*.md` | 已 ingest 到 life-kb 的流程四元组（可入库） | 跟踪 |

写入：`bash $SOCAI_HOME/runtime/run-log.sh start|event|snapshot-plans|finish`

分析：`jq -s . logs/runs/<run_id>.jsonl`，或按 `type`/`exit`/`executor` 聚合假绿、infra hang、模型组合。
