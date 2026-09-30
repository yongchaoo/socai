// fail-to-pass-rust.test.mjs — Batch 03: spawn 独立 verify 脚本（同 gate 测试的递归规避模式）
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERIFY_SCRIPT = path.join(here, 'fail-to-pass-rust', 'verify.mjs');

test('FAIL_TO_PASS gate: rust orphan 新测被观察到没过 + 禁止 cd 进 crate', () => {
  const r = spawnSync('env', [
    '-i',
    `PATH=${process.env.PATH}`,
    `HOME=${process.env.HOME || ''}`,
    `TMPDIR=${process.env.TMPDIR || '/tmp'}`,
    'python3',
    '-c',
    'import subprocess,sys; sys.exit(subprocess.call(["node", sys.argv[1]]))',
    VERIFY_SCRIPT,
  ], { encoding: 'utf8', timeout: 300_000 });
  assert.equal(r.status, 0, `verify failed\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /fail-to-pass-rust\.verify: ok/);
});
