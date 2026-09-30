// check-artifact.test.mjs — capability-hardening B05: acceptance.artifact 收尾测量
// 量安装产物（.app/.dmg），不量 staging；找不到产物 fail-loud。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SCRIPT = path.join(root, '.claude/skills/socai/_runtime/check-artifact.sh');
const SKILL = readFileSync(path.join(root, '.claude/skills/socai/SKILL.md'), 'utf8');

const APP_FIXTURE = 'test-fixtures/artifact-app-size'; // 内含假 Lexi.app（约 2MB）
const EMPTY_FIXTURE = 'test-fixtures/artifact-app-size/empty'; // 无 .app/.dmg

function run(specPath) {
  try {
    const stdout = execFileSync('bash', [SCRIPT, specPath], { cwd: root, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function withSpec(lines, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-artifact-'));
  const spec = path.join(dir, 'spec.md');
  writeFileSync(spec, lines.join('\n') + '\n');
  try {
    return fn(run(spec));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('无 acceptance.artifact 字段 → exit 0（跳过）', () => {
  withSpec(['# spec', '', '## 验收点', '- `true` 绿'], ({ code }) => {
    assert.equal(code, 0);
  });
});

test('字段只出现在 ``` 围栏示例里 → 不算声明，exit 0（防 spec 自指）', () => {
  withSpec(
    ['# spec', '', '### 字段格式', '', '```', 'acceptance.artifact: kind=app-size max=250M measure=du-app', '```', ''],
    ({ code }) => {
      assert.equal(code, 0, '围栏内示例不得触发测量');
    },
  );
});

test('kind=app-size 超过 max → 非 0，且 stdout 仍打 ARTIFACT 行', () => {
  withSpec([`acceptance.artifact: kind=app-size max=1M measure=du-app path=${APP_FIXTURE}`], ({ code, stdout }) => {
    assert.notEqual(code, 0, '超过 max 必须非 0');
    assert.match(stdout, /ARTIFACT path=\S*\.app size_mb=\d+ max=1/, `缺 ARTIFACT 行: ${stdout}`);
  });
});

test('kind=app-size 低于 max → exit 0，ARTIFACT 行 size_mb ≤ max', () => {
  withSpec([`acceptance.artifact: kind=app-size max=5000M measure=du-app path=${APP_FIXTURE}`], ({ code, stdout, stderr }) => {
    assert.equal(code, 0, `expect exit 0, got ${code}: ${stdout}${stderr}`);
    const m = stdout.match(/ARTIFACT path=(\S+) size_mb=(\d+) max=(\d+)/);
    assert.ok(m, `缺 ARTIFACT 行: ${stdout}`);
    assert.ok(Number(m[2]) <= Number(m[3]), `size_mb=${m[2]} 应 ≤ max=${m[3]}`);
  });
});

test('声明 app-size 但目录无 .app/.dmg → 非 0（fail-loud，禁止 staging 顶替）', () => {
  withSpec([`acceptance.artifact: kind=app-size max=250M measure=du-app path=${EMPTY_FIXTURE}`], ({ code }) => {
    assert.notEqual(code, 0, '找不到产物必须 fail-loud');
  });
});

test('SKILL.md 收尾含 acceptance.artifact / check-artifact.sh 锚点', () => {
  assert.match(SKILL, /acceptance\.artifact/, 'SKILL 缺 acceptance.artifact 字段协议');
  assert.match(SKILL, /check-artifact\.sh/, 'SKILL 收尾缺 check-artifact.sh 锚点');
});
