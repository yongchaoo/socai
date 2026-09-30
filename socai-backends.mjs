/**
 * socai-backends — CLI 后端记录表 + runAgent + usage 解析 + verify 探测（Batch 6）。
 * spawn 收敛单点（I9）；secrets 仅经 env 注入（I10）。
 */

import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DSH_WRAPPER = path.join(HERE, '.claude/skills/socai/_runtime/dsh.sh');
const DSH_DISABLE_SUBAGENT_PATCH = path.join(HERE, '.claude/skills/socai/_runtime/dsh-disable-subagent.yml');

/** 配了这些 backend → socai-call exec（非原生 glm subagent）。 */
export const EXTERNAL_EXECUTOR_BACKENDS = ['claude-deepseek', 'cursor', 'codex', 'claude-glm', 'dsh'];

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/** @type {Map<string, import('node:child_process').ChildProcess>} */
const activeChildren = new Set();
let trackChild = (c) => { activeChildren.add(c); };
let untrackChild = (c) => { activeChildren.delete(c); };

export function setChildHooks(hooks = {}) {
  if (hooks.track) trackChild = hooks.track;
  if (hooks.untrack) untrackChild = hooks.untrack;
}

export function killActiveBackendChildren() {
  for (const c of activeChildren) {
    try { c.kill('SIGTERM'); } catch { /* 忽略 */ }
  }
}

/**
 * 读 env：优先 SOCAI_<KEY>，回落 MA_<KEY>（rename 兼容）。
 * key 例：'BACKEND' / 'DEEPSEEK_KEY' / 'CONFIG_HOME' / 'AGENT_BIN_CLAUDE'
 */
export function envGet(key, env = process.env) {
  const s = env[`SOCAI_${key}`];
  if (s !== undefined && s !== '') return s;
  const m = env[`MA_${key}`];
  if (m !== undefined && m !== '') return m;
  return undefined;
}

function yamlQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** dsh 路由：网关 + 模型。key 只走 env，不写进 patch。 */
export function resolveDshRoute(opts = {}, env = process.env) {
  const model = opts.model || envGet('DSH_MODEL', env) || null;
  const baseURL = envGet('DSH_BASE_URL', env) || env.DEEPSEEK_BASE_URL || null;
  const key = envGet('DSH_KEY', env) || envGet('DEEPSEEK_KEY', env) || env.DEEPSEEK_API_KEY || '';
  const tlsInsecure = envGet('DSH_TLS_INSECURE', env) === '1';
  return { model, baseURL, key, tlsInsecure };
}

/** 生成 dsh --patch。自定义网关走 llm-pi-ai openai-completions（DeepSeek 适配器会把 Qwen 流判成 EMPTY_RESPONSE）。 */
export function renderDshRoutePatch({ baseURL, model, models } = {}) {
  const ids = [...new Set([model, ...(models || [])].filter(Boolean))];
  const parts = [];
  if (baseURL) {
    // 有网关却没给 model：钉到 catalog 的 default 条目，否则 aigw provider 注册了却
    // 不会被 agent-default-model 选中，dsh 落回官方 deepseek 适配器（网关白配）。
    const pinned = model || 'default';
    const catalogIds = ids.length ? ids : ['default'];
    const catalog = catalogIds.map((id) => `          - id: ${yamlQuote(id)}`).join('\n');
    parts.push([
      '- id: llm-pi-ai',
      "  name: '@deepseek-ai/dsh-llm-pi-ai'",
      '  config:',
      '    providers:',
      '      aigw:',
      '        displayName: AIGW',
      '        apiKeyEnv: DEEPSEEK_API_KEY',
      '        api: openai-completions',
      `        baseURL: ${yamlQuote(baseURL)}`,
      '        models:',
      catalog,
    ].join('\n'));
    parts.push([
      '- id: agent-default-model',
      '  config:',
      `    provider: aigw`,
      `    model: ${yamlQuote(pinned)}`,
    ].join('\n'));
  } else if (model) {
    parts.push([
      '- id: agent-default-model',
      '  config:',
      '    provider: deepseek-official',
      `    model: ${yamlQuote(model)}`,
    ].join('\n'));
  }
  return parts.join('\n');
}

function writeDshRoutePatch(opts = {}) {
  const route = resolveDshRoute(opts);
  const body = renderDshRoutePatch(route);
  if (!body) return null;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'socai-dsh-route-'));
  const file = path.join(dir, 'route.yml');
  writeFileSync(file, `${body}\n`);
  return file;
}

function resolveBin(id, defaultBin) {
  const up = id.toUpperCase().replace(/-/g, '_');
  return envGet(`AGENT_BIN_${up}`) || defaultBin;
}

function binExists(bin) {
  if (bin.includes('/') || bin.startsWith('.')) return true;
  const r = spawnSync('which', [bin], { encoding: 'utf8' });
  return r.status === 0;
}

function normalizeKimiModel(model) {
  if (!model || model === 'k3') return 'kimi-code/k3';
  return model;
}

/** @returns {Record<string, object>} */
function buildRecords() {
  return {
    claude: {
      id: 'claude',
      bin: 'claude',
      fallback: envGet('FALLBACK') || null,
      args(prompt, opts = {}) {
        const a = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
        if (opts.model) a.push('--model', opts.model);
        return a;
      },
      env() {
        return {};
      },
      autonomyArgs: ['--dangerously-skip-permissions'],
      parseUsage(stdout) {
        return parseClaudeJsonUsage(stdout);
      },
      probePrompt: 'reply exactly: ok',
    },
    kimi: {
      id: 'kimi',
      bin: 'kimi',
      fallback: null,
      args(prompt, opts = {}) {
        // 实证（fix Bug3）：`kimi -p` 与 `--yolo` 互斥（报 "Cannot combine --prompt with --yolo"）；
        // -p headless 单独已非交互自治（probe exit 0 未卡权限），故 args 不加额外自治 flag。
        const a = ['-p', prompt, '-m', normalizeKimiModel(opts.model), '--output-format', 'stream-json'];
        return a;
      },
      env() {
        return {};
      },
      autonomyArgs: [],
      parseUsage() {
        // 实证（fix Bug1）：kimi CLI（-p --output-format stream-json）不暴露 usage——输出仅
        // {"role":"assistant"} + {"role":"meta","type":"session.resume_hint"}，无任何 token 字段。
        // 刻意返 null：spent 记 0 + result.md 标「token 统计缺失」（见 addUsage）。债见 00-master 架构债预算。
        return null;
      },
      probePrompt: 'reply exactly: ok',
    },
    codex: {
      id: 'codex',
      bin: 'codex',
      fallback: null,
      args(prompt, opts = {}) {
        const a = ['exec', prompt, '--dangerously-bypass-approvals-and-sandbox'];
        if (opts.model) a.push('-m', opts.model);
        return a;
      },
      env() {
        return {};
      },
      autonomyArgs: ['--dangerously-bypass-approvals-and-sandbox'],
      parseUsage(stdout) {
        return parseCodexUsage(stdout);
      },
      probePrompt: 'reply exactly: ok',
    },
    cursor: {
      id: 'cursor',
      bin: 'cursor-agent',
      fallback: null,
      args(prompt, opts = {}) {
        // 实证（fix Bug2）：-p -f --trust --output-format stream-json 当前版本 ~3.2s 正常 exit 0，
        // result 事件含真实 usage（inputTokens/outputTokens），无驻留——旧「打印 result 后驻留 ~80s」为过时实证。
        const a = ['-p', prompt, '-f', '--trust', '--output-format', 'stream-json'];
        a.push('--model', opts.model || 'composer-2.5-fast');
        if (opts.readonly) a.push('--mode', opts.readonlyMode || 'ask');
        return a;
      },
      env() {
        return {};
      },
      autonomyArgs: ['-f', '--trust'],
      parseUsage(stdout) {
        return parseCursorJsonUsage(stdout);
      },
      probePrompt: 'reply exactly: ok',
    },
    'claude-glm': {
      id: 'claude-glm',
      bin: 'claude',
      fallback: null,
      harness: true,
      isolateConfig: true, // 3rd-party 端点：spawnOnce 注入空 CLAUDE_CONFIG_DIR（隔离开本机 OAuth）+ 用 ANTHROPIC_API_KEY
      args(prompt, opts = {}) {
        const a = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
        a.push('--model', opts.model || 'glm-4-plus');
        return a;
      },
      env() {
        const token = envGet('GLM_KEY') || process.env.ANTHROPIC_AUTH_TOKEN || '';
        return {
          ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
          ANTHROPIC_API_KEY: token, // 实测：claude CLI 认 API_KEY（x-api-key）才走第三方端点；AUTH_TOKEN 会被 OAuth 盖掉
          ANTHROPIC_AUTH_TOKEN: '',
        };
      },
      autonomyArgs: ['--dangerously-skip-permissions'],
      parseUsage(stdout) {
        return parseClaudeJsonUsage(stdout);
      },
      probePrompt: 'reply exactly: ok',
    },
    'claude-deepseek': {
      id: 'claude-deepseek',
      bin: 'claude',
      fallback: null,
      harness: true,
      isolateConfig: true, // 3rd-party 端点：spawnOnce 注入空 CLAUDE_CONFIG_DIR（隔离开本机 OAuth）+ 用 ANTHROPIC_API_KEY
      args(prompt, opts = {}) {
        const a = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
        a.push('--model', opts.model || 'deepseek-chat');
        return a;
      },
      env() {
        const token = envGet('DEEPSEEK_KEY') || process.env.ANTHROPIC_AUTH_TOKEN || '';
        return {
          ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
          ANTHROPIC_API_KEY: token, // 实测（2026-08-01）：claude CLI 认 API_KEY 才走 deepseek；AUTH_TOKEN 被 OAuth 覆盖→跑 claude-haiku
          ANTHROPIC_AUTH_TOKEN: '',
        };
      },
      autonomyArgs: ['--dangerously-skip-permissions'],
      parseUsage(stdout) {
        return parseClaudeJsonUsage(stdout);
      },
      probePrompt: 'reply exactly: ok',
    },
    dsh: {
      id: 'dsh',
      bin: existsSync(DSH_WRAPPER) ? DSH_WRAPPER : 'dsh',
      fallback: null,
      // OpenAI chat/completions（llm-deepseek），不走 Anthropic / claude CLI
      args(prompt, opts = {}) {
        const a = ['--profile', 'headless'];
        const patch = envGet('DSH_PATCH') || DSH_DISABLE_SUBAGENT_PATCH;
        if (patch && existsSync(patch)) a.push('--patch', patch);
        const extra = envGet('DSH_EXTRA_PATCH');
        if (extra && existsSync(extra)) a.push('--patch', extra);
        if (opts.dshRoutePatch && existsSync(opts.dshRoutePatch)) a.push('--patch', opts.dshRoutePatch);
        // 两层 commander（launcher + headless）：以 --- 开头的 executor.md
        // 会被当成 option。`--` 截断 launcher；前缀挡住内层。
        const task = prompt.startsWith('-') ? `Task:\n${prompt}` : prompt;
        a.push('--', task);
        return a;
      },
      env() {
        const route = resolveDshRoute();
        const token = route.key;
        // 隔离 ~/.dsh/settings.yaml：本机 settings 钉内网网关 + 非默认模型名时，
        // 官方默认 deepseek-v4-flash 会 500。SoCai 用自己的 DSH_HOME。
        const home = envGet('DSH_HOME') || process.env.DSH_HOME
          || path.join(resolveGlobalConfigDir(), 'dsh-home');
        return {
          DEEPSEEK_API_KEY: token,
          DSH_HOME: home,
          ...(route.baseURL ? { DEEPSEEK_BASE_URL: route.baseURL } : {}),
          ...(route.tlsInsecure ? { NODE_TLS_REJECT_UNAUTHORIZED: '0' } : {}),
          // headless 默认 workspace-write 会 ask；exec 必须无人值守
          DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE || 'danger-full-access',
        };
      },
      autonomyArgs: [],
      parseUsage() {
        return null;
      },
      probePrompt: 'reply exactly: ok',
    },
    sparring: {
      id: 'sparring',
      bin: 'sparring',
      fallback: null,
      reviewerOnly: true, // 仅 reviewer：callReviewer 走 runSparringReview，不经 runAgent
      args() { throw new Error('sparring 是 review 工具（仅 reviewer，走 runSparringReview），不可当 executor/triage/planner'); },
      env() { return {}; },
      parseUsage() { return null; },
      probePrompt: '',
    },
  };
}

export const BACKENDS = buildRecords();
export const BACKEND_IDS = Object.keys(BACKENDS);
export const VERIFY_BACKEND_IDS = ['claude', 'kimi', 'codex', 'cursor'];

export function listBackendIds() {
  return BACKEND_IDS;
}

export function resolveBackendId(override) {
  const id = override || envGet('BACKEND') || 'claude';
  if (!BACKENDS[id]) {
    const err = new Error(`未知 backend "${id}"；可用: ${BACKEND_IDS.join(', ')}`);
    err.code = 'UNKNOWN_BACKEND';
    throw err;
  }
  return id;
}

export function buildBackendArgs(id, prompt, opts = {}) {
  const rec = BACKENDS[id];
  if (!rec) throw new Error(`未知 backend: ${id}`);
  return rec.args(prompt, opts);
}

export function buildBackendEnv(id, baseEnv = process.env) {
  const rec = BACKENDS[id];
  if (!rec) throw new Error(`未知 backend: ${id}`);
  const extra = rec.env();
  return { ...baseEnv, ...extra };
}

export function buildBackendAutonomyArgs(id) {
  const rec = BACKENDS[id];
  return rec ? [...(rec.autonomyArgs || [])] : [];
}

function validateHarnessAuth(id) {
  if (id === 'dsh') {
    const hasKey = Boolean(envGet('DSH_KEY') || envGet('DEEPSEEK_KEY') || process.env.DEEPSEEK_API_KEY);
    if (!hasKey) return '缺少 SOCAI_DSH_KEY/SOCAI_DEEPSEEK_KEY/DEEPSEEK_API_KEY';
    return null;
  }
  const rec = BACKENDS[id];
  if (!rec?.harness) return null;
  // deepseek/glm 用专用 key；也认通用 ANTHROPIC_AUTH_TOKEN
  const hasKey = Boolean(
    process.env.ANTHROPIC_AUTH_TOKEN
    || (id === 'claude-deepseek' && envGet('DEEPSEEK_KEY'))
    || (id === 'claude-glm' && envGet('GLM_KEY'))
  );
  if (!hasKey) {
    if (id === 'claude-deepseek') return '缺少 SOCAI_DEEPSEEK_KEY/MA_DEEPSEEK_KEY（或 ANTHROPIC_AUTH_TOKEN）';
    if (id === 'claude-glm') return '缺少 SOCAI_GLM_KEY/MA_GLM_KEY（或 ANTHROPIC_AUTH_TOKEN）';
    return '缺少 ANTHROPIC_AUTH_TOKEN（harness backend 需鉴权）';
  }
  return null;
}

export function assertBackendCallable(id) {
  const authErr = validateHarnessAuth(id);
  if (authErr) {
    const err = new Error(authErr);
    err.code = 'HARNESS_AUTH';
    throw err;
  }
}

export function parseClaudeJsonUsage(text) {
  const raw = String(text).trim();
  if (!raw) return null;
  const lines = raw.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const o = JSON.parse(line);
      const u = o.usage || o.modelUsage?.[Object.keys(o.modelUsage || {})[0]];
      if (!u) continue;
      const input = Number(u.input_tokens ?? u.inputTokens ?? 0);
      const output = Number(u.output_tokens ?? u.outputTokens ?? 0);
      const total = input + output;
      return Number.isFinite(total) && total >= 0 ? total : null;
    } catch {
      /* 继续 */
    }
  }
  try {
    const o = JSON.parse(raw);
    const u = o.usage;
    if (u) {
      const total = Number(u.input_tokens || 0) + Number(u.output_tokens || 0);
      return Number.isFinite(total) ? total : null;
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

/** 从 claude --output-format json 输出提 total_cost_usd（Batch 2.3 成本可观测；其他 backend 无 cost → null）。 */
export function parseClaudeCost(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const pick = (o) => {
    const c = Number(o.total_cost_usd ?? o.totalCostUsd ?? (o.usage && o.usage.cost_usd));
    return Number.isFinite(c) && c > 0 ? c : null;
  };
  for (const line of raw.split('\n').reverse()) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try { const c = pick(JSON.parse(s)); if (c != null) return c; } catch { /* 继续 */ }
  }
  try { const c = pick(JSON.parse(raw)); if (c != null) return c; } catch { /* 整体非 JSON */ }
  return null;
}

export function parseCodexUsage(text) {
  const m = String(text).match(/tokens used\s*\n\s*([\d,]+)/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  const lines = String(text).split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const o = JSON.parse(line);
      const u = o.usage || o.token_usage;
      if (u) {
        const n = Number(u.total_tokens ?? u.total ?? (Number(u.input_tokens || 0) + Number(u.output_tokens || 0)));
        if (Number.isFinite(n)) return n;
      }
    } catch {
      /* 忽略 */
    }
  }
  return null;
}

export function parseCursorJsonUsage(text) {
  let total = null;
  for (const line of String(text).split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      const o = JSON.parse(s);
      if (o.type === 'result' && o.usage) {
        const u = o.usage;
        const n = Number(
          u.total_tokens
          ?? u.totalTokens
          ?? (Number(u.input_tokens || u.inputTokens || 0) + Number(u.output_tokens || u.outputTokens || 0))
        );
        if (Number.isFinite(n) && n > 0) total = n;
      }
      const u = o.usage || o.token_usage || o.metrics;
      if (u && typeof u === 'object') {
        const n = Number(
          u.total_tokens
          ?? u.totalTokens
          ?? (Number(u.input_tokens || u.inputTokens || 0) + Number(u.output_tokens || u.outputTokens || 0))
        );
        if (Number.isFinite(n) && n > 0) total = n;
      }
    } catch {
      /* 忽略 */
    }
  }
  return total;
}

export function extractAgentContent(id, stdout) {
  const raw = String(stdout ?? '');
  if (!raw.trim()) return raw;
  const rec = BACKENDS[id];
  if (!rec) return raw;

  if (id === 'claude' || id === 'claude-glm' || id === 'claude-deepseek') {
    try {
      const o = JSON.parse(raw.trim());
      if (typeof o.result === 'string' && (o.result.includes('##') || o.result.includes('```ma-'))) return o.result;
    } catch {
      /* 非纯 JSON stdout（如 markdown + 尾部 usage 行） */
    }
    const lines = raw.split('\n');
    while (lines.length) {
      const tail = lines[lines.length - 1].trim();
      if (!tail.startsWith('{')) break;
      try {
        JSON.parse(tail);
        lines.pop();
      } catch {
        break;
      }
    }
    const body = lines.join('\n').trimEnd();
    return body || raw;
  }

  if (id === 'kimi') {
    const parts = [];
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s.startsWith('{')) continue;
      try {
        const o = JSON.parse(s);
        if (o.role === 'assistant' && typeof o.content === 'string') parts.push(o.content);
      } catch { /* 忽略 */ }
    }
    const stripTrailingJson = (text) => {
      const lines = text.split('\n');
      while (lines.length) {
        const tail = lines[lines.length - 1].trim();
        if (!tail.startsWith('{')) break;
        try {
          JSON.parse(tail);
          lines.pop();
        } catch {
          break;
        }
      }
      return lines.join('\n').trimEnd();
    };
    const body = stripTrailingJson(raw);
    if (body.includes('##') && !parts.some((p) => p.includes('##'))) return body;
    if (parts.length) return parts.join('\n');
    return body || raw;
  }

  if (id === 'cursor') {
    const parts = [];
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s.startsWith('{')) continue;
      try {
        const o = JSON.parse(s);
        if (o.type === 'assistant' && o.message?.content) {
          for (const c of o.message.content) {
            if (c.type === 'text' && c.text) parts.push(c.text);
          }
        }
        if (o.type === 'result' && typeof o.result === 'string') parts.push(o.result);
      } catch { /* 忽略 */ }
    }
    return parts.length ? parts.join('\n') : raw;
  }

  // codex 与其它：stdout 即文本
  return raw;
}

export function parseBackendUsage(id, stdout) {
  const rec = BACKENDS[id];
  if (!rec) return null;
  return rec.parseUsage(stdout);
}

function resolveFallback(id) {
  const rec = BACKENDS[id];
  const fb = envGet('FALLBACK') || rec?.fallback;
  if (!fb || fb === id) return null;
  if (!BACKENDS[fb]) return null;
  return fb;
}

function spawnOnce(id, prompt, opts = {}) {
  const rec = BACKENDS[id];
  const bin = resolveBin(id, rec.bin);
  let routePatch = null;
  if (id === 'dsh') {
    routePatch = writeDshRoutePatch(opts);
    if (routePatch) opts = { ...opts, dshRoutePatch: routePatch };
  }
  const args = rec.args(prompt, opts);
  const env = buildBackendEnv(id, opts.env || process.env);
  // 3rd-party harness 端点（claude-glm/claude-deepseek，isolateConfig）：注入全新空 CLAUDE_CONFIG_DIR，
  // 隔离开本机 OAuth（否则 claude CLI 用 OAuth 跑 Anthropic，盖掉 ANTHROPIC_BASE_URL）。sparring 技法
  // （bin/sparring:1336-1362）+ 实测（2026-08-01）：空 dir 无 .credentials → claude 认 env 的 API_KEY+BASE_URL。spawn 后清理。
  let cfgDir = null;
  if (rec.isolateConfig) {
    cfgDir = mkdtempSync(path.join(os.tmpdir(), 'socai-cfg-'));
    env.CLAUDE_CONFIG_DIR = cfgDir;
  }
  const cleanupCfg = () => {
    if (cfgDir) { try { rmSync(cfgDir, { recursive: true, force: true }); } catch { /* 忽略 */ } }
    if (routePatch) { try { rmSync(path.dirname(routePatch), { recursive: true, force: true }); } catch { /* 忽略 */ } }
  };
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnOpts = {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_BUFFER,
    timeout,
    env,
  };
  if (opts.cwd) spawnOpts.cwd = opts.cwd;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, spawnOpts);
    trackChild(child);
    let stdout = '';
    let stderr = '';
    // P1-5 心跳：model-call 期间每 N ms 打一行 stderr（破除 stdout 全程静默）+ 调 onTick（executor 用来刷 state.heartbeat）。
    // 子进程结束（close/error）立刻清掉，避免悬挂 timer。间隔 MA_HEARTBEAT_MS 可配（默认 15s；测试压小）。
    const startedAt = Date.now();
    const hbMs = Number(envGet('HEARTBEAT_MS')) || 15_000;
    const tick = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      try { process.stderr.write(`[socai] ${id} running ${elapsed}s stdout=${stdout.length}B\n`); } catch { /* stderr 不可写则静默 */ }
      try { if (opts.onTick) opts.onTick({ elapsed, stdoutBytes: stdout.length }); } catch { /* 心跳自身失败不波及主流程 */ }
    }, hbMs);
    const stopTick = () => clearInterval(tick);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { stopTick(); untrackChild(child); cleanupCfg(); reject(e); });
    child.on('close', (code, signal) => {
      stopTick();
      untrackChild(child);
      cleanupCfg();
      if (code === 0) resolve({ stdout, stderr, backendId: id, bin, args });
      else {
        const msg = signal
          ? `${id} 被 ${signal}`
          : `${id} 退出码 ${code}: ${stderr.slice(0, 400)}`;
        const err = new Error(msg);
        err.code = 'INFRA_FAIL';
        err.stdout = stdout;
        reject(err);
      }
    });
  });
}

async function spawnWithRetry(id, prompt, opts = {}) {
  try {
    return await spawnOnce(id, prompt, opts);
  } catch (e1) {
    try {
      return await spawnOnce(id, prompt, opts);
    } catch {
      throw e1;
    }
  }
}

/**
 * 运行 agent 调用。infra 失败重试 1 次后仍败 → 尝试 fallback。
 * 返回 { stdout, backendId, degraded?, usage }。
 */
export async function runAgent(backendId, prompt, opts = {}) {
  const id = backendId || resolveBackendId();
  const authErr = validateHarnessAuth(id);
  if (authErr) {
    const err = new Error(authErr);
    err.code = 'HARNESS_AUTH';
    throw err;
  }

  const fallback = opts.fallback ?? resolveFallback(id);
  try {
    const r = await spawnWithRetry(id, prompt, opts);
    // usage 可能输出在 stderr（codex 实证：tokens used 走 stderr），合并解析
    const usage = parseBackendUsage(r.backendId, `${r.stdout}\n${r.stderr}`);
    const content = extractAgentContent(r.backendId, r.stdout);
    const costUsd = /claude/.test(r.backendId) ? parseClaudeCost(`${r.stdout}\n${r.stderr}`) : null;
    return { stdout: r.stdout, content, backendId: r.backendId, usage, costUsd };
  } catch (e1) {
    if (!fallback) throw e1;
    const authErr2 = validateHarnessAuth(fallback);
    if (authErr2) throw e1;
    try {
      const r2 = await spawnWithRetry(fallback, prompt, opts);
      const usage = parseBackendUsage(r2.backendId, `${r2.stdout}\n${r2.stderr}`);
      const content = extractAgentContent(r2.backendId, r2.stdout);
      const costUsd = /claude/.test(r2.backendId) ? parseClaudeCost(`${r2.stdout}\n${r2.stderr}`) : null;
      return {
        stdout: r2.stdout,
        content,
        backendId: r2.backendId,
        degraded: `${id}→${fallback}`,
        usage,
        costUsd,
      };
    } catch (e2) {
      throw e1;
    }
  }
}

export async function probeBackend(id, timeoutMs) {
  const rec = BACKENDS[id];
  if (!rec) return { id, ok: false, reason: '未知 backend' };

  const bin = resolveBin(id, rec.bin);
  if (!binExists(bin)) return { id, ok: false, reason: `bin 不存在: ${bin}` };

  const authErr = validateHarnessAuth(id);
  if (authErr) return { id, ok: false, reason: authErr };

  const probeMs = timeoutMs ?? rec.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  try {
    const r = await spawnOnce(id, rec.probePrompt, {
      timeoutMs: probeMs,
      model: id === 'kimi' ? 'kimi-code/k3' : id === 'cursor' ? 'composer-2.5-fast' : undefined,
    });
    const usage = parseBackendUsage(id, `${r.stdout}\n${r.stderr}`);
    const usageNote = usage == null ? '（token 未解析）' : `tokens≈${usage}`;
    return { id, ok: true, reason: `probe ok ${usageNote}` };
  } catch (e) {
    return { id, ok: false, reason: e.message.slice(0, 120) };
  }
}

/**
 * sparring review 外包（Batch 2.2）：spawn `sparring review --title <t>`，stdin = diff + accept 摘要。
 * 退出码语义（sparring review --help 实证）：0=APPROVE / 2=CONCERNS（→ review.pass=false 进重试环）/ 1·超时=INFRA_FAIL（callReviewer fallback）。
 * 返回 { verdict, content }，content 为 socai-result 围栏（兼容 parseResultBlock）。
 */
export async function runSparringReview({ diff, acceptOutput, content, title, timeoutMs }) {
  const bin = envGet('SPARRING_BIN') || resolveBin('sparring', BACKENDS.sparring.bin);
  // content 优先（plan 方案对抗直接传整段 plan.md）；否则按 diff+accept 拼 reviewer 审 diff 的输入
  const body = filterDiffDenylist(content || `## 审查主题\n${title || 'socai review'}\n\n## diff\n${diff || '(空 diff)'}\n\n## 验收输出\n${acceptOutput || '(无)'}`);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['review', '--title', String(title || 'socai review').slice(0, 80)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    trackChild(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { untrackChild(child); reject(e); });
    child.on('close', (code, signal) => {
      untrackChild(child);
      if (code === 0) {
        resolve({ verdict: 'APPROVE', content: wrapSparringResult({ pass: true, rootCauseValid: true, feedback: 'sparring APPROVE' }) });
      } else if (code === 2) {
        resolve({ verdict: 'CONCERNS', content: wrapSparringResult({ pass: false, rootCauseValid: false, feedback: (stdout || 'sparring CONCERNS，未见具体反馈').slice(-500) }) });
      } else {
        const msg = signal ? `sparring 被 ${signal}` : `sparring review exit=${code}: ${(stderr || stdout || '').slice(0, 300)}`;
        const err = new Error(msg);
        err.code = 'INFRA_FAIL';
        reject(err);
      }
    });
    child.stdin.end(body);
  });
}

/** 把 sparring 退出码翻译成 socai-result 围栏（callReviewer 用 parseResultBlock 解析）。 */
function wrapSparringResult(o) {
  return '```socai-result\n' + JSON.stringify(o) + '\n```';
}

/** diff denylist 双保险（sparring 自带一道；ma 侧再剔 lockfile/构建产物/.env/二进制段，防大 diff 跑飞）。 */
export function filterDiffDenylist(text) {
  const DENY = /(lockfile|package-lock|yarn\.lock|pnpm-lock\.yaml|\/dist\/|\/build\/|\/\.next\/|\/\.env\/|\.(png|jpe?g|gif|ico|woff2?|ttf|bin))/i;
  const parts = String(text).split(/\n(?=diff --git )/);
  if (parts.length <= 1) return String(text); // 无 diff 段（纯文本结论）原样返回
  return parts.filter((p) => !DENY.test(p)).join('\n') || String(text);
}

/** sparring verify（Batch 2.2）：调 `sparring verify` 子命令探活（不走 probeBackend，语义不同）。 */
export async function probeSparring(timeoutMs) {
  const bin = envGet('SPARRING_BIN') || resolveBin('sparring', BACKENDS.sparring.bin);
  const probeMs = timeoutMs ?? PROBE_TIMEOUT_MS;
  try {
    const r = await new Promise((resolve, reject) => {
      const child = spawn(bin, ['verify'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: probeMs, maxBuffer: MAX_BUFFER });
      trackChild(child);
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('error', reject);
      child.on('close', (code) => { untrackChild(child); resolve({ code, out }); });
    });
    if (r.code === 0) return { id: 'sparring', ok: true, reason: `verify ok${r.out.trim() ? `: ${r.out.trim().slice(0, 60)}` : ''}` };
    return { id: 'sparring', ok: false, reason: `verify exit=${r.code}: ${r.out.slice(0, 120)}` };
  } catch (e) {
    return { id: 'sparring', ok: false, reason: e.message.slice(0, 120) };
  }
}

export async function verifyAll(ids = VERIFY_BACKEND_IDS) {
  const results = [];
  for (const id of ids) {
    results.push(await probeBackend(id));
  }
  return results;
}

export function renderVerifyTable(results) {
  const w = Math.max(6, ...results.map((r) => r.id.length));
  const lines = [
    `${'backend'.padEnd(w)}  status  reason`,
    `${'-'.repeat(w)}  ------  ------`,
    ...results.map((r) => `${r.id.padEnd(w)}  ${r.ok ? 'ok' : 'fail'}     ${r.reason}`),
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 配置层（Batch 7a）：内置 profile + 四层合并 + I10 过滤 + 掩码
// 层级（低 → 高）：内置默认 profile < 全局 ~/.config/socai/config.json < 项目 .agents/socai.config.json < env/flag
// 角色路由（resolveRoleRouting）+ routing 快照在 7a commit 2 消费本层。
// ---------------------------------------------------------------------------

export const ROLES = ['triage', 'planner', 'executor', 'reviewer'];

/** 家底 profile：四角色默认 (backend, model, fallback)。
 *  executor 默认 claude（非 cursor）：cursor 在 worktree 会自主 git branch/checkout/reset 做
 *  fault-inject，突破 ma 的隔离契约 → ma 收空 diff 误判失败（dogfood 实证）。claude -p 守 prompt 规矩。
 *  cursor 降为 executor fallback 与 triage（探活快）。kimi 做规划与审查。
 *  executor model 钉 haiku：claude 默认（重度 thinking）模型在复杂 plan 上病态过度思考
 *  （dogfood 实证：80s 烧 2388 thinking_tokens、0 Edit）；haiku 守 prompt、90s 内完成外科手术级
 *  改动（7 Edit + 正确文件）。质量由 sparring reviewer 兜。 */
export const DEFAULT_ROUTING = {
  triage:   { backend: 'cursor', model: 'auto', fallback: null },
  planner:  { backend: 'kimi',   model: 'k3',   fallback: null },
  executor: { backend: 'claude', model: 'claude-haiku-4-5-20251001', fallback: 'cursor' },
  reviewer: { backend: 'sparring', model: null,  fallback: 'claude' },
};

/** 国内零外卡 profile：全部国内直连端点（kimi / claude-deepseek / claude-glm harness）。 */
export const CN_ROUTING = {
  triage:   { backend: 'kimi',            model: 'k3', fallback: null },
  planner:  { backend: 'kimi',            model: 'k3', fallback: null },
  executor: { backend: 'claude-deepseek', model: null, fallback: null },
  reviewer: { backend: 'claude-glm',      model: null, fallback: null },
};

export const PROFILES = { default: DEFAULT_ROUTING, cn: CN_ROUTING };

/**
 * 项目配置禁放字段（I10）：backend/model/key/token/secret/auth/roles/各角色名
 * （个人主观项 + secrets）。项目层仅放 timeout/retries/budget/maxParallel 等非主观项（团队共享，入库）。
 */
const SECRET_KEY_RE = /(^|_)(key|token|secret|auth|password)(_|$)/i;

/**
 * I10：项目配置禁放字段判定——主观项（backend/model/roles/角色名，精确匹配）+
 * secrets（key/token/secret/auth/password，包含匹配以捕获 api_key/auth_token/apiKey 等变体）。
 */
function isProjectForbidden(k) {
  const lower = k.toLowerCase();
  if (/^(backend|model|roles|backends|triage|planner|executor|reviewer)$/.test(lower)) return true;
  return /(key|token|secret|auth|password)/.test(lower);
}

/** 全局配置目录：SOCAI_CONFIG_HOME/MA_CONFIG_HOME 覆盖（test 隔离用）；默认 ~/.config/socai，兼容旧 ~/.config/ma。 */
export function resolveGlobalConfigDir() {
  const override = envGet('CONFIG_HOME');
  if (override) return override;
  const preferred = path.join(os.homedir(), '.config', 'socai');
  const legacy = path.join(os.homedir(), '.config', 'ma');
  if (existsSync(path.join(preferred, 'config.json')) || !existsSync(path.join(legacy, 'config.json'))) {
    return preferred;
  }
  return legacy;
}

export function resolveGlobalConfigPath() {
  return path.join(resolveGlobalConfigDir(), 'config.json');
}

export function resolveProjectConfigPath(repoRoot) {
  const preferred = path.join(repoRoot, '.agents', 'socai.config.json');
  const legacy = path.join(repoRoot, '.agents', 'ma.config.json');
  if (existsSync(preferred) || !existsSync(legacy)) return preferred;
  return legacy;
}

/**
 * I10：过滤项目配置禁放字段。返回 { cleaned, warned }。
 * 禁放字段 → 忽略 + onWarn 警告；其余（timeout/budget/maxParallel/retries）保留。
 */
export function filterProjectConfig(raw, onWarn) {
  const cleaned = {};
  const warned = [];
  for (const [k, v] of Object.entries(raw || {})) {
    if (isProjectForbidden(k)) warned.push(k);
    else cleaned[k] = v;
  }
  if (warned.length && onWarn) {
    onWarn(`项目配置 .agents/socai.config.json 禁放字段已忽略（I10：backend/model/key/roles 归个人全局配置，不入库）: ${warned.join(', ')}`);
  }
  return { cleaned, warned };
}

/** 递归掩码敏感字段（含 key/token/secret/auth/password 的字符串值 → '***'）。供 config show 输出。 */
export function maskSecrets(obj, depth = 0) {
  if (depth > 10 || obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => maskSecrets(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v && SECRET_KEY_RE.test(k)) out[k] = '***';
    else out[k] = maskSecrets(v, depth + 1);
  }
  return out;
}

/**
 * 合并四层配置 → { profile, roles, backends, timeout, retries, budget, maxParallel }。
 * 优先级：内置 profile（基底）< 全局 roles/backends < 项目 timeout/budget/... < env SOCAI_/MA_<ROLE>_BACKEND/MODEL。
 * projectConfig 须先经 filterProjectConfig（I10）。
 */
export function mergeConfigLayers({ profile = 'default', globalConfig = {}, projectConfig = {}, env = {} }) {
  const base = PROFILES[profile] || DEFAULT_ROUTING;
  const roles = {};
  for (const r of ROLES) {
    const gRole = globalConfig.roles && globalConfig.roles[r];
    roles[r] = { ...base[r], ...(gRole || {}) };
  }
  for (const r of ROLES) {
    const up = r.toUpperCase();
    const eb = envGet(`${up}_BACKEND`, env);
    const em = envGet(`${up}_MODEL`, env);
    if (eb) roles[r].backend = eb;
    if (em) roles[r].model = em;
  }
  return {
    profile,
    roles,
    backends: globalConfig.backends || {},
    timeout: { ...(globalConfig.timeout || {}), ...(projectConfig.timeout || {}) },
    retries: projectConfig.retries ?? globalConfig.retries,
    budget: projectConfig.budget ?? globalConfig.budget,
    maxParallel: projectConfig.maxParallel ?? globalConfig.maxParallel,
  };
}

/** 解析角色 flag `backend[:model]` → { backend, model }；空 → null。 */
export function parseRoleFlag(spec) {
  if (!spec) return null;
  const idx = spec.indexOf(':');
  if (idx === -1) return { backend: spec, model: null };
  return { backend: spec.slice(0, idx), model: spec.slice(idx + 1) || null };
}

/**
 * 解析四角色 routing 三元组 { backend, model, fallback }（Batch 7a-2）。
 * backend 优先级：角色 flag > env SOCAI_BACKEND/MA_BACKEND（全局覆写）> env SOCAI_/MA_<ROLE>_BACKEND > 配置层（默认 profile < 全局 < 项目）。
 * model 优先级：flag model > globalModel（--model）> 配置层 model。
 * backend 不在 BACKENDS → 抛 UNKNOWN_BACKEND。
 */
/**
 * backend → 模型族（跨模型 review 铁律：executor 与 reviewer 须异族，同族 = theater）。
 * claude-glm 与原生会话 glm（socai-executor/reviewer subagent）同属 glm 族。
 * claude（Anthropic 原生）与 claude-glm（智谱 harness）异族。
 */
export function backendFamily(backendId) {
  switch (backendId) {
    case 'claude-glm': return 'glm';
    case 'claude-deepseek': return 'deepseek';
    case 'dsh': return 'dsh';
    case 'cursor': return 'cursor';
    case 'codex': return 'codex';
    case 'kimi': return 'kimi';
    case 'claude': return 'claude';
    case 'sparring': return 'sparring';
    default: return backendId || null;
  }
}

/** 原生 socai-executor/reviewer subagent（未配外部 backend）= glm 会话模型族。 */
export const NATIVE_SESSION_FAMILY = 'glm';

/** 两 backend 是否同模型族（theater 风险）。nativeExecutor=true 表示 executor 走原生 subagent（glm 族）。 */
export function isSameModelFamily(executorBackend, reviewerBackend, { nativeExecutor = false } = {}) {
  const ef = nativeExecutor ? NATIVE_SESSION_FAMILY : backendFamily(executorBackend);
  const rf = backendFamily(reviewerBackend);
  if (!ef || !rf) return false;
  return ef === rf;
}

/**
 * 从子 plan 正文抽第一处 `^risk: high$` / `^risk: low$`（派写手信号；不是审稿信号）。
 * @returns {'high'|'low'|null}
 */
export function extractRiskField(md) {
  const m = String(md || '').match(/^risk:\s*(high|low)\s*$/m);
  return m ? m[1] : null;
}

export function resolveRouting({ flags = {}, globalModel = null, profile = 'default', globalConfig = {}, projectConfig = {}, env = {}, risk = null } = {}) {
  const merged = mergeConfigLayers({ profile, globalConfig, projectConfig, env });
  const globalBackend = envGet('BACKEND', env) || null; // design §8「换 vendor 最轻开关」：覆写全部角色（flag 仍优先）
  if (globalBackend && !BACKENDS[globalBackend]) {
    const err = new Error(`SOCAI_BACKEND/MA_BACKEND "${globalBackend}" 不存在；可用: ${BACKEND_IDS.join(', ')}`);
    err.code = 'UNKNOWN_BACKEND';
    throw err;
  }
  const routing = {};
  for (const role of ROLES) {
    const base = merged.roles[role];
    const flag = parseRoleFlag(flags[role]);
    if (flag && flag.backend && !BACKENDS[flag.backend]) {
      const err = new Error(`角色 ${role} 的 backend "${flag.backend}" 不存在；可用: ${BACKEND_IDS.join(', ')}`);
      err.code = 'UNKNOWN_BACKEND';
      throw err;
    }
    routing[role] = {
      backend: (flag && flag.backend) || globalBackend || base.backend,
      model: (flag && flag.model) || globalModel || base.model,
      fallback: envGet('FALLBACK', env) || base.fallback || null,
    };
  }
  // 派写手：仅认 risk: high + 可选 roles.executor_high_risk；未配不强停，仍用默认 executor。
  if (risk === 'high') {
    const override = globalConfig.roles?.executor_high_risk;
    if (override && override.backend) {
      if (!BACKENDS[override.backend]) {
        const err = new Error(`roles.executor_high_risk backend "${override.backend}" 不存在；可用: ${BACKEND_IDS.join(', ')}`);
        err.code = 'UNKNOWN_BACKEND';
        throw err;
      }
      routing.executor = {
        backend: override.backend,
        model: override.model != null ? override.model : routing.executor.model,
        fallback: override.fallback !== undefined ? override.fallback : routing.executor.fallback,
      };
    }
  }
  return routing;
}
