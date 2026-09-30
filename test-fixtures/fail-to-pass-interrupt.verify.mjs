// fail-to-pass-interrupt.verify.mjs — eval 中断后 impl 须恢复
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
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

const dir = mkdtempSync(path.join(tmpdir(), 'f2p-interrupt-'));
const cfg = ['-c', 'user.email=t@t', '-c', 'user.name=t'];
const marker = path.join(dir, '.f2p-invoke-count');

try {
  git(dir, ['init', '-q']);
  copyFileSync(path.join(fixtureDir, 'feature.test.mjs'), path.join(dir, 'feature.test.mjs'));
  git(dir, [...cfg, 'add', 'feature.test.mjs']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'base: test only']);

  copyFileSync(path.join(fixtureDir, 'impl.mjs'), path.join(dir, 'impl.mjs'));
  git(dir, [...cfg, 'add', 'impl.mjs']);

  const wrapper = path.join(dir, 'test-wrapper.sh');
  writeFileSync(wrapper, `#!/usr/bin/env bash
set -euo pipefail
MARKER=${JSON.stringify(marker)}
if [[ -f "$MARKER" ]]; then
  sleep 60
else
  touch "$MARKER"
  exec node --test feature.test.mjs
fi
`);
  chmodSync(wrapper, 0o755);

  const implBefore = readFileSync(path.join(dir, 'impl.mjs'), 'utf8');
  assert.match(implBefore, /return a \+ b/, 'impl must have full implementation before gate');

  const child = spawn('bash', [GATE_SCRIPT, './test-wrapper.sh'], {
    cwd: dir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.unref();

  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stdout += d; });

  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const poll = setInterval(() => {
      if (stdout.includes('FAIL_TO_PASS：无实现版本跑 test')) {
        clearInterval(poll);
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
        setTimeout(resolve, 300);
      } else if (Date.now() > deadline) {
        clearInterval(poll);
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        reject(new Error(`timeout waiting for FAIL_TO_PASS eval\nstdout:\n${stdout}`));
      } else if (child.exitCode !== null) {
        clearInterval(poll);
        resolve();
      }
    }, 50);
    child.on('error', reject);
  });

  const implAfter = readFileSync(path.join(dir, 'impl.mjs'), 'utf8');
  assert.equal(implAfter, implBefore, 'impl must be restored after eval interrupt');
  console.log('fail-to-pass-interrupt.verify: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
