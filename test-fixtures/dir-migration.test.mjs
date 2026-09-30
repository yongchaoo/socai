// dir-migration.test.mjs — Batch 01: plans/ → .socai/ + 两层 plan 结构
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function grepPlansSlugRefs() {
  const r = spawnSync(
    'grep',
    ['-rn', 'plans/<slug>\\|plans/${', '.claude/skills/socai', 'socai-call.mjs', 'docs'],
    { cwd: root, encoding: 'utf8' },
  );
  return (r.stdout || '').trim();
}

test('dir migration: no plans/<slug> references in socai skill/docs/call', () => {
  const hits = grepPlansSlugRefs();
  assert.equal(hits, '', `expected 0 hits, got:\n${hits}`);
});

test('dir migration: .gitignore contains .socai/', () => {
  const gitignore = readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.socai/m);
});

test('dir migration: SKILL step 0.4 has two-layer plan structure', () => {
  const skill = readFileSync(path.join(root, '.claude/skills/socai/SKILL.md'), 'utf8');
  assert.match(skill, /NN-<topic>\.spec\.md/);
  assert.match(skill, /executor 只读本批/);
});
