// file-whitelist-exempt.test.mjs — Batch 02: 白名单自动豁免（同茎测试 / lockfile / plans / .socai）
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const GATE = path.join(root, '.claude/skills/lt-execute/references/gates/check-file-whitelist.sh');

const cfg = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function runGate(dir, specPath) {
  return spawnSync('bash', [GATE, specPath], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, LT_DIFF_BASE: 'HEAD~1' },
    timeout: 60_000,
  });
}

// 建 fixture：base commit 后，再 commit 一批改动（spec 放 plans/ 下，模拟真实子 plan）
function setupFixture(whitelistEntry, changedFiles) {
  const dir = mkdtempSync(path.join(tmpdir(), 'whitelist-exempt-'));
  git(dir, ['init', '-q']);
  writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(dir, [...cfg, 'add', '-A']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'base']);

  const specRel = 'plans/cap/02.spec.md';
  mkdirSync(path.join(dir, path.dirname(specRel)), { recursive: true });
  writeFileSync(path.join(dir, specRel), `## 涉及文件白名单\n- ${whitelistEntry}\n`);
  for (const [file, content] of Object.entries(changedFiles)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  git(dir, [...cfg, 'add', '-A']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'batch change']);
  return dir;
}

function withFixture(whitelistEntry, changedFiles, fn) {
  const dir = setupFixture(whitelistEntry, changedFiles);
  try {
    fn(dir, path.join(dir, 'plans/cap/02.spec.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('whitelist-exempt: 同茎测试豁免（foo.test.ts / foo.spec.ts / foo.test.mjs）', () => {
  withFixture('src/foo.ts', {
    'src/foo.ts': 'export const foo = 1;\n',
    'src/foo.test.ts': 'assert(foo);\n',
    'src/foo.spec.ts': 'assert(foo);\n',
    'src/foo.test.mjs': 'assert(foo);\n',
  }, (dir, spec) => {
    const r = runGate(dir, spec);
    assert.equal(r.status, 0, `same-stem tests must be exempt\n${r.stdout}\n${r.stderr}`);
  });
});

test('whitelist-exempt: Cargo.toml 命中 → 同目录 Cargo.lock 豁免', () => {
  withFixture('desktop/Cargo.toml', {
    'desktop/Cargo.toml': '[package]\nname = "x"\n',
    'desktop/Cargo.lock': '# lock\n',
  }, (dir, spec) => {
    const r = runGate(dir, spec);
    assert.equal(r.status, 0, `Cargo.lock must be exempt\n${r.stdout}\n${r.stderr}`);
  });
});

test('whitelist-exempt: package.json 命中 → pnpm-lock.yaml / package-lock.json 豁免', () => {
  withFixture('app/package.json', {
    'app/package.json': '{"name":"x"}\n',
    'app/pnpm-lock.yaml': 'lockfileVersion: 9\n',
    'app/package-lock.json': '{}\n',
  }, (dir, spec) => {
    const r = runGate(dir, spec);
    assert.equal(r.status, 0, `js lockfiles must be exempt\n${r.stdout}\n${r.stderr}`);
  });
});

test('whitelist-exempt: plans/** 与 .socai/** 豁免', () => {
  withFixture('src/foo.ts', {
    'src/foo.ts': 'export const foo = 1;\n',
    'plans/x/01.spec.md': '# plan\n',
    '.socai/s/progress.md': '# progress\n',
  }, (dir, spec) => {
    const r = runGate(dir, spec);
    assert.equal(r.status, 0, `plans/ and .socai/ must be exempt\n${r.stdout}\n${r.stderr}`);
  });
});

test('whitelist-exempt: 白名单外业务源码仍拒（src/bar.ts 红）', () => {
  withFixture('src/foo.ts', {
    'src/foo.ts': 'export const foo = 1;\n',
    'src/bar.ts': 'export const bar = 2;\n',
  }, (dir, spec) => {
    const r = runGate(dir, spec);
    assert.equal(r.status, 1, `out-of-whitelist source must fail\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout + r.stderr, /src\/bar\.ts/);
  });
});

test('whitelist-exempt: 非同茎测试不豁免（src/other.test.ts 红）', () => {
  withFixture('src/foo.ts', {
    'src/foo.ts': 'export const foo = 1;\n',
    'src/other.test.ts': 'assert(other);\n',
  }, (dir, spec) => {
    const r = runGate(dir, spec);
    assert.equal(r.status, 1, `non-same-stem test must fail\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout + r.stderr, /src\/other\.test\.ts/);
  });
});
