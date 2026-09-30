// fail-to-pass-rust/verify.mjs — Batch 03: Rust FAIL_TO_PASS（orphan 模块新测必须被观察到没过）+ 禁止 cd 进 crate
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const GATE_SCRIPT = path.join(root, '.claude/skills/lt-execute/references/gates/check-test-gate.sh');
const TEMPLATE = path.join(here, 'crate');

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
assert.equal(cargo.status, 0, '本批要求本机有 cargo/rustc（方案 A 禁止 skip 当通过）');

function setupRustRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'f2p-rust-'));
  const cfg = ['-c', 'user.email=t@t', '-c', 'user.name=t'];
  const crate = path.join(dir, 'desktop');
  mkdirSync(path.join(crate, 'src'), { recursive: true });
  writeFileSync(path.join(dir, '.gitignore'), 'desktop/target/\ndesktop/Cargo.lock\n');
  copyFileSync(path.join(TEMPLATE, 'Cargo.toml'), path.join(crate, 'Cargo.toml'));
  copyFileSync(path.join(TEMPLATE, 'src/main.rs.base'), path.join(crate, 'src/main.rs'));

  git(dir, ['init', '-q']);
  git(dir, [...cfg, 'add', '.']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'base: crate without power module']);
  const base = git(dir, ['rev-parse', 'HEAD']).stdout.trim();

  copyFileSync(path.join(TEMPLATE, 'src/main.rs.head'), path.join(crate, 'src/main.rs'));
  copyFileSync(path.join(TEMPLATE, 'src/power.rs'), path.join(crate, 'src/power.rs'));
  git(dir, [...cfg, 'add', '.']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'feat: power module with tests']);
  return { dir, base };
}

function runGate(dir, cmd, base) {
  return spawnSync('bash', [GATE_SCRIPT, cmd], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, LT_DIFF_BASE: base },
  });
}

// 1. `cd <dir> && cargo test` 必须被拒（非 0 + 提示 --manifest-path）
{
  const { dir, base } = setupRustRepo();
  try {
    const r = runGate(dir, 'cd desktop && cargo test', base);
    assert.notEqual(r.status, 0, `cd 进 crate 必须非 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout + r.stderr, /--manifest-path/, '拒绝时须提示 --manifest-path');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 2. orphan 模块：revert 后旧测仍绿，但新测必须被观察到没过（不得报假先行/WEAK_VERIFY）
{
  const { dir, base } = setupRustRepo();
  try {
    const r = runGate(dir, 'cargo test --manifest-path desktop/Cargo.toml', base);
    assert.equal(r.status, 0, `orphan 新测被观察到没过时 gate 须通过\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /FAIL_TO_PASS/);
    assert.match(r.stdout, /观察到没过/);
    assert.doesNotMatch(r.stdout, /WEAK_VERIFY|假先行/, 'orphan 消失不得误报假先行');
    const dirty = git(dir, ['status', '--porcelain']).stdout.trim();
    assert.equal(dirty, '', 'gate 通过后工作区必须干净（impl 已恢复）');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('fail-to-pass-rust.verify: ok');
