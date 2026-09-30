// gate-base.test.mjs — Batch 07: LT_DIFF_BASE env for post-commit gate diff
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const GATES_DIR = path.join(root, '.claude/skills/lt-execute/references/gates');
const SPEC_SYNC = path.join(GATES_DIR, 'check-spec-sync.sh');

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function runGate(script, cwd, args, env = {}) {
  return spawnSync('bash', [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
}

function setupSpecSyncFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gate-base-spec-sync-'));
  const cfg = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

  git(dir, ['init', '-q']);
  writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(dir, [...cfg, 'add', '-A']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'base']);

  mkdirSync(path.join(dir, 'specs'), { recursive: true });
  writeFileSync(path.join(dir, 'specs/foo.spec.md'), '# foo\n');
  writeFileSync(
    path.join(dir, 'batch.spec.md'),
    '## Spec 同步\n- 更新 `specs/foo.spec.md`\n',
  );
  git(dir, [...cfg, 'add', '-A']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'batch: sync spec']);

  return dir;
}

test('gate LT_DIFF_BASE: invalid base → fail-loud (BOGUS_REF)', () => {
  const dir = setupSpecSyncFixture();
  try {
    const bogus = runGate(SPEC_SYNC, dir, ['batch.spec.md'], { LT_DIFF_BASE: 'BOGUS_REF' });
    assert.notEqual(bogus.status, 0, 'expected fail with invalid LT_DIFF_BASE');
    assert.match(bogus.stdout + bogus.stderr, /LT_DIFF_BASE 无效/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate LT_DIFF_BASE: post-commit spec-sync fails without base, passes with HEAD~1', () => {
  const dir = setupSpecSyncFixture();
  try {
    const noBase = runGate(SPEC_SYNC, dir, ['batch.spec.md']);
    assert.notEqual(noBase.status, 0, 'expected fail without LT_DIFF_BASE on clean worktree');
    assert.match(noBase.stdout + noBase.stderr, /diff 里没有|spec-sync gate 失败/);

    const withBase = runGate(SPEC_SYNC, dir, ['batch.spec.md'], { LT_DIFF_BASE: 'HEAD~1' });
    assert.equal(withBase.status, 0, `expected pass with LT_DIFF_BASE\n${withBase.stdout}\n${withBase.stderr}`);
    assert.match(withBase.stdout, /spec-sync gate 通过/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate LT_DIFF_BASE: post-commit FAIL_TO_PASS runs with HEAD~1 (not skipped)', () => {
  const VERIFY = path.join(here, 'gate-base-f2p.verify.mjs');
  const r = spawnSync('env', [
    '-i',
    `PATH=${process.env.PATH}`,
    `HOME=${process.env.HOME || ''}`,
    `TMPDIR=${process.env.TMPDIR || '/tmp'}`,
    'python3',
    '-c',
    'import subprocess,sys; sys.exit(subprocess.call(["node", sys.argv[1]]))',
    VERIFY,
  ], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, `verify failed\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /gate-base-f2p\.verify: ok/);
});

test('gate scripts reference LT_DIFF_BASE env', () => {
  for (const name of ['check-spec-sync.sh', 'check-test-gate.sh', 'check-file-whitelist.sh', 'check-contract-change.sh']) {
    const content = readFileSync(path.join(GATES_DIR, name), 'utf8');
    assert.match(content, /LT_DIFF_BASE/, `${name} must support LT_DIFF_BASE`);
  }
});
