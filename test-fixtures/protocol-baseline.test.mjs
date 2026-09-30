// protocol-baseline.test.mjs — capability-hardening B01: 开工协议锚点（baseline / merge target / auto 停点 / batch_base 收口）
// 协议批：对 SKILL.md 与 specs/socai/orchestration.spec.md 做字符串锚点校验，机械验条文，不验模型是否遵守。
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SKILL_PATH = path.join(root, '.claude/skills/socai/SKILL.md');
const ORCH_SPEC_PATH = path.join(root, 'specs/socai/orchestration.spec.md');

const SKILL = readFileSync(SKILL_PATH, 'utf8');

test('SKILL: 开工 baseline 三选一锚点齐全', () => {
  assert.match(SKILL, /baseline=clean-cut/, '缺 baseline=clean-cut');
  assert.match(SKILL, /baseline=wip-anchor-then-branch/, '缺 baseline=wip-anchor-then-branch');
  assert.match(SKILL, /baseline=reuse-head/, '缺 baseline=reuse-head');
});

test('SKILL: 脏工作区未指定 baseline → 不进 executor 先问', () => {
  assert.match(SKILL, /git status --porcelain/, '缺脏树探测命令锚点');
  assert.match(SKILL, /不进 executor，先问/, '缺「脏树先问」条文');
  assert.match(SKILL, /禁止默默 `git add -A`/, '缺禁止默默 add -A 条文');
});

test('SKILL: merge target 三选一锚点齐全 + 禁止默认 squash main', () => {
  assert.match(SKILL, /merge=main/, '缺 merge=main');
  assert.match(SKILL, /merge=integration:/, '缺 merge=integration:<branch>');
  assert.match(SKILL, /merge=keep-branch/, '缺 merge=keep-branch');
  assert.match(SKILL, /禁止默认 squash/, '缺「禁止默认 squash」条文');
});

test('SKILL: auto 停点 = BLOCKER / 产物验收失败 / fixer 满 3 / infra_fails≥2', () => {
  assert.match(SKILL, /BLOCKER/, 'auto 停点缺 BLOCKER');
  assert.match(SKILL, /产物验收失败/, 'auto 停点缺产物验收失败');
  assert.match(SKILL, /fixer 满 3/, 'auto 停点缺 fixer 满 3');
  assert.match(SKILL, /infra_fails≥2/, 'auto 停点缺 infra_fails≥2');
  assert.match(SKILL, /不停：仅因/, '缺「不停：仅因 high-risk」反向条文');
});

test('SKILL: 旧句「高风险才 pause」已废止（无有效条文命中）', () => {
  assert.ok(!SKILL.includes('高风险才 pause'), 'SKILL 仍含旧句「高风险才 pause」');
});

test('SKILL: auto 无人值守——禁问条文 + 默认推荐路线锚点齐全', () => {
  assert.match(SKILL, /auto = 无人值守/, '缺 auto 无人值守定义');
  assert.match(SKILL, /禁止任何形式提问\/等确认/, '缺 auto 禁问条文');
  assert.match(SKILL, /auto 默认推荐路线/, '缺 auto 默认路线锚点');
  assert.match(SKILL, /AUTO_ASSUMED=1/, '缺 AUTO_ASSUMED=1 假设记账锚点');
  // 三处历史「先问」条文须有 auto 豁免或默认路线覆盖
  assert.match(SKILL, /auto 不问，走默认 `wip-anchor-then-branch`/, 'baseline 歧义缺 auto 默认路线');
  assert.match(SKILL, /auto 模式跳过人工确认，直接收口/, '收尾缺 auto 跳过人工确认条文');
});

test('SKILL: batch_base 治理收口条文（功能收口后清 base，治理 commit 不用旧 base）', () => {
  assert.match(SKILL, /治理 commit/, '缺治理 commit 条文');
  assert.match(SKILL, /batch_base=/, '缺 batch_base= 收口锚点');
});

test('SKILL: acceptance.artifact 已落地（B05）——字段存在且收尾指向 check-artifact.sh', () => {
  assert.match(SKILL, /见 B05/, '缺「见 B05」指针');
  assert.match(SKILL, /acceptance\.artifact/, 'B05 落地后 SKILL 须含 acceptance.artifact 字段协议');
  assert.match(SKILL, /check-artifact\.sh/, 'SKILL 收尾须指向 check-artifact.sh');
});

test('SKILL: 执行日志 run-log.sh + SoCai/logs 锚点', () => {
  assert.match(SKILL, /run-log\.sh/, '缺 run-log.sh');
  assert.match(SKILL, /www\/SoCai\/logs/, '缺 ~/www/SoCai/logs 落点');
  assert.match(SKILL, /snapshot-plans/, '缺 snapshot-plans');
  assert.match(SKILL, /测试命令/, '缺 test-gate 是命令不是 spec 的条文');
  assert.match(SKILL, /BUGMEM=/, '缺 BUGMEM= 赋值，禁止只写空 $BUGMEM');
  assert.match(SKILL, /HOME\/\.claude\/skills\/socai\/_runtime\/bug-memory\.sh/, '缺全局 bug-memory 回退路径');
  assert.match(SKILL, /RUNLOG=/, '缺 RUNLOG= 赋值');
  assert.match(SKILL, /\*\.prompt\.md/, 'snapshot 须含 prompt');
});

test('specs/socai/orchestration.spec.md 存在且含 baseline/merge/auto GWT 锚点', () => {
  assert.ok(existsSync(ORCH_SPEC_PATH), '缺 specs/socai/orchestration.spec.md');
  const spec = readFileSync(ORCH_SPEC_PATH, 'utf8');
  assert.match(spec, /baseline=clean-cut/);
  assert.match(spec, /merge=keep-branch/);
  assert.match(spec, /BLOCKER/);
  assert.match(spec, /GWT/, 'orchestration.spec.md 须为 GWT 形式');
  assert.match(spec, /auto 无人值守/, 'orchestration.spec.md 缺 auto 无人值守 GWT');
  assert.match(spec, /wip-anchor-then-branch/, 'spec 缺 baseline auto 默认路线');
  assert.match(spec, /AUTO_ASSUMED=1/, 'spec 缺 AUTO_ASSUMED=1 锚点');
  assert.match(spec, /run-log\.sh/, 'orchestration.spec.md 缺 run-log.sh GWT');
  assert.match(spec, /LT_DIFF_BASE\.\.HEAD/, 'orchestration.spec.md 缺 committed-diff GWT');
  assert.match(spec, /假绿/, 'orchestration.spec.md 缺目标仓旧 gate 假绿条文');
});
