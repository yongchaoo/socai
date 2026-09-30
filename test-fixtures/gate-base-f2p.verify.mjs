// gate-base-f2p.verify.mjs — post-commit FAIL_TO_PASS with LT_DIFF_BASE=HEAD~1
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const GATE_SCRIPT = path.join(root, '.claude/skills/lt-execute/references/gates/check-test-gate.sh');
const fixtureDir = path.join(here, 'real-red-green');

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

const dir = mkdtempSync(path.join(tmpdir(), 'gate-base-f2p-'));
const cfg = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

try {
  git(dir, ['init', '-q']);
  copyFileSync(path.join(fixtureDir, 'feature.test.mjs'), path.join(dir, 'feature.test.mjs'));
  git(dir, [...cfg, 'add', 'feature.test.mjs']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'base: test only']);

  copyFileSync(path.join(fixtureDir, 'impl.mjs'), path.join(dir, 'impl.mjs'));
  git(dir, [...cfg, 'add', 'impl.mjs']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'batch: impl']);

  const r = spawnSync('bash', [GATE_SCRIPT, 'node --test feature.test.mjs'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, LT_DIFF_BASE: 'HEAD~1' },
    timeout: 60_000,
  });

  assert.equal(r.status, 0, `expected pass\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /FAIL_TO_PASS/);
  console.log('gate-base-f2p.verify: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
