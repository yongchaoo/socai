// socai.test.mjs — socai-backends + socai-call 单测（v1 CLI / v2 /ma 已删除）。
// 跑法：node --test socai.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import './test-fixtures/bug-memory.test.mjs';
import './test-fixtures/dir-migration.test.mjs';
import './test-fixtures/fail-to-pass-gate.test.mjs';
import './test-fixtures/gate-base.test.mjs';
import './test-fixtures/is-high-risk.test.mjs';
import './test-fixtures/source-contract.test.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_AGENT = path.join(here, 'test-fixtures', 'fake-agent.sh');
const SOCAI_CALL_SCRIPT = path.join(here, 'socai-call.mjs');

function fakeBinEnv(extra = {}) {
  return {
    MA_AGENT_BIN_CLAUDE: FAKE_AGENT,
    MA_AGENT_BIN_KIMI: FAKE_AGENT,
    MA_AGENT_BIN_CODEX: FAKE_AGENT,
    MA_AGENT_BIN_CURSOR: FAKE_AGENT,
    MA_TRIAGE_BACKEND: 'claude',
    MA_PLANNER_BACKEND: 'claude',
    MA_EXECUTOR_BACKEND: 'claude',
    MA_REVIEWER_BACKEND: 'claude',
    ...extra,
  };
}

const backends = await import('./socai-backends.mjs');
const maCall = await import('./socai-call.mjs');

function makeFakeSparring(code, stdout = '') {
  const dir = mkdtempSync(path.join(tmpdir(), 'ma-spar-'));
  const fake = path.join(dir, 'sparring.sh');
  writeFileSync(fake, `#!/bin/sh\nprintf '%s' ${JSON.stringify(stdout)}\nexit ${code}\n`);
  chmodSync(fake, 0o755);
  return fake;
}


function runMaCall({ configHome, cwd, args, env = {} }) {
  return spawnSync(process.execPath, [SOCAI_CALL_SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, MA_CONFIG_HOME: configHome, MA_AGENT_BIN_KIMI: FAKE_AGENT, MA_AGENT_BIN_CLAUDE: FAKE_AGENT, ...env },
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}


function makePlanReviewFixtures({ reviewer = { backend: 'kimi', model: 'k3' }, executor } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'socai-call-'));
  const cfgHome = path.join(dir, 'cfg'); // MA_CONFIG_HOME 直接指向含 config.json 的目录（resolveGlobalConfigPath = $MA_CONFIG_HOME/config.json）
  mkdirSync(cfgHome, { recursive: true });
  const roles = { reviewer };
  if (executor) roles.executor = executor;
  writeFileSync(path.join(cfgHome, 'config.json'), JSON.stringify({ roles }));
  writeFileSync(path.join(dir, 'master.md'), '# 总纲\n## 目标\nfake 目标\n## 批次清单\n| Batch 1 | x | root-cause | data | 无 | ✅ | 小 |\n');
  writeFileSync(path.join(dir, '01.spec.md'), '# Batch 1\n## Spec\n- 输入：x\n');
  return { cfgHome, dir };
}


function makeDiffRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ma-diff-'));
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  const cfg = ['-c', 'user.email=t@t', '-c', 'user.name=t'];
  git(['init', '-q']);
  writeFileSync(path.join(dir, 'a.txt'), 'baseline\n');
  git([...cfg, 'add', '-A']); git([...cfg, 'commit', '-q', '-m', 'base']);
  writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  writeFileSync(path.join(dir, 'b.txt'), 'new\n');
  git([...cfg, 'add', '-A']); git([...cfg, 'commit', '-q', '-m', 'change']);
  return dir;
}


function makeExecFixtures({ executor = { backend: 'claude-deepseek' } } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ma-exec-'));
  const cfgHome = path.join(dir, 'cfg');
  mkdirSync(cfgHome, { recursive: true });
  writeFileSync(path.join(cfgHome, 'config.json'), JSON.stringify({ roles: { executor } }));
  writeFileSync(path.join(dir, 'batch.prompt.md'),
    '你是 socai-executor\n\n实现 batch X：add pow(a,b)。test-first，commit 到分支，回 ≤6 行摘要。');
  return { cfgHome, dir };
}


test('parseUsage：codex tokens used（真实格式，stderr 走向已实证）', () => {
  // kimi usage 断言已移除：kimi CLI 不暴露 usage（见 Batch 6 fix Bug1 判决 + parseBackendUsage 专用 test）。
  const codexOut = "codex\nok\ntokens used\n19,694\n";
  assert.equal(backends.parseCodexUsage(codexOut), 19694);
});
test('Bug1 kimi usage 不支持：parseBackendUsage 对虚构 usage 行与真实样本均返 null（删假解析器）', () => {
  // 实证：kimi -p --output-format stream-json 输出仅 {"role":"assistant"} + {"role":"meta","type":"session.resume_hint"}，
  // 无任何 usage 字段。故不解析——删除了虚构的 parseKimiStreamJsonUsage（它解析的 {"role":"usage"} 格式 kimi 根本不产）。
  assert.equal(backends.parseBackendUsage('kimi', '{"role":"usage","total_tokens":180}'), null);
  const realKimi = '{"role":"assistant","content":"ok"}\n{"role":"meta","type":"session.resume_hint","session_id":"s1"}';
  assert.equal(backends.parseBackendUsage('kimi', realKimi), null);
});
test('Bug2 cursor/kimi probe 超时回归默认 30s（实证：当前版本 ~3s 退出，240s 为过时防御）', () => {
  // 实证：cursor-agent -p -f --trust --output-format stream-json --model composer-2.5-fast 当前版本 ~3.2s exit 0，
  // result 事件含真实 usage（inputTokens/outputTokens）。spec 旧注释「打印 result 后驻留 ~80s」已不复现。
  assert.equal(backends.BACKENDS.cursor.probeTimeoutMs, undefined);
  assert.equal(backends.BACKENDS.kimi.probeTimeoutMs, undefined);
});
test('Bug3 autonomyArgs 与实际 args 对齐：kimi -p headless 已自治，无额外 flag', () => {
  // 实证：`kimi -p ... --yolo` 报 "Cannot combine --prompt with --yolo"；-p 单独已非交互自治（probe exit 0 未卡权限）。
  // 故 autonomyArgs 为空，与 args() 一致（其余 backend 的 autonomyArgs 已与 args 对齐：codex/cursor/claude*）。
  assert.deepEqual(backends.buildBackendAutonomyArgs('kimi'), []);
  const kimiArgs = backends.buildBackendArgs('kimi', 'p', {});
  assert.ok(!kimiArgs.includes('--yolo'), 'kimi args 不应含 --yolo（与 -p 互斥）');
  assert.ok(!kimiArgs.includes('--auto'));
});
test('dsh backend：headless argv + OpenAI key 注入 + 关内部 subagent patch', () => {
  const p = 'hello';
  const args = backends.buildBackendArgs('dsh', p, {});
  assert.equal(args[0], '--profile');
  assert.equal(args[1], 'headless');
  assert.ok(args.includes('--patch'), '默认打上 disable-subagent patch');
  assert.equal(args[args.length - 2], '--');
  assert.equal(args[args.length - 1], p);
  const dashed = backends.buildBackendArgs('dsh', '---\nname: x\n', {});
  assert.equal(dashed[dashed.length - 1], 'Task:\n---\nname: x\n');
  const patch = args[args.indexOf('--patch') + 1];
  assert.ok(patch.endsWith('dsh-disable-subagent.yml'));
  const savedSocai = process.env.SOCAI_DEEPSEEK_KEY;
  const savedMa = process.env.MA_DEEPSEEK_KEY;
  const savedDsh = process.env.SOCAI_DSH_KEY;
  delete process.env.SOCAI_DEEPSEEK_KEY;
  delete process.env.SOCAI_DSH_KEY;
  process.env.MA_DEEPSEEK_KEY = 'ds-openai-key';
  try {
    const env = backends.buildBackendEnv('dsh', { DEEPSEEK_API_KEY: 'leak', FOO: 'bar' });
    assert.equal(env.DEEPSEEK_API_KEY, 'ds-openai-key');
    assert.equal(env.DSH_PERMISSION_MODE, 'danger-full-access');
    assert.ok(env.DSH_HOME, '隔离 DSH_HOME，不吃 ~/.dsh/settings.yaml');
    assert.equal(env.FOO, 'bar');
    assert.ok(!env.ANTHROPIC_BASE_URL, 'dsh 不走 Anthropic 兼容口');
  } finally {
    if (savedMa === undefined) delete process.env.MA_DEEPSEEK_KEY; else process.env.MA_DEEPSEEK_KEY = savedMa;
    if (savedSocai === undefined) delete process.env.SOCAI_DEEPSEEK_KEY; else process.env.SOCAI_DEEPSEEK_KEY = savedSocai;
    if (savedDsh === undefined) delete process.env.SOCAI_DSH_KEY; else process.env.SOCAI_DSH_KEY = savedDsh;
  }
  assert.equal(backends.backendFamily('dsh'), 'dsh');
  assert.ok(!backends.isSameModelFamily('dsh', 'claude-glm'));
  assert.ok(!backends.isSameModelFamily('dsh', 'claude-deepseek'), 'harness 不同族，避免跟 claude-deepseek 误报 theater');
  assert.ok(backends.EXTERNAL_EXECUTOR_BACKENDS.includes('dsh'));
  assert.equal(maCall.isNativeExecutorMode({ SOCAI_EXECUTOR_BACKEND: 'dsh' }), false);
});
test('dsh 路由 patch：网关 + 模型写进 yml，不含 key', () => {
  const yml = backends.renderDshRoutePatch({
    baseURL: 'https://gateway.example/aigw/v1',
    model: 'GLM-5.2',
    models: ['Qwen3.5-307B-A17B'],
  });
  assert.match(yml, /baseURL: 'https:\/\/gateway.example\/aigw\/v1'/);
  assert.match(yml, /api: openai-completions/);
  assert.match(yml, /provider: aigw/);
  assert.match(yml, /model: 'GLM-5.2'/);
  assert.match(yml, /Qwen3.5-307B-A17B/);
  // 有网关没 model：钉到 aigw/default，不落回官方 deepseek
  const noModel = backends.renderDshRoutePatch({ baseURL: 'https://gw.example/v1' });
  assert.match(noModel, /provider: aigw/);
  assert.match(noModel, /model: 'default'/);
  assert.ok(!/deepseek-official/.test(noModel), '有网关时不得落回 deepseek-official');
  assert.ok(!/sk-/.test(yml), 'patch 不得含密钥');
  const args = backends.buildBackendArgs('dsh', 'hi', { dshRoutePatch: '/tmp/no-such-route.yml' });
  assert.ok(!args.includes('/tmp/no-such-route.yml'), '文件不存在则不加 --patch');
});
test('dsh 缺 key：assertBackendCallable 拒绝', () => {
  const savedSocai = process.env.SOCAI_DEEPSEEK_KEY;
  const savedMa = process.env.MA_DEEPSEEK_KEY;
  const savedDs = process.env.DEEPSEEK_API_KEY;
  const savedDsh = process.env.SOCAI_DSH_KEY;
  delete process.env.SOCAI_DEEPSEEK_KEY;
  delete process.env.MA_DEEPSEEK_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.SOCAI_DSH_KEY;
  try {
    assert.throws(() => backends.assertBackendCallable('dsh'), /DSH_KEY|DEEPSEEK/);
  } finally {
    if (savedSocai === undefined) delete process.env.SOCAI_DEEPSEEK_KEY; else process.env.SOCAI_DEEPSEEK_KEY = savedSocai;
    if (savedMa === undefined) delete process.env.MA_DEEPSEEK_KEY; else process.env.MA_DEEPSEEK_KEY = savedMa;
    if (savedDs === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = savedDs;
    if (savedDsh === undefined) delete process.env.SOCAI_DSH_KEY; else process.env.SOCAI_DSH_KEY = savedDsh;
  }
});
test('backend args/env 快照：六条记录组装', () => {
  const p = 'hello';
  assert.deepEqual(backends.buildBackendArgs('claude', p, {}), ['-p', p, '--output-format', 'json', '--dangerously-skip-permissions']);
  assert.deepEqual(backends.buildBackendArgs('claude', p, { model: 'sonnet' }), ['-p', p, '--output-format', 'json', '--dangerously-skip-permissions', '--model', 'sonnet']);
  assert.deepEqual(backends.buildBackendAutonomyArgs('cursor'), ['-f', '--trust']);
  const cursorArgs = backends.buildBackendArgs('cursor', p, {});
  assert.ok(cursorArgs.includes('stream-json'));
  const kimiArgs = backends.buildBackendArgs('kimi', p, {});
  assert.ok(kimiArgs.includes('-p') && kimiArgs.includes('stream-json'));
  const codexArgs = backends.buildBackendArgs('codex', p, {});
  assert.equal(codexArgs[0], 'exec');
  const glmEnv = backends.buildBackendEnv('claude-glm', {});
  assert.equal(glmEnv.ANTHROPIC_BASE_URL, 'https://open.bigmodel.cn/api/anthropic');
  assert.equal(glmEnv.ANTHROPIC_AUTH_TOKEN, ''); // harness：清空 AUTH_TOKEN，改用 API_KEY（防 OAuth 覆盖）
});
test('harness env 注入：API_KEY 注 backend key + 清空 AUTH_TOKEN（防泄漏 + 防 OAuth 覆盖端点）', () => {
  const savedMa = process.env.MA_DEEPSEEK_KEY;
  const savedSocai = process.env.SOCAI_DEEPSEEK_KEY;
  // envGet 优先 SOCAI_*；测 MA_ 路径时须清掉本机残留的 SOCAI_DEEPSEEK_KEY
  delete process.env.SOCAI_DEEPSEEK_KEY;
  process.env.MA_DEEPSEEK_KEY = 'ds-key';
  try {
    const env = backends.buildBackendEnv('claude-deepseek', { ANTHROPIC_API_KEY: 'leak', ANTHROPIC_AUTH_TOKEN: 'leak-tok', FOO: 'bar' });
    assert.equal(env.ANTHROPIC_API_KEY, 'ds-key', 'API_KEY 应被 backend 自己的 key 覆盖（不是 leak）');
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, '', 'AUTH_TOKEN 清空（防 claude OAuth 覆盖第三方端点）');
    assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
    assert.equal(env.FOO, 'bar');
  } finally {
    if (savedMa === undefined) delete process.env.MA_DEEPSEEK_KEY; else process.env.MA_DEEPSEEK_KEY = savedMa;
    if (savedSocai === undefined) delete process.env.SOCAI_DEEPSEEK_KEY; else process.env.SOCAI_DEEPSEEK_KEY = savedSocai;
  }
});
test('runAgent fallback：主失败→备接管；双败→抛错', async () => {
  const prevClaude = process.env.MA_AGENT_BIN_CLAUDE;
  const prevKimi = process.env.MA_AGENT_BIN_KIMI;
  const prevFallback = process.env.MA_FALLBACK;
  process.env.MA_AGENT_BIN_CLAUDE = FAKE_AGENT;
  process.env.MA_AGENT_BIN_KIMI = FAKE_AGENT;
  process.env.MA_FALLBACK = 'kimi';
  try {
    process.env.MA_FAKE_EXIT = '1';
    process.env.MA_FAKE_FAIL_AGENT = 'all';
    await assert.rejects(
      () => backends.runAgent('claude', 'reply exactly: ok', { fallback: null }),
      /退出码|infra/i,
    );
    delete process.env.MA_FAKE_FAIL_AGENT;
    process.env.MA_FAKE_FAIL_AGENT = 'claude';
    const ok = await backends.runAgent('claude', 'reply exactly: ok', {});
    assert.equal(ok.backendId, 'kimi');
    assert.equal(ok.degraded, 'claude→kimi');
    delete process.env.MA_FAKE_EXIT;
    delete process.env.MA_FAKE_FAIL_AGENT;
  } finally {
    if (prevClaude === undefined) delete process.env.MA_AGENT_BIN_CLAUDE; else process.env.MA_AGENT_BIN_CLAUDE = prevClaude;
    if (prevKimi === undefined) delete process.env.MA_AGENT_BIN_KIMI; else process.env.MA_AGENT_BIN_KIMI = prevKimi;
    if (prevFallback === undefined) delete process.env.MA_FALLBACK; else process.env.MA_FALLBACK = prevFallback;
    delete process.env.MA_FAKE_EXIT;
    delete process.env.MA_FAKE_FAIL_AGENT;
  }
});
test('runAgent codex：usage 从 stderr 解析（真实 codex tokens used 走 stderr）', async () => {
  const prevCodex = process.env.MA_AGENT_BIN_CODEX;
  process.env.MA_AGENT_BIN_CODEX = FAKE_AGENT;
  try {
    const r = await backends.runAgent('codex', 'reply exactly: ok', {});
    assert.equal(r.backendId, 'codex');
    assert.equal(r.usage, 100, `期望从 stderr 解析到 100，实际 ${r.usage}`);
  } finally {
    if (prevCodex === undefined) delete process.env.MA_AGENT_BIN_CODEX; else process.env.MA_AGENT_BIN_CODEX = prevCodex;
  }
});
test('7a-1 profile 快照：家底 + cn 四角色默认', () => {
  const d = backends.DEFAULT_ROUTING;
  assert.equal(d.triage.backend, 'cursor');
  assert.equal(d.triage.model, 'auto');
  assert.equal(d.planner.backend, 'kimi');
  assert.equal(d.executor.backend, 'claude');
  assert.equal(d.executor.fallback, 'cursor');
  assert.equal(d.reviewer.backend, 'sparring');
  assert.equal(d.reviewer.fallback, 'claude');
  const cn = backends.CN_ROUTING;
  assert.equal(cn.triage.backend, 'kimi');
  assert.equal(cn.planner.backend, 'kimi');
  assert.equal(cn.executor.backend, 'claude-deepseek');
  assert.equal(cn.reviewer.backend, 'claude-glm');
});
test('7a-1 mergeConfigLayers：默认 profile < 全局 roles < env 优先级', () => {
  const merged = backends.mergeConfigLayers({
    profile: 'default',
    globalConfig: { roles: { executor: { backend: 'codex' } } },
    projectConfig: {},
    env: { MA_EXECUTOR_MODEL: 'gpt-5' },
  });
  assert.equal(merged.roles.executor.backend, 'codex', '全局 roles 覆盖默认');
  assert.equal(merged.roles.executor.model, 'gpt-5', 'env 覆盖 model');
  assert.equal(merged.roles.executor.fallback, 'cursor', '全局未覆盖 fallback → 默认（P0-4：default executor=claude, fallback=cursor）');
  assert.equal(merged.roles.triage.backend, 'cursor', '未覆盖角色保持默认');
  assert.equal(merged.roles.triage.model, 'auto');
});
test('7a-1 mergeConfigLayers：cn profile 全国内直连', () => {
  const merged = backends.mergeConfigLayers({ profile: 'cn', globalConfig: {}, projectConfig: {}, env: {} });
  assert.equal(merged.roles.triage.backend, 'kimi');
  assert.equal(merged.roles.executor.backend, 'claude-deepseek');
  assert.equal(merged.roles.reviewer.backend, 'claude-glm');
});
test('7a-1 filterProjectConfig I10：禁放字段过滤 + 警告，非主观项保留', () => {
  const warned = [];
  const { cleaned } = backends.filterProjectConfig(
    { timeout: { base: 600000 }, budget: 1000000, maxParallel: 2, retries: 1, backend: 'claude', model: 'sonnet', api_key: 'leak', executor: 'codex', roles: {} },
    (msg) => warned.push(msg),
  );
  assert.equal(cleaned.timeout.base, 600000, 'timeout 保留');
  assert.equal(cleaned.budget, 1000000, 'budget 保留');
  assert.equal(cleaned.maxParallel, 2, 'maxParallel 保留');
  assert.equal(cleaned.retries, 1, 'retries 保留');
  assert.equal(cleaned.backend, undefined, 'I10: backend 过滤');
  assert.equal(cleaned.model, undefined, 'I10: model 过滤');
  assert.equal(cleaned.api_key, undefined, 'I10: api_key 过滤');
  assert.equal(cleaned.executor, undefined, 'I10: executor 过滤');
  assert.equal(cleaned.roles, undefined, 'I10: roles 过滤');
  assert.ok(warned.length > 0 && warned.join(' ').includes('api_key'), '应警告含 api_key');
});
test('7a-1 maskSecrets：key/token/secret → ***，非敏感保留', () => {
  const masked = backends.maskSecrets({
    profile: 'default',
    roles: { executor: { backend: 'claude' } },
    backends: { 'claude-glm': { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak', ANTHROPIC_BASE_URL: 'https://x' } } },
  });
  assert.equal(masked.profile, 'default');
  assert.equal(masked.roles.executor.backend, 'claude', 'backend 非敏感');
  assert.equal(masked.backends['claude-glm'].env.ANTHROPIC_AUTH_TOKEN, '***', 'token 掩码');
  assert.equal(masked.backends['claude-glm'].env.ANTHROPIC_BASE_URL, 'https://x', 'URL 非敏感');
});
test('7a-1 resolveGlobalConfigPath：MA_CONFIG_HOME 覆盖；默认 ~/.config/socai', () => {
  const prev = process.env.MA_CONFIG_HOME;
  process.env.MA_CONFIG_HOME = '/tmp/fake-ma-home';
  try {
    assert.equal(backends.resolveGlobalConfigPath(), path.join('/tmp/fake-ma-home', 'config.json'));
  } finally {
    if (prev === undefined) delete process.env.MA_CONFIG_HOME; else process.env.MA_CONFIG_HOME = prev;
  }
});
test('7a-2 parseRoleFlag：cursor:auto / cursor / 空', () => {
  assert.deepEqual(backends.parseRoleFlag('cursor:auto'), { backend: 'cursor', model: 'auto' });
  assert.deepEqual(backends.parseRoleFlag('codex'), { backend: 'codex', model: null });
  assert.equal(backends.parseRoleFlag(null), null);
  assert.equal(backends.parseRoleFlag(''), null);
});
test('7a-2 resolveRouting：flag > env > 默认；globalModel 覆盖；非法 backend 抛错', () => {
  // flag 最高优先
  const r1 = backends.resolveRouting({ flags: { executor: 'codex:gpt-5' }, profile: 'default', globalConfig: {}, projectConfig: {}, env: {} });
  assert.equal(r1.executor.backend, 'codex');
  assert.equal(r1.executor.model, 'gpt-5');
  // env 次之（覆盖默认 profile）
  const r2 = backends.resolveRouting({ flags: {}, profile: 'default', globalConfig: {}, projectConfig: {}, env: { MA_TRIAGE_BACKEND: 'kimi' } });
  assert.equal(r2.triage.backend, 'kimi');
  // globalModel 覆盖默认 model
  const r3 = backends.resolveRouting({ flags: {}, profile: 'default', globalModel: 'sonnet', globalConfig: {}, projectConfig: {}, env: {} });
  assert.equal(r3.triage.model, 'sonnet');
  // flag model 优先于 globalModel
  const r4 = backends.resolveRouting({ flags: { triage: 'cursor:auto' }, profile: 'default', globalModel: 'sonnet', globalConfig: {}, projectConfig: {}, env: {} });
  assert.equal(r4.triage.model, 'auto', 'flag model 优先于 globalModel');
  // 非法 backend → UNKNOWN_BACKEND
  assert.throws(
    () => backends.resolveRouting({ flags: { executor: 'no-such-cli' }, profile: 'default', globalConfig: {}, projectConfig: {}, env: {} }),
    /不存在|UNKNOWN_BACKEND/,
  );
});
test('P0-1 resolveRouting：MA_BACKEND 覆盖四角色；flag 仍胜过；非法抛错', () => {
  // MA_BACKEND 覆盖 default（triage default=cursor → claude）
  const r1 = backends.resolveRouting({ flags: {}, profile: 'default', globalConfig: {}, projectConfig: {}, env: { MA_BACKEND: 'claude' } });
  assert.equal(r1.triage.backend, 'claude', 'MA_BACKEND 覆盖 triage');
  assert.equal(r1.planner.backend, 'claude');
  assert.equal(r1.executor.backend, 'claude');
  assert.equal(r1.reviewer.backend, 'claude');
  // flag 胜过 MA_BACKEND（显式 --executor 优先）
  const r2 = backends.resolveRouting({ flags: { executor: 'codex' }, profile: 'default', globalConfig: {}, projectConfig: {}, env: { MA_BACKEND: 'claude' } });
  assert.equal(r2.executor.backend, 'codex', 'flag 胜过 MA_BACKEND');
  assert.equal(r2.triage.backend, 'claude', '未给 flag 的角色仍被 MA_BACKEND 覆盖');
  // MA_BACKEND 非法 → UNKNOWN_BACKEND（exit 2 友好路径）
  assert.throws(
    () => backends.resolveRouting({ flags: {}, profile: 'default', globalConfig: {}, projectConfig: {}, env: { MA_BACKEND: 'no-such' } }),
    /不存在|UNKNOWN_BACKEND/,
  );
});
test('extractAgentContent claude：{result:markdown} JSON 提正文', () => {
  const out = backends.extractAgentContent('claude', JSON.stringify({ result: '## 根因\nx\n```socai-result\n{"a":1}\n```' }));
  assert.match(out, /## 根因/);
  assert.match(out, /socai-result/);
});
test('extractAgentContent claude：markdown + 尾部 usage JSON 行（剥尾）', () => {
  const out = backends.extractAgentContent('claude', '## plan\nbody\n{"type":"result","result":"ok","usage":{"input_tokens":10,"output_tokens":0}}');
  assert.match(out, /## plan/);
  assert.ok(!/"type":"result"/.test(out), '尾部 usage JSON 行应剥掉');
});
test('extractAgentContent claude：空 stdout → 原样', () => {
  assert.equal(backends.extractAgentContent('claude', ''), '');
});
test('extractAgentContent kimi：stream-json assistant 行提 content', () => {
  const out = backends.extractAgentContent('kimi', '{"role":"assistant","content":"## plan"}\n{"role":"meta","type":"session.resume_hint"}');
  assert.match(out, /## plan/);
});
test('extractAgentContent kimi：纯 markdown 无 assistant 行（剥尾 JSON）', () => {
  const out = backends.extractAgentContent('kimi', '## plan\nbody\n{"x":1}');
  assert.match(out, /## plan/);
});
test('extractAgentContent cursor：assistant content text + result 拼接', () => {
  const out = backends.extractAgentContent('cursor', '{"type":"assistant","message":{"content":[{"type":"text","text":"## plan"}]}}\n{"type":"result","result":"tail","usage":{"total_tokens":5}}');
  assert.match(out, /## plan/);
  assert.match(out, /tail/);
});
test('extractAgentContent 未知 id（codex 等）：原文', () => {
  assert.equal(backends.extractAgentContent('codex', 'raw text'), 'raw text');
});
test('parseClaudeJsonUsage：o.usage tokens 求和', () => {
  assert.equal(backends.parseClaudeJsonUsage('{"usage":{"input_tokens":100,"output_tokens":50}}'), 150);
});
test('parseClaudeJsonUsage：o.modelUsage 变体（取首个 model 条目）', () => {
  assert.equal(backends.parseClaudeJsonUsage('{"modelUsage":{"claude-sonnet-4":{"input_tokens":80,"output_tokens":20}}}'), 100);
});
test('parseClaudeJsonUsage：无 usage → null', () => {
  assert.equal(backends.parseClaudeJsonUsage('{"result":"ok"}'), null);
  assert.equal(backends.parseClaudeJsonUsage(''), null);
});
test('parseCursorJsonUsage：result.total_tokens', () => {
  assert.equal(backends.parseCursorJsonUsage('{"type":"result","usage":{"total_tokens":200}}'), 200);
});
test('parseCursorJsonUsage：无 total_tokens 时 input+output 求和', () => {
  assert.equal(backends.parseCursorJsonUsage('{"type":"result","usage":{"input_tokens":30,"output_tokens":20}}'), 50);
});
test('Batch 2.2 runSparringReview：exit 0 → APPROVE（pass:true）', async () => {
  const fake = makeFakeSparring(0);
  const old = process.env.MA_SPARRING_BIN;
  process.env.MA_SPARRING_BIN = fake;
  try {
    const r = await backends.runSparringReview({ diff: '## diff\n+code', acceptOutput: 'accept ok', title: 't', timeoutMs: 5000 });
    assert.equal(r.verdict, 'APPROVE');
    assert.match(r.content, /"pass"\s*:\s*true/);
  } finally {
    if (old === undefined) delete process.env.MA_SPARRING_BIN; else process.env.MA_SPARRING_BIN = old;
    rmSync(path.dirname(fake), { recursive: true, force: true });
  }
});
test('Batch 2.2 runSparringReview：exit 2 → CONCERNS（pass:false，feedback 含 sparring 输出）', async () => {
  const fake = makeFakeSparring(2, 'mock CONCERNS：diff 含未注释的 console.log');
  const old = process.env.MA_SPARRING_BIN;
  process.env.MA_SPARRING_BIN = fake;
  try {
    const r = await backends.runSparringReview({ diff: '## diff\n+console.log(x)', acceptOutput: '', title: 't2', timeoutMs: 5000 });
    assert.equal(r.verdict, 'CONCERNS');
    assert.match(r.content, /"pass"\s*:\s*false/);
    assert.match(r.content, /console\.log/, 'CONCERNS feedback 应含 sparring 输出');
  } finally {
    if (old === undefined) delete process.env.MA_SPARRING_BIN; else process.env.MA_SPARRING_BIN = old;
    rmSync(path.dirname(fake), { recursive: true, force: true });
  }
});
test('Batch 2.2 runSparringReview：exit 1 → reject INFRA_FAIL（callReviewer 据此 fallback）', async () => {
  const fake = makeFakeSparring(1, 'sparring error');
  const old = process.env.MA_SPARRING_BIN;
  process.env.MA_SPARRING_BIN = fake;
  try {
    await assert.rejects(
      backends.runSparringReview({ diff: 'x', acceptOutput: '', title: 't3', timeoutMs: 5000 }),
      (e) => e.code === 'INFRA_FAIL' && /exit=1/.test(e.message),
      'exit 1 应 reject INFRA_FAIL',
    );
  } finally {
    if (old === undefined) delete process.env.MA_SPARRING_BIN; else process.env.MA_SPARRING_BIN = old;
    rmSync(path.dirname(fake), { recursive: true, force: true });
  }
});
test('Batch 2.2 filterDiffDenylist：剔 lockfile/构建产物段，保留源文件 diff', () => {
  const text = '## 审查主题\nt\n\n## diff\ndiff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\nbinary huge\n\ndiff --git a/src/a.ts b/src/a.ts\n+code';
  const out = backends.filterDiffDenylist(text);
  assert.ok(!/pnpm-lock/.test(out), 'lockfile 段应剔除');
  assert.match(out, /src\/a\.ts/, '源文件 diff 保留');
});
test('Batch 2.2 filterDiffDenylist：无 diff 段（纯文本结论）原样返回', () => {
  const text = '## 结论\n这是一段纯文本结论，无 diff --git 段';
  assert.equal(backends.filterDiffDenylist(text), text);
});
test('Batch 2.3 parseClaudeCost：total_cost_usd 单行 JSON', () => {
  assert.equal(backends.parseClaudeCost('{"result":"ok","total_cost_usd":0.0123}'), 0.0123);
});
test('Batch 2.3 parseClaudeCost：尾部 JSON 行（claude --output-format json 多行输出）', () => {
  assert.equal(backends.parseClaudeCost('assistant text\n{"type":"result","result":"ok","total_cost_usd":0.05}'), 0.05);
});
test('Batch 2.3 parseClaudeCost：无 cost 字段 / 空 → null', () => {
  assert.equal(backends.parseClaudeCost('{"result":"ok"}'), null);
  assert.equal(backends.parseClaudeCost(''), null);
});
test('Batch 2.4b runSparringReview：content 参数（plan 方案对抗，直传整段文本）', async () => {
  const fake = makeFakeSparring(0);
  const old = process.env.MA_SPARRING_BIN;
  process.env.MA_SPARRING_BIN = fake;
  try {
    const r = await backends.runSparringReview({ content: '## plan 方案\n根因/方案/accept...', title: 'plan-review', timeoutMs: 5000 });
    assert.equal(r.verdict, 'APPROVE');
    assert.match(r.content, /"pass":true/);
  } finally {
    if (old === undefined) delete process.env.MA_SPARRING_BIN; else process.env.MA_SPARRING_BIN = old;
    rmSync(path.dirname(fake), { recursive: true, force: true });
  }
});
test('socai-call buildPlanReviewPrompt：含 15 维模板 + 输入文件内容', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ma-pr-'));
  try {
    writeFileSync(path.join(dir, 'master.md'), '# MASTER_CONTENT_X\n');
    writeFileSync(path.join(dir, 's.spec.md'), '# SPEC_CONTENT_Y\n');
    const p = maCall.buildPlanReviewPrompt(path.join(dir, 'master.md'), [path.join(dir, 's.spec.md')]);
    assert.match(p, /你是计划审核者/);
    assert.match(p, /MASTER_CONTENT_X/);
    assert.match(p, /SPEC_CONTENT_Y/);
    for (const d of ['依赖顺序', '验收点', '批次大小', '架构层归属', 'Invariant', 'Spec 同步', '对抗式退出条件']) {
      assert.ok(p.includes(d), `prompt 应含维度 ${d}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call coverageWarn：维度齐全(≥12) → 空', () => {
  const full = maCall.PLAN_REVIEW_DIMS.join(' ');
  assert.equal(maCall.coverageWarn(full), '');
});
test('socai-call coverageWarn：维度不全(<12) → ⚠️ 含计数', () => {
  assert.match(maCall.coverageWarn('依赖顺序 验收点 批次大小'), /维度不全\(3\/15\)/);
});
test('socai-call stripTrailingJsonLines：去尾部 JSON 行 + 空行', () => {
  assert.equal(maCall.stripTrailingJsonLines('报告\n{"role":"meta"}\n'), '报告');
  assert.equal(maCall.stripTrailingJsonLines('a\nb\n{"x":1}\n{"y":2}'), 'a\nb');
  assert.equal(maCall.stripTrailingJsonLines('纯文本无 JSON'), '纯文本无 JSON');
});
test('socai-call plan-review：kimi 正常 → 15 维报告 + exit 0 + 无 JSON 残留', () => {
  const { cfgHome, dir } = makePlanReviewFixtures();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: dir, args: ['plan-review', path.join(dir, 'master.md'), path.join(dir, '01.spec.md'), '--timeout=30'] });
    assert.equal(r.status, 0, `期望 exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /依赖顺序/);
    assert.match(r.stdout, /结论/);
    assert.doesNotMatch(r.stdout, /\{"role":"meta"/, '不应残留 kimi meta JSON');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call plan-review：维度不全 → 报告 + ⚠️ 警告 + 仍 exit 0', () => {
  const { cfgHome, dir } = makePlanReviewFixtures();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: dir, args: ['plan-review', path.join(dir, 'master.md'), '--timeout=30'], env: { MA_FAKE_PLAN_REVIEW_PARTIAL: '1' } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /维度不全\(5\/15\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call plan-review：主败 fallback 接管（reviewer 默认带 fallback=claude）→ exit 0 + stderr 降级标记', () => {
  const { cfgHome, dir } = makePlanReviewFixtures();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: dir, args: ['plan-review', path.join(dir, 'master.md'), '--timeout=30'], env: { MA_FAKE_EXIT: '1', MA_FAKE_FAIL_AGENT: 'kimi' } });
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /依赖顺序/, 'claude fallback 接管仍应出报告');
    assert.match(r.stderr, /降级 kimi→claude/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call plan-review：主备双败 → exit 1 + stderr 降级建议', () => {
  const { cfgHome, dir } = makePlanReviewFixtures();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: dir, args: ['plan-review', path.join(dir, 'master.md'), '--timeout=30'], env: { MA_FAKE_EXIT: '1', MA_FAKE_FAIL_AGENT: 'all' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /降级建议/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call plan-review：reviewer=sparring → 拒绝 + exit 1', () => {
  const { cfgHome, dir } = makePlanReviewFixtures({ reviewer: { backend: 'sparring' } });
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: dir, args: ['plan-review', path.join(dir, 'master.md'), '--timeout=30'] });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /长推理 backend/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call plan-review：全局 config 空 → default sparring → 拒绝 + exit 1', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'socai-call-'));
  const cfgHome = path.join(dir, 'cfg');
  mkdirSync(cfgHome, { recursive: true });
  writeFileSync(path.join(cfgHome, 'config.json'), '{}');
  writeFileSync(path.join(dir, 'master.md'), '# 总纲\n');
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: dir, args: ['plan-review', path.join(dir, 'master.md'), '--timeout=30'] });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /长推理 backend|sparring/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call plan-review：MA_REVIEWER_BACKEND=claude env 覆盖 → 正常报告', () => {
  const { cfgHome, dir } = makePlanReviewFixtures();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: dir, args: ['plan-review', path.join(dir, 'master.md'), '--timeout=30'], env: { MA_REVIEWER_BACKEND: 'claude' } });
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /依赖顺序/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call plan-review：无文件参数 → exit 2', () => {
  const { cfgHome, dir } = makePlanReviewFixtures();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: dir, args: ['plan-review'] });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /用法/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call plan-review：未知子命令 → exit 2', () => {
  const { cfgHome, dir } = makePlanReviewFixtures();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: dir, args: ['unknown-cmd'] });
    assert.equal(r.status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call buildDiffReviewPrompt：含 diff 内容 + 角色标记 + 维度', () => {
  const p = maCall.buildDiffReviewPrompt('--- a/x\n+++ b/x\n+FAKE_DIFF_LINE', 'HEAD~1', 'HEAD');
  assert.match(p, /你是 diff 审核者/);
  assert.match(p, /FAKE_DIFF_LINE/);
  assert.match(p, /HEAD~1\.\.HEAD/);
  for (const d of ['严重 bug', '边界', '安全', '测试覆盖', 'verdict']) {
    assert.ok(p.includes(d), `prompt 应含维度 ${d}`);
  }
});
test('socai-call capDiff：≤maxLines 原样；>maxLines 截断 + 标注 + 不留尾部行', () => {
  const small = 'a\nb\nc';
  assert.equal(maCall.capDiff(small, 500), small);
  const big = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n');
  const capped = maCall.capDiff(big, 5);
  assert.match(capped, /截断/);
  assert.match(capped, /line0/);
  assert.ok(!capped.includes('line9'), '超过 maxLines 的行不应保留');
});
test('socai-call diff-review：kimi 正常 → 报告 + exit 0', () => {
  const { cfgHome, dir: cfgDir } = makePlanReviewFixtures();
  const repo = makeDiffRepo();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: repo, args: ['diff-review', 'HEAD~1', 'HEAD', '--timeout=30'] });
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /diff 审核/);
    assert.match(r.stdout, /verdict/);
  } finally { rmSync(cfgDir, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});
test('socai-call diff-review：维度不全 → 报告 + ⚠️ 警告 + 仍 exit 0', () => {
  const { cfgHome, dir: cfgDir } = makePlanReviewFixtures();
  const repo = makeDiffRepo();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: repo, args: ['diff-review', 'HEAD~1', 'HEAD', '--timeout=30'], env: { MA_FAKE_DIFF_REVIEW_PARTIAL: '1' } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /维度不全\(3\/6\)/);
  } finally { rmSync(cfgDir, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});
test('socai-call diff-review：reviewer=sparring → 拒绝 + exit 1', () => {
  const { cfgHome, dir: cfgDir } = makePlanReviewFixtures({ reviewer: { backend: 'sparring' } });
  const repo = makeDiffRepo();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: repo, args: ['diff-review', 'HEAD~1', 'HEAD', '--timeout=30'] });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /长推理 backend/);
  } finally { rmSync(cfgDir, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});
test('socai-call diff-review：MA_REVIEWER_BACKEND=claude env 覆盖 → exit 0', () => {
  const { cfgHome, dir: cfgDir } = makePlanReviewFixtures();
  const repo = makeDiffRepo();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: repo, args: ['diff-review', 'HEAD~1', 'HEAD', '--timeout=30'], env: { MA_REVIEWER_BACKEND: 'claude' } });
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /verdict/);
  } finally { rmSync(cfgDir, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});
test('socai-call diff-review：缺 head 参数 → exit 2', () => {
  const { cfgHome, dir: cfgDir } = makePlanReviewFixtures();
  const repo = makeDiffRepo();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: repo, args: ['diff-review', 'HEAD~1'] });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /用法/);
  } finally { rmSync(cfgDir, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});
test('socai-call diff-review：空 diff（同 ref）→ exit 2', () => {
  const { cfgHome, dir: cfgDir } = makePlanReviewFixtures();
  const repo = makeDiffRepo();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: repo, args: ['diff-review', 'HEAD', 'HEAD', '--timeout=30'] });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /为空/);
  } finally { rmSync(cfgDir, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});
test('socai-call exec：dsh 正常 → 摘要 + exit 0', () => {
  const { cfgHome, dir } = makeExecFixtures({ executor: { backend: 'dsh' } });
  try {
    const r = runMaCall({
      configHome: cfgHome, cwd: dir, args: ['exec', path.join(dir, 'batch.prompt.md'), '--timeout=30'],
      env: { MA_AGENT_BIN_DSH: FAKE_AGENT, MA_DEEPSEEK_KEY: 'fake-key' },
    });
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /执行摘要/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call exec：claude-deepseek 正常 → 摘要 + exit 0', () => {
  const { cfgHome, dir } = makeExecFixtures();
  try {
    const r = runMaCall({
      configHome: cfgHome, cwd: dir, args: ['exec', path.join(dir, 'batch.prompt.md'), '--timeout=30'],
      env: { MA_AGENT_BIN_CLAUDE_DEEPSEEK: FAKE_AGENT, MA_DEEPSEEK_KEY: 'fake-key' },
    });
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /执行摘要/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call exec：MA_EXECUTOR_BACKEND=claude env 覆盖 → exit 0', () => {
  const { cfgHome, dir } = makeExecFixtures();
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: dir, args: ['exec', path.join(dir, 'batch.prompt.md'), '--timeout=30'], env: { MA_EXECUTOR_BACKEND: 'claude' } });
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /执行摘要/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call exec：executor=sparring → 拒绝 + exit 1', () => {
  const { cfgHome, dir } = makeExecFixtures({ executor: { backend: 'sparring' } });
  try {
    const r = runMaCall({ configHome: cfgHome, cwd: dir, args: ['exec', path.join(dir, 'batch.prompt.md'), '--timeout=30'] });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /仅 reviewer/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('socai-call exec：prompt 文件不存在 → exit 2', () => {
  const { cfgHome, dir } = makeExecFixtures();
  try {
    const r = runMaCall({
      configHome: cfgHome, cwd: dir, args: ['exec', path.join(dir, 'no-such.prompt.md'), '--timeout=30'],
      env: { MA_AGENT_BIN_CLAUDE_DEEPSEEK: FAKE_AGENT, MA_DEEPSEEK_KEY: 'fake-key' },
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /读 prompt 文件失败/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('backendFamily / isSameModelFamily：族定义与同族判定', () => {
  assert.equal(backends.backendFamily('claude-glm'), 'glm');
  assert.equal(backends.backendFamily('claude-deepseek'), 'deepseek');
  assert.equal(backends.backendFamily('cursor'), 'cursor');
  assert.equal(backends.backendFamily('kimi'), 'kimi');
  assert.equal(backends.backendFamily('claude'), 'claude');
  assert.notEqual(backends.backendFamily('claude'), backends.backendFamily('claude-glm'));
  assert.ok(backends.isSameModelFamily('claude-glm', 'claude-glm'));
  assert.ok(!backends.isSameModelFamily('claude-glm', 'kimi'));
  assert.ok(!backends.isSameModelFamily('cursor', 'claude-glm'));
  assert.ok(backends.isSameModelFamily('claude-glm', 'claude-glm', { nativeExecutor: true }));
});

test('socai-call plan-review：同族 executor=reviewer=claude-glm → stderr ⚠️ 同模型 theater + exit 0', () => {
  const { cfgHome, dir } = makePlanReviewFixtures({
    executor: { backend: 'claude-glm' },
    reviewer: { backend: 'claude-glm' },
  });
  try {
    const r = runMaCall({
      configHome: cfgHome, cwd: dir,
      args: ['plan-review', path.join(dir, 'master.md'), path.join(dir, '01.spec.md'), '--timeout=30'],
      env: { MA_AGENT_BIN_CLAUDE_GLM: FAKE_AGENT, MA_GLM_KEY: 'fake-key' },
    });
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stderr, /⚠️ 同模型 theater/);
    assert.match(r.stderr, /executor=claude-glm reviewer=claude-glm/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('warnTheaterRisk：dsh+dsh 不同 model 不算 theater', () => {
  const fake = { write() {} };
  assert.equal(maCall.warnTheaterRisk(
    { backend: 'dsh', model: 'GLM-5.2' },
    { backend: 'dsh', model: 'Qwen3.5-397B-A17B' },
    fake,
  ), false);
  assert.equal(maCall.warnTheaterRisk(
    { backend: 'dsh', model: 'GLM-5.2' },
    { backend: 'dsh', model: 'GLM-5.2' },
    fake,
  ), true);
});
test('socai-call plan-review：异族 executor=claude-glm reviewer=kimi → 无 theater 告警', () => {
  const { cfgHome, dir } = makePlanReviewFixtures({
    executor: { backend: 'claude-glm' },
    reviewer: { backend: 'kimi', model: 'k3' },
  });
  try {
    const r = runMaCall({
      configHome: cfgHome, cwd: dir,
      args: ['plan-review', path.join(dir, 'master.md'), '--timeout=30'],
      env: { MA_AGENT_BIN_CLAUDE_GLM: FAKE_AGENT, MA_AGENT_BIN_KIMI: FAKE_AGENT, MA_GLM_KEY: 'fake-key' },
    });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stderr, /⚠️ 同模型 theater/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('socai-call plan-review：异族 executor=cursor reviewer=claude-glm → 无 theater 告警', () => {
  const { cfgHome, dir } = makePlanReviewFixtures({ reviewer: { backend: 'claude-glm' } });
  try {
    const r = runMaCall({
      configHome: cfgHome, cwd: dir,
      args: ['plan-review', path.join(dir, 'master.md'), '--timeout=30'],
      env: { MA_EXECUTOR_BACKEND: 'cursor', MA_AGENT_BIN_CLAUDE_GLM: FAKE_AGENT, MA_AGENT_BIN_CURSOR: FAKE_AGENT, MA_GLM_KEY: 'fake-key' },
    });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stderr, /⚠️ 同模型 theater/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Batch 06 executor restate：executor.md 含 <restate> 块要求 + ≤5 行格式', () => {
  const content = readFileSync(path.join(here, '.claude/agents/socai-executor.md'), 'utf8');
  assert.match(content, /<restate>/, 'executor.md 应含 <restate> 标签要求或示例');
  assert.match(content, /≤5/, 'restate 应限制 ≤5 行');
});

test('Batch 06 无 CoT 反模式：executor.md / SKILL 无 step-by-step 类 prompt', () => {
  const cotPattern = /step by step|一步步思考|let'?s think/i;
  const executor = readFileSync(path.join(here, '.claude/agents/socai-executor.md'), 'utf8');
  const skill = readFileSync(path.join(here, '.claude/skills/socai/SKILL.md'), 'utf8');
  assert.doesNotMatch(executor, cotPattern, 'executor.md 不应含 CoT 反模式');
  assert.doesNotMatch(skill, cotPattern, 'SKILL.md 不应含 CoT 反模式');
});

test('Batch 06 外部模式 batch-N.prompt.md 模板含 restate 段', () => {
  const skill = readFileSync(path.join(here, '.claude/skills/socai/SKILL.md'), 'utf8');
  assert.match(skill, /batch-N\.prompt\.md/, 'SKILL 应描述 batch-N.prompt.md 组成');
  assert.match(skill, /<restate>/, '外部模式 prompt 模板应含 <restate> 段');
});

test('cursor-host：SKILL 三选一含 Cursor 宿主 Task，禁止 host 路径走 socai-call exec', () => {
  const skill = readFileSync(path.join(here, '.claude/skills/socai/SKILL.md'), 'utf8');
  assert.match(skill, /三选一/, '步骤 0 应写 executor 模式三选一');
  assert.match(skill, /cursor-host/, '应出现 cursor-host 记法');
  assert.match(skill, /cursor-cli/, '应出现 cursor-cli 回落记法');
  assert.match(skill, /composer-2\.5-fast/, 'cursor-host 默认 model');
  assert.match(skill, /显式.*model|model=<config model>/, 'cursor-host 须显式传 model');
  // host 路径明确禁止对本批再跑 socai-call exec
  assert.match(skill, /禁止.*socai-call exec|不.*走 `socai-call exec`/, 'cursor-host 禁止 socai-call exec');
  const spec = readFileSync(path.join(here, 'specs/ma-v3-architecture.spec.md'), 'utf8');
  assert.match(spec, /cursor-host/, 'ma-v3 spec 应含 cursor-host GWT');
  assert.match(spec, /cursor-cli/, 'ma-v3 spec 应含 cursor-cli GWT');
});

// --- B01 common-sense-loop: default timeouts + spine strings ---
test('B01 socai-call：exec 默认 timeout 3600，diff-review/plan-review 默认 600', () => {
  assert.equal(maCall.defaultTimeoutSec('exec'), 3600, 'exec 无 --timeout 时默认 3600');
  assert.equal(maCall.defaultTimeoutSec('diff-review'), 600, 'diff-review 无 --timeout 时默认 600');
  assert.equal(maCall.defaultTimeoutSec('plan-review'), 600, 'plan-review 无 --timeout 时默认 600');
});

test('B01 skill：含 batch_base= 与 wip(batch): 开工禁令', () => {
  const skill = readFileSync(path.join(here, '.claude/skills/socai/SKILL.md'), 'utf8');
  assert.match(skill, /batch_base=/, 'SKILL 须写清 progress 记 batch_base=');
  assert.match(skill, /wip\(batch\):/, 'SKILL 须出现 wip(batch): 约定');
  assert.match(skill, /不得.*下一批|禁止.*下一批|不开下一批/, 'HEAD 仍是 wip 时禁止开下一批');
});

// --- B03 common-sense-loop: risk: 派写手 ---
test('B03 extractRiskField：样例 md 有 risk: high → high', () => {
  assert.equal(backends.extractRiskField('risk: high\n\n## Spec\n'), 'high');
  assert.equal(backends.extractRiskField('# Batch\nrisk: low\n'), 'low');
  assert.equal(backends.extractRiskField('# no field\n'), null);
});

test('B03 resolveRouting：risk high + executor_high_risk → 用 override', () => {
  const r = backends.resolveRouting({
    profile: 'default',
    globalConfig: {
      roles: {
        executor: { backend: 'claude', model: 'haiku' },
        executor_high_risk: { backend: 'codex', model: 'gpt-5' },
      },
    },
    projectConfig: {},
    env: {},
    risk: 'high',
  });
  assert.equal(r.executor.backend, 'codex');
  assert.equal(r.executor.model, 'gpt-5');
});

test('B03 resolveRouting：risk high 无 override → 默认，不抛', () => {
  const r = backends.resolveRouting({
    profile: 'default',
    globalConfig: { roles: { executor: { backend: 'claude', model: 'haiku' } } },
    projectConfig: {},
    env: {},
    risk: 'high',
  });
  assert.equal(r.executor.backend, 'claude');
  assert.equal(r.executor.model, 'haiku');
});

test('B03 resolveRouting：risk low → 默认，即使配了 override', () => {
  const r = backends.resolveRouting({
    profile: 'default',
    globalConfig: {
      roles: {
        executor: { backend: 'claude', model: 'haiku' },
        executor_high_risk: { backend: 'codex', model: 'gpt-5' },
      },
    },
    projectConfig: {},
    env: {},
    risk: 'low',
  });
  assert.equal(r.executor.backend, 'claude');
  assert.equal(r.executor.model, 'haiku');
});

test('socai-call plan-review：同族 + CONCERNS 报告 → stdout 头 THEATER_RISK=1 + exit 0', () => {
  const { cfgHome, dir } = makePlanReviewFixtures({
    executor: { backend: 'claude-glm' },
    reviewer: { backend: 'claude-glm' },
  });
  try {
    const r = runMaCall({
      configHome: cfgHome, cwd: dir,
      args: ['plan-review', path.join(dir, 'master.md'), '--timeout=30'],
      env: { MA_AGENT_BIN_CLAUDE_GLM: FAKE_AGENT, MA_GLM_KEY: 'fake-key', MA_FAKE_PLAN_REVIEW_CONCERNS: '1' },
    });
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stderr, /⚠️ 同模型 theater/);
    assert.match(r.stdout, /^THEATER_RISK=1\n/);
    assert.match(r.stdout, /CONCERNS/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
