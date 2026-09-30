// fail-to-pass-gate.test.mjs — Batch 02: spawn 独立 verify 脚本（避免 node:test 递归跳过子 node --test）
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERIFY_SCRIPT = path.join(here, 'fail-to-pass-gate.verify.mjs');
const INTERRUPT_VERIFY = path.join(here, 'fail-to-pass-interrupt.verify.mjs');

function runVerifyScript(script, timeoutMs = 120_000) {
  const envArgs = [
    '-i',
    `PATH=${process.env.PATH}`,
    `HOME=${process.env.HOME || ''}`,
    `TMPDIR=${process.env.TMPDIR || '/tmp'}`,
  ];
  return spawnSync('env', [
    ...envArgs,
    'python3',
    '-c',
    'import subprocess,sys; sys.exit(subprocess.call(["node", sys.argv[1]]))',
    script,
  ], { encoding: 'utf8', timeout: timeoutMs });
}

test('FAIL_TO_PASS gate: fake-green 拦 / real-red-green 过（via verify 子进程）', () => {
  const r = runVerifyScript(VERIFY_SCRIPT);
  assert.equal(r.status, 0, `verify failed\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /fail-to-pass-gate\.verify: ok/);
});

test('FAIL_TO_PASS gate: eval 中断后 impl 须恢复', () => {
  const r = runVerifyScript(INTERRUPT_VERIFY, 60_000);
  assert.equal(r.status, 0, `verify failed\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /fail-to-pass-interrupt\.verify: ok/);
});
