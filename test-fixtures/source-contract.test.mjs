// check-source-contract.test.mjs — B02: SoCai source contract gate
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SCRIPT = path.join(root, '.claude/skills/socai/_runtime/check-source-contract.sh');
const FIX = path.join(here, 'source-contract');

function run(fixture) {
  const spec = path.join(FIX, fixture, 'spec.md');
  const target = path.join(FIX, fixture);
  return spawnSync('bash', [SCRIPT, spec, target], {
    encoding: 'utf8',
    timeout: 30_000,
  });
}

test('source-contract: mismatch tauri-command names → non-zero + prints tokens', () => {
  const r = run('mismatch');
  assert.notEqual(r.status, 0, `expected fail\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(`${r.stdout}${r.stderr}`, /save_file|save_document|js:|rust:/i);
});

test('source-contract: matching names + same-literal → 0', () => {
  const r = run('match');
  assert.equal(r.status, 0, `expected 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
});

test('source-contract: same-literal missing needle on one side → non-zero', () => {
  const r = run('missing-literal');
  assert.notEqual(r.status, 0, `expected fail\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
});

test('source-contract: no contract: → 0 (skip)', () => {
  const r = run('no-contract');
  assert.equal(r.status, 0, `expected skip 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
});

test('source-contract: risk high + tags tauri without contract/none → non-zero', () => {
  const r = run('high-risk-no-contract');
  assert.notEqual(r.status, 0, `expected fail\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
});
