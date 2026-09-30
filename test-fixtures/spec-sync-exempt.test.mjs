// spec-sync-exempt.test.mjs — Batch 04: N/A 豁免只认独占行 `spec-sync: exempt=<token>`
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SPEC_SYNC = path.join(root, '.claude/skills/lt-execute/references/gates/check-spec-sync.sh');

const TOKENS = 'infra|docs|lockfile|style|tooling|ci';

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

/** Temp git repo: base commit, then staged batch.spec.md carrying the given Spec 同步 section. */
function setupRepoWithSection(sectionBody) {
  const dir = mkdtempSync(path.join(tmpdir(), 'spec-sync-exempt-'));
  const cfg = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

  git(dir, ['init', '-q']);
  writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(dir, [...cfg, 'add', '-A']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'base']);

  writeFileSync(path.join(dir, 'batch.spec.md'), `## Spec 同步\n${sectionBody}`);
  git(dir, [...cfg, 'add', '-A']);
  return dir;
}

function runGate(dir) {
  return spawnSync('bash', [SPEC_SYNC, 'batch.spec.md'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 30_000,
  });
}

test('spec-sync: 仅正文「N/A 基础设施」无 exempt 字段 → 拒（旧关键词不再让 gate 绿）', () => {
  const dir = setupRepoWithSection('N/A——纯基础设施改动，无用户可见行为\n');
  try {
    const r = runGate(dir);
    assert.notEqual(r.status, 0, `expected reject\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout + r.stderr, /spec-sync: exempt=/, 'rejection must point at the exempt field');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spec-sync: 独占行 spec-sync: exempt=infra（无 N/A 字样）→ 视为合法 N/A，绿', () => {
  const dir = setupRepoWithSection('spec-sync: exempt=infra\n');
  try {
    const r = runGate(dir);
    assert.equal(r.status, 0, `expected pass\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /spec-sync gate 通过/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spec-sync: 带列表符的独占行 - spec-sync: exempt=docs → 绿', () => {
  const dir = setupRepoWithSection('- spec-sync: exempt=docs\n');
  try {
    const r = runGate(dir);
    assert.equal(r.status, 0, `expected pass\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spec-sync: token 不在白名单（exempt=bogus）→ 拒', () => {
  const dir = setupRepoWithSection('N/A\nspec-sync: exempt=bogus\n');
  try {
    const r = runGate(dir);
    assert.notEqual(r.status, 0, `expected reject\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout + r.stderr, new RegExp(TOKENS), 'must list legal tokens');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spec-sync: 字段非独占行（混在正文里）→ 拒', () => {
  const dir = setupRepoWithSection('N/A spec-sync: exempt=infra 基础设施\n');
  try {
    const r = runGate(dir);
    assert.notEqual(r.status, 0, `expected reject\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spec-sync: 声明 specs/ 路径且在 diff 内 → 仍绿（路径流程不回归）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'spec-sync-exempt-path-'));
  const cfg = ['-c', 'user.email=t@t', '-c', 'user.name=t'];
  try {
    git(dir, ['init', '-q']);
    writeFileSync(path.join(dir, 'README.md'), 'base\n');
    git(dir, [...cfg, 'add', '-A']);
    git(dir, [...cfg, 'commit', '-q', '-m', 'base']);

    writeFileSync(path.join(dir, 'batch.spec.md'), '## Spec 同步\n- 更新 `specs/foo.spec.md`\n');
    mkdirSync(path.join(dir, 'specs'), { recursive: true });
    writeFileSync(path.join(dir, 'specs/foo.spec.md'), '# foo\n');
    git(dir, [...cfg, 'add', '-A']);

    const r = runGate(dir);
    assert.equal(r.status, 0, `expected pass\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
