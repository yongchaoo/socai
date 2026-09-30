// portable-paths.test.mjs — 别人机器能跑：禁止个人路径，必须有 SOCAI_HOME / 三 host
import assert from 'node:assert/strict';
import { readFileSync, chmodSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const SKILL = readFileSync(path.join(root, '.claude/skills/socai/SKILL.md'), 'utf8');
const RUNLOG = readFileSync(path.join(root, '.claude/skills/socai/_runtime/run-log.sh'), 'utf8');
const BUGMEM = readFileSync(path.join(root, '.claude/skills/socai/_runtime/bug-memory.sh'), 'utf8');
const INSTALL = readFileSync(path.join(root, 'install.sh'), 'utf8');
const README = readFileSync(path.join(root, 'README.md'), 'utf8');

function bannedPersonalPaths(text, label) {
  const hits = [];
  if (text.includes('/Volumes/dufa-mac')) hits.push('/Volumes/dufa-mac');
  if (text.includes('$HOME/www/life') || text.includes('$HOME/www/SoCai')) hits.push('$HOME/www/…');
  if (text.includes('www/SoCai/logs')) hits.push('www/SoCai/logs');
  assert.equal(hits.join(','), '', `${label} 仍含个人路径: ${hits.join(', ')}`);
}

test('portable: 脚本/skill/readme 不含个人路径', () => {
  bannedPersonalPaths(SKILL, 'SKILL.md');
  bannedPersonalPaths(RUNLOG, 'run-log.sh');
  bannedPersonalPaths(BUGMEM, 'bug-memory.sh');
  bannedPersonalPaths(INSTALL, 'install.sh');
  bannedPersonalPaths(README, 'README.md');
});

test('portable: run-log 默认 $SOCAI_HOME/logs', () => {
  assert.match(RUNLOG, /SOCAI_HOME:-\$HOME\/\.local\/share\/socai/);
  assert.match(RUNLOG, /SOCAI_LOG_ROOT:-\$SOCAI_HOME\/logs/);
});

test('portable: bug-memory 候选不含 www\/life 与 dufa-mac', () => {
  assert.equal(BUGMEM.includes('$HOME/www/life'), false);
  assert.equal(BUGMEM.includes('/Volumes/dufa-mac'), false);
  assert.match(BUGMEM, /cwd\/\.\.\/life|pwd\)\/\.\.\/life/);
});

test('portable: install.sh 支持 --host 三端 + copy fallback', () => {
  assert.match(INSTALL, /--host=cursor\|trae\|workbuddy\|all/);
  assert.match(INSTALL, /HOME\/\.agents\/skills/);
  assert.match(INSTALL, /HOME\/\.trae\/skills/);
  assert.match(INSTALL, /HOME\/\.workbuddy\/skills/);
  assert.match(INSTALL, /allowed-tools/);
  assert.match(INSTALL, /cp -R/);
});

test('portable: README 写限制（新会话 / theater / host 矩阵）', () => {
  assert.match(README, /新会话/);
  assert.match(README, /THEATER_RISK|换不了/);
  assert.match(README, /WorkBuddy/);
  assert.match(README, /Trae/);
});

test('portable: install.sh --host=cursor 在隔离 HOME 可装可验', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'socai-install-'));
  mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    SOCAI_HOME: path.join(home, '.local/share/socai'),
    PATH: `${path.join(home, '.local/bin')}:${process.env.PATH}`,
  };
  chmodSync(path.join(root, 'install.sh'), 0o755);
  execFileSync('sh', [path.join(root, 'install.sh'), '--host=cursor'], {
    encoding: 'utf8',
    env,
    cwd: root,
  });
  assert.ok(existsSync(path.join(home, '.agents/skills/socai/SKILL.md')));
  assert.ok(existsSync(path.join(home, '.local/share/socai/runtime/bug-memory.sh')));
  assert.ok(existsSync(path.join(home, '.local/bin/socai-call')));
  const verify = execFileSync('sh', [path.join(root, 'install.sh'), '--verify'], {
    encoding: 'utf8',
    env,
    cwd: root,
  });
  assert.match(verify, /cursor skill socai/);
  writeFileSync(path.join(home, 'ok'), '1');
});
