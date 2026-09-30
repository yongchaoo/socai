// is-high-risk.test.mjs — Batch 03: mechanical high-risk diff detection
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const IS_HIGH_RISK = path.join(root, '.claude/skills/socai/_runtime/is-high-risk.sh');

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function runIsHighRisk(cwd, base, head) {
  return spawnSync('bash', [IS_HIGH_RISK, base, head], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

/** Copy staged fixture tree into temp git repo: 01-base commit then 02-head commit. */
function makeFixtureRepo(fixtureName) {
  const fixtureRoot = path.join(here, fixtureName);
  const dir = mkdtempSync(path.join(tmpdir(), `is-high-risk-${fixtureName.replaceAll('/', '-')}-`));
  const cfg = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

  git(dir, ['init', '-q']);
  cpSync(path.join(fixtureRoot, '01-base'), dir, { recursive: true });
  git(dir, [...cfg, 'add', '-A']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'base']);

  const headDir = path.join(fixtureRoot, '02-head');
  for (const rel of ['README.md', 'src/stream.ts']) {
    const src = path.join(headDir, rel);
    if (existsSync(src)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      cpSync(src, path.join(dir, rel));
    }
  }
  // low-risk: only README copied above; high-risk: stream.ts too
  if (!existsSync(path.join(headDir, 'src/stream.ts'))) {
    writeFileSync(path.join(dir, 'README.md'), readFileSync(path.join(headDir, 'README.md'), 'utf8'));
  }

  git(dir, [...cfg, 'add', '-A']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'change']);
  return dir;
}

test('is-high-risk.sh: high-risk fixture (EventSource) → exit 0 + prints match', () => {
  const dir = makeFixtureRepo('high-risk-diff');
  try {
    const r = runIsHighRisk(dir, 'HEAD~1', 'HEAD');
    assert.equal(r.status, 0, `expected exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /EventSource|eventsource|stream|auth|token|session/i, 'should print matching diff line');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('is-high-risk.sh: low-risk fixture (README only) → exit non-zero', () => {
  const dir = makeFixtureRepo('low-risk-diff');
  try {
    const r = runIsHighRisk(dir, 'HEAD~1', 'HEAD');
    assert.notEqual(r.status, 0, `expected non-zero exit\nstdout:\n${r.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('is-high-risk.sh: PASSED false-positive fixture (substring sse) → exit 1', () => {
  const dir = makeFixtureRepo('is-high-risk/passed-false-positive');
  try {
    const r = runIsHighRisk(dir, 'HEAD~1', 'HEAD');
    assert.notEqual(r.status, 0, `PASSED/assertPassed/passed: must not hit keyword sse\nstdout:\n${r.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('is-high-risk.sh: standalone word sse still high-risk → exit 0', () => {
  const dir = makeFixtureRepo('is-high-risk/sse-standalone');
  try {
    const r = runIsHighRisk(dir, 'HEAD~1', 'HEAD');
    assert.equal(r.status, 0, `standalone sse word must stay high-risk\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('is-high-risk.sh: empty diff (same ref) → exit 1 + stderr message', () => {
  const dir = makeFixtureRepo('low-risk-diff');
  try {
    const r = runIsHighRisk(dir, 'HEAD', 'HEAD');
    assert.equal(r.status, 1, `expected exit 1\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stderr, /empty diff/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('is-high-risk.sh: regex metachar in keyword → literal match only', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'is-hr-regex-'));
  const cfg = ['-c', 'user.email=t@t', '-c', 'user.name=t'];
  const keywordsPath = path.join(dir, '.claude/skills/socai/_runtime/high-risk-keywords.txt');
  try {
    git(dir, ['init', '-q']);
    mkdirSync(path.dirname(keywordsPath), { recursive: true });
    // '+' as keyword must not match arbitrary lines via ERE '+'
    writeFileSync(keywordsPath, 'foo+bar\n');
    writeFileSync(path.join(dir, 'README.md'), 'base\n');
    git(dir, [...cfg, 'add', '-A']);
    git(dir, [...cfg, 'commit', '-q', '-m', 'base']);
    writeFileSync(path.join(dir, 'README.md'), 'prefix fooXbar suffix\n');
    git(dir, [...cfg, 'add', '-A']);
    git(dir, [...cfg, 'commit', '-q', '-m', 'change without literal foo+bar']);

    const r = runIsHighRisk(dir, 'HEAD~1', 'HEAD');
    assert.notEqual(r.status, 0, 'foo+bar keyword must not false-positive on fooXbar');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
