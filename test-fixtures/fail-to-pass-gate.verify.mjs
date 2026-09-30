// fail-to-pass-gate.verify.mjs — Batch 02: gate fixture 校验（plain script，避免 node:test 递归跳过）
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const GATES_DIR = path.join(root, '.claude/skills/lt-execute/references/gates');
const GATE_SCRIPT = path.join(GATES_DIR, 'check-test-gate.sh');

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function runTestGate(cwd, testCmd) {
  return spawnSync('bash', [GATE_SCRIPT, testCmd], { cwd, encoding: 'utf8', timeout: 60_000 });
}

function setupFixtureRepo(fixtureName, { commitImpl = true, testOnlyBatch = false } = {}) {
  const fixtureDir = path.join(here, fixtureName);
  const dir = mkdtempSync(path.join(tmpdir(), `f2p-${fixtureName}-`));
  const cfg = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

  git(dir, ['init', '-q']);
  const baseTest = existsSync(path.join(fixtureDir, 'base.feature.test.mjs'))
    ? 'base.feature.test.mjs'
    : 'feature.test.mjs';
  copyFileSync(path.join(fixtureDir, baseTest), path.join(dir, 'feature.test.mjs'));
  git(dir, [...cfg, 'add', 'feature.test.mjs']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'base: test only']);

  if (commitImpl && existsSync(path.join(fixtureDir, 'impl.mjs'))) {
    copyFileSync(path.join(fixtureDir, 'impl.mjs'), path.join(dir, 'impl.mjs'));
    git(dir, [...cfg, 'add', 'impl.mjs']);
  } else if (testOnlyBatch || !commitImpl) {
    copyFileSync(path.join(fixtureDir, 'feature.test.mjs'), path.join(dir, 'feature.test.mjs'));
    git(dir, [...cfg, 'add', 'feature.test.mjs']);
  }

  return dir;
}

function assertGateFixture(fixtureName, expectExit, pattern, opts = {}) {
  const dir = setupFixtureRepo(fixtureName, opts);
  try {
    const r = runTestGate(dir, 'node --test feature.test.mjs');
    assert.equal(r.status, expectExit, `${fixtureName}: expected exit ${expectExit}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    if (pattern) {
      assert.match(r.stdout + r.stderr, pattern);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

assert.ok(existsSync(GATE_SCRIPT), 'check-test-gate.sh must exist');
const gateContent = readFileSync(GATE_SCRIPT, 'utf8');
assert.match(gateContent, /FAIL_TO_PASS/);
assert.match(gateContent, /WEAK_VERIFY/);

assertGateFixture('fake-green', 1, /WEAK_VERIFY|假先行/);
assertGateFixture('real-red-green', 0, /FAIL_TO_PASS 已验/);
assertGateFixture('impl-inline-test', 1, /无可 revert 实现文件|无法验证 FAIL_TO_PASS/, { commitImpl: false });
assertGateFixture('test-only-batch', 1, /无可 revert 实现文件|无法验证 FAIL_TO_PASS/, { testOnlyBatch: true });

console.log('fail-to-pass-gate.verify: ok');
