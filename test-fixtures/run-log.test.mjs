import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '../.claude/skills/socai/_runtime/run-log.sh');

function run(args, env) {
  return execFileSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('run-log: start writes jsonl + current pointer; event/snapshot/finish append', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'socai-run-log-'));
  const env = { SOCAI_LOG_ROOT: root };
  const id = run(
    [
      'start',
      '--slug',
      'demo-slug',
      '--mode',
      'auto',
      '--executor',
      'cursor-host',
      '--goal',
      'delete opencode',
    ],
    env
  ).trim();
  assert.match(id, /T\d{6}Z-demo-slug$/);
  assert.equal(readFileSync(path.join(root, 'current', 'demo-slug'), 'utf8').trim(), id);

  const lines1 = readFileSync(path.join(root, 'runs', `${id}.jsonl`), 'utf8')
    .trim()
    .split('\n');
  assert.equal(lines1.length, 1);
  const start = JSON.parse(lines1[0]);
  assert.equal(start.type, 'run_start');
  assert.equal(start.slug, 'demo-slug');
  assert.equal(start.mode, 'auto');
  assert.equal(start.executor, 'cursor-host');

  run(
    ['event', '--slug', 'demo-slug', '--type', 'gate', '--batch', '1', '--json', '{"exit":0,"gate":"hack-count"}'],
    env
  );

  const from = path.join(root, 'fake-socai');
  mkdirSync(from);
  writeFileSync(path.join(from, '00-master.md'), '# master\n');
  writeFileSync(path.join(from, '01-foo.spec.md'), '# spec\n');
  writeFileSync(path.join(from, 'batch-1.prompt.md'), '# prompt\n');
  run(['snapshot-plans', '--slug', 'demo-slug', '--from', from], env);
  assert.ok(existsSync(path.join(root, 'snapshots', id, 'plans', '00-master.md')));
  assert.ok(existsSync(path.join(root, 'snapshots', id, 'plans', 'batch-1.prompt.md')));

  run(['event', '--run-id', id, '--type', 'note', '--key', 'gate=hack-count'], env);

  run(['finish', '--run-id', id, '--status', 'done'], env);
  assert.equal(existsSync(path.join(root, 'current', 'demo-slug')), false);
  const lines = readFileSync(path.join(root, 'runs', `${id}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(lines.at(-1).type, 'run_finish');
  assert.equal(lines.at(-1).status, 'done');
  assert.equal(lines.some((e) => e.type === 'gate' && e.batch === '1'), true);
  assert.equal(lines.some((e) => e.type === 'plan_snapshot' && e.files === 3), true);
  assert.equal(lines.some((e) => e.type === 'note' && e.gate === 'hack-count'), true);
});
