// bug-memory.test.mjs — Batch 06: 路径解析（MA_LIFE_DIR fail-fast）/ doctor /
// FTS fallback（无 tsx / CLI fetch failed 仍命中）/ ingest 去重 / wrote→stderr。
// 所有用例自带临时 life mock，不依赖本机真实 life 仓（hermetic）。
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const BUG_MEMORY = path.join(root, '.claude/skills/socai/_runtime/bug-memory.sh');
const MOCK_LIFE = path.join(here, 'mock-life-kb');

function runBugMemory(args, { cwd, lifeDir }) {
  const env = { ...process.env };
  if (lifeDir !== undefined) env.MA_LIFE_DIR = lifeDir;
  return spawnSync('bash', [BUG_MEMORY, ...args], { cwd, encoding: 'utf8', env });
}

function runRecall({ cwd, slug, query, lifeDir }) {
  return runBugMemory(['recall', slug, ...query.split(/\s+/)], { cwd, lifeDir });
}

function readBugMemory(cwd, slug) {
  return readFileSync(path.join(cwd, '.socai', slug, 'bug-memory.md'), 'utf8');
}

// 可运行 CLI 的 mock life：search.ts 作解析锚点，search.mjs 作执行体（免 tsx）。
function makeCliLife(dir) {
  mkdirSync(path.join(dir, 'src/cli'), { recursive: true });
  writeFileSync(path.join(dir, '.env'), '# mock\n');
  writeFileSync(
    path.join(dir, 'src/cli/search.ts'),
    '// resolve anchor for resolve_life_dir; executed via sibling search.mjs\n',
  );
  copyFileSync(path.join(MOCK_LIFE, 'src/cli/search.mjs'), path.join(dir, 'src/cli/search.mjs'));
  return dir;
}

const INIT_DB_PY = `
import json, sqlite3, sys
db_path, rows_path = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db_path)
conn.execute("""CREATE TABLE knowledge (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, content TEXT NOT NULL,
  category TEXT, source TEXT, is_evergreen INTEGER DEFAULT 0,
  content_hash TEXT, contributed_by TEXT, project_id TEXT,
  created_at TEXT, updated_at TEXT, UNIQUE(owner, content_hash)
)""")
conn.execute("CREATE VIRTUAL TABLE knowledge_fts USING fts5(id UNINDEXED, content)")
for row in json.load(open(rows_path)):
    conn.execute(
      "INSERT INTO knowledge (id, owner, content, category, source, is_evergreen,"
      " content_hash, contributed_by, project_id, created_at, updated_at)"
      " VALUES (?, 'shared', ?, ?, 'test', 0, ?, 'test', NULL,"
      " '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
      (row["id"], row["content"], row.get("category", "procedure"), row["id"]),
    )
    conn.execute("INSERT INTO knowledge_fts (id, content) VALUES (?, ?)",
                 (row["id"], row["content"]))
conn.commit()
`;

// 只有 data/life.db 可用的 mock life（无 node_modules、无 .mjs）→ 强制 FTS fallback。
function makeFtsLife(dir, rows) {
  mkdirSync(path.join(dir, 'src/cli'), { recursive: true });
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  writeFileSync(path.join(dir, '.env'), '# mock\n');
  writeFileSync(
    path.join(dir, 'src/cli/search.ts'),
    '// resolve anchor; node deps intentionally absent so CLI cannot run\n',
  );
  const rowsPath = path.join(dir, 'rows.json');
  writeFileSync(rowsPath, JSON.stringify(rows));
  const r = spawnSync(
    'python3',
    ['-c', INIT_DB_PY, path.join(dir, 'data', 'life.db'), rowsPath],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, `init fake life.db failed: ${r.stderr}`);
  return dir;
}

test('bug-memory: 显式 MA_LIFE_DIR 无效 → ⚠️ 降级 + 具体路径，不静默 fall-through 到别的库', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-degrade-'));
  try {
    const slug = 'degrade-test';
    const bogus = path.join(dir, 'no-such-life-kb');
    const r = runRecall({ cwd: dir, slug, query: 'coffee quiz 选择', lifeDir: bogus });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const md = readBugMemory(dir, slug);
    assert.match(md, /⚠️.*降级/);
    assert.match(md, /本任务无历史教训兜底/);
    assert.match(md, /no-such-life-kb/, '降级原因必须含具体路径，不能只写「不可用」');
    assert.match(md, /跳过范式保底检索/);
    assert.doesNotMatch(md, /^## 范式保底检索/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bug-memory: frontmatter sse-lifecycle + trigger_keywords → paradigm recall hits', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-sse-'));
  try {
    const life = makeCliLife(path.join(dir, 'life'));
    const slug = 'sse-test';
    const r = runRecall({ cwd: dir, slug, query: '前端 流式 推送 中文 query', lifeDir: life });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const md = readBugMemory(dir, slug);
    assert.match(md, /sse-lifecycle|eventsource|SSE 连接/, 'paradigm fallback should surface sse-lifecycle entry');
    assert.match(md, /范式保底检索/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bug-memory: legacy entry without frontmatter → control-paradigm fallback still works', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-legacy-'));
  const lifeOnlyLegacy = path.join(dir, 'life-legacy-only');
  try {
    mkdirSync(path.join(lifeOnlyLegacy, 'src/cli'), { recursive: true });
    writeFileSync(path.join(lifeOnlyLegacy, '.env'), '# mock\n');
    const mockCli = `const hit = { id:'c1', content:'选择控件 radio 即时反馈', category:'procedure', score:0.9, source:'fts' };
async function run(argv=process.argv.slice(2)) {
  const pos = argv.filter(a => !a.startsWith('--'));
  const q = pos.join(' ').toLowerCase();
  const fmt = argv.find(a=>a.startsWith('--format='))?.slice(9) ?? 'json';
  const hits = (q.includes('choice')||q.includes('select')||q.includes('radio')||q.includes('control-paradigm')) ? [hit] : [];
  const body = hits.length ? hits.map(h=>'- ['+h.score+' '+h.source+'] '+h.content).join('\\n') : '(no hits)';
  process.stdout.write(fmt==='text' ? body+'\\n' : JSON.stringify(hits)+'\\n');
}
if (import.meta.url === 'file://'+process.argv[1]) run();
`;
    // search.ts = 解析锚点；search.mjs = 同内容执行体（免 tsx，run_life_cli 优先 .mjs）
    writeFileSync(path.join(lifeOnlyLegacy, 'src/cli/search.ts'), mockCli);
    writeFileSync(path.join(lifeOnlyLegacy, 'src/cli/search.mjs'), mockCli);

    const slug = 'legacy-test';
    const r = runRecall({ cwd: dir, slug, query: 'quiz 选择 控件', lifeDir: lifeOnlyLegacy });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const md = readBugMemory(dir, slug);
    assert.match(md, /control-paradigm|选择控件|radio/);
    assert.match(md, /范式保底检索/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bug-memory: 假 sqlite 库（无 tsx）→ recall 走 FTS fallback 命中，无 ⚠️ 降级', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-fts-'));
  try {
    const life = makeFtsLife(path.join(dir, 'life'), [
      {
        id: 'k1',
        content: 'stdout redirect 污染：wrote 状态行必须打 stderr，禁止写进 bug-memory.md',
      },
    ]);
    const slug = 'fts-test';
    const r = runRecall({ cwd: dir, slug, query: 'stdout redirect', lifeDir: life });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const md = readBugMemory(dir, slug);
    assert.doesNotMatch(md, /⚠️/, 'FTS 命中时不得写降级标（向量侧失败 ≠ 没有记忆）');
    assert.match(md, /wrote 状态行必须打 stderr/);
    assert.match(md, /via fts-fallback/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bug-memory: node CLI 被 stub 成 fetch failed → 仍走 FTS 命中', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-clifail-'));
  try {
    const life = makeFtsLife(path.join(dir, 'life'), [
      { id: 'k1', content: 'gate 假绿 greenwash：收尾必须量安装产物，禁止用 staging 数字' },
    ]);
    // 模拟 life search.ts 被 Ollama embedding fetch 整段打死
    writeFileSync(
      path.join(life, 'src/cli/search.mjs'),
      'process.stderr.write("Error: fetch failed (embedding ollama)\\n"); process.exit(1);\n',
    );
    const slug = 'clifail-test';
    const r = runRecall({ cwd: dir, slug, query: 'greenwash 假绿', lifeDir: life });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const md = readBugMemory(dir, slug);
    assert.doesNotMatch(md, /⚠️/);
    assert.match(md, /greenwash/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bug-memory: ingest 文件后能搜回；content_hash 去重第二次 inserted=false', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-ingest-'));
  try {
    const life = makeFtsLife(path.join(dir, 'life'), []);
    const bugFile = path.join(dir, 'bug.md');
    writeFileSync(bugFile, '症状：gate 假绿 greenwash；根因：量错测量点；修复：量安装产物 du-app。\n');

    const r1 = runBugMemory(['ingest', bugFile], { cwd: dir, lifeDir: life });
    assert.equal(r1.status, 0, `stderr: ${r1.stderr}`);
    assert.match(r1.stdout, /"inserted":\s*true/, `stdout: ${r1.stdout}`);

    const r2 = runBugMemory(['ingest', bugFile], { cwd: dir, lifeDir: life });
    assert.equal(r2.status, 0, `stderr: ${r2.stderr}`);
    assert.match(r2.stdout, /"inserted":\s*false/, `第二次应去重: ${r2.stdout}`);

    const slug = 'ingest-test';
    const r3 = runRecall({ cwd: dir, slug, query: 'greenwash', lifeDir: life });
    assert.equal(r3.status, 0, `stderr: ${r3.stderr}`);
    const md = readBugMemory(dir, slug);
    assert.doesNotMatch(md, /⚠️/);
    assert.match(md, /greenwash/, 'ingest 后 recall 应能搜回');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bug-memory: recall 的 wrote 打 stderr，stdout 不混状态行（禁止 > 重定向污染）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-stderr-'));
  try {
    const life = makeFtsLife(path.join(dir, 'life'), [
      { id: 'k1', content: 'stderr stdout 分离：wrote 是状态行不是记忆内容' },
    ]);
    const slug = 'stderr-test';
    const r = runRecall({ cwd: dir, slug, query: 'stderr stdout', lifeDir: life });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /wrote/, `stdout 不得含 wrote 状态行: ${r.stdout}`);
    assert.match(r.stderr, /bug-memory: wrote .*bug-memory\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bug-memory: doctor 有 search.ts + db（无 tsx）→ exit 0 且不报「未找到」', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-doctor-'));
  try {
    const life = makeFtsLife(path.join(dir, 'life'), [
      { id: 'k1', content: 'procedure 条目 dummy entry for doctor probe' },
    ]);
    const r = runBugMemory(['doctor'], { cwd: dir, lifeDir: life });
    assert.equal(r.status, 0, `doctor 应可用: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /LIFE_AVAILABLE=true/);
    assert.match(r.stdout, /LIFE_VIA=fts-fallback/);
    assert.match(r.stdout, /probe=ok/);
    assert.doesNotMatch(r.stdout, /未找到/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bug-memory: SKILL step 0.3 mentions ⚠️ 降级 → progress.md 复述', () => {
  const skill = readFileSync(path.join(root, '.claude/skills/socai/SKILL.md'), 'utf8');
  assert.match(skill, /⚠️.*降级.*progress\.md/);
});
