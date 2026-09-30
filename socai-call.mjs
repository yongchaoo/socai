#!/usr/bin/env node
/**
 * socai-call — v3 多模型薄壳入口（v2 /ma skill 也用 plan-review）。
 *
 * 复用 socai-backends.mjs 的 runAgent / resolveRouting（I9：spawn 收敛单点，不重造）。
 * 三条命令，对应 v3 里需要 shell-out 到外部模型的三个角色：
 *  - plan-review：强模型按 lt-review plan 的 15 维审计划（v2/v3 通用）。
 *  - diff-review：强模型对抗式审一批 git diff（v3 高风险批次 review）。
 *  - exec：spawn 外部 executor backend（claude-deepseek/cursor/codex/claude-glm）跑一个 batch
 *    prompt 文件——v3 external-executor 模式。与原生 socai-executor subagent 二选一（编排者按
 *    ~/.config/socai/config.json 的 roles.executor 决定走哪条）。
 *
 * 为什么 exec 也走这里：runAgent 已支持 opts.cwd + claude-deepseek/cursor 等 backend 自带
 * --dangerously-skip-permissions（工具权限），executor 复用同一 spawn 单点，不重造。
 *
 * 用法：
 *   node socai-call.mjs plan-review <master.md> [spec.md...] [--timeout=600]
 *   node socai-call.mjs diff-review <base> <head> [--timeout=600]
 *   node socai-call.mjs exec <prompt-file> [--timeout=3600]
 * 退出码：0=结果在 stdout（编排者读）/ 1=模型挂了（降级建议在 stderr）/ 2=参数/配置错
 * stdout/stderr 分离：结果走 stdout，心跳/降级日志走 stderr；编排者只读 stdout，勿 2>&1。
 *
 * 默认超时：exec=3600；plan-review / diff-review=600（审稿不跟 exec 一起拉长）。
 */
import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  resolveRouting, runAgent,
  resolveGlobalConfigPath, resolveProjectConfigPath, filterProjectConfig, envGet,
  NATIVE_SESSION_FAMILY, backendFamily, extractRiskField,
  EXTERNAL_EXECUTOR_BACKENDS,
} from './socai-backends.mjs';

/** 无 --timeout 时的默认秒数：exec 3600，审稿命令 600。 */
export function defaultTimeoutSec(cmd) {
  return cmd === 'exec' ? 3600 : 600;
}

/** 原生 executor 模式：未配外部 backend（deepseek/cursor/codex/claude-glm/dsh）→ glm 会话 subagent。 */
export function isNativeExecutorMode(env = process.env) {
  if (envGet('EXECUTOR_BACKEND', env)) return false;
  const globalConfig = loadJsonSafe(resolveGlobalConfigPath()) || {};
  const eb = globalConfig.roles?.executor?.backend;
  if (!eb) return true;
  return !EXTERNAL_EXECUTOR_BACKENDS.includes(eb);
}

/** 同族 theater 告警（非阻塞）：stderr 显眼提示 + 返回 true 供报告头 THEATER_RISK=1。 */
export function warnTheaterRisk(executorRt, reviewerRt, err, { nativeExecutor = false } = {}) {
  const eb = executorRt?.backend;
  const rb = reviewerRt?.backend;
  if (!rb) return false;
  const ef = nativeExecutor ? NATIVE_SESSION_FAMILY : backendFamily(eb);
  const rf = backendFamily(rb);
  if (!ef || !rf || ef !== rf) return false;
  // 同一 dsh harness、两个不同 model（如 GLM vs Qwen）算跨模型，不是 theater
  if (eb === 'dsh' && rb === 'dsh') {
    const em = executorRt?.model;
    const rm = reviewerRt?.model;
    if (em && rm && em !== rm) return false;
  }
  const execLabel = nativeExecutor ? 'native-glm' : eb;
  err.write(`⚠️ 同模型 theater 风险:executor=${execLabel} reviewer=${rb}\n`);
  return true;
}

/** plan/diff review 报告是否含 CONCERNS（verdict 行或 blocker 清单）。 */
export function reportHasConcerns(report) {
  const t = String(report || '');
  return /CONCERNS/i.test(t) || /verdict.*❌/i.test(t) || /blocker/i.test(t);
}

/** 读 JSON 文件，失败返回 null（socai.mjs 的 loadJsonSafe 在 socai-backends 未 export，本地实现）。 */
function loadJsonSafe(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** git 仓库根（非 git repo 返回 null，跳过项目 config）。用 node 内置 spawnSync，零依赖（I1）。 */
function findRepoRoot() {
  try {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout) return null;
    return r.stdout.trim();
  } catch { return null; }
}

/**
 * 加载某角色的 routing 三元组 { backend, model, fallback }。
 * 复用 socai-backends 的 resolveRouting（四层配置：默认 profile < 全局 < 项目(I10 剔主观) < env）。
 * executor 可传 risk（'high'|'low'|null）：high 且配了 roles.executor_high_risk 才升级写手。
 */
export function loadRouting(role, { env = process.env, cwd, risk = null } = {}) {
  const globalConfig = loadJsonSafe(resolveGlobalConfigPath()) || {};
  const repoRoot = cwd !== undefined ? cwd : findRepoRoot();
  let projectConfig = {};
  if (repoRoot) {
    const raw = loadJsonSafe(resolveProjectConfigPath(repoRoot)) || {};
    projectConfig = filterProjectConfig(raw).cleaned; // I10：剔 backend/model/roles/key
  }
  const profile = globalConfig.profile || 'default';
  const routing = resolveRouting({ flags: {}, globalModel: null, profile, globalConfig, projectConfig, env, risk });
  return routing[role];
}

/** lt-review plan 的 15 维关键词（出处：.claude/skills/lt-review/SKILL.md:88-107）。用于覆盖自检。 */
export const PLAN_REVIEW_DIMS = [
  '依赖顺序', '验收点', '批次大小', '范围清晰度', '遗漏依赖',
  '架构层归属', 'Invariant', '半完成态', '回滚', '根因',
  '契约', 'Spec 同步', '否决方案', '现状拓扑', '对抗式',
];

/**
 * 拼 plan-review prompt：锚定 lt-review plan 的 15 维模板原文，要求逐行对应。
 * 不强求强模型吐结构化 JSON（易漂移），只要 markdown 维度覆盖即可。
 */
export function buildPlanReviewPrompt(masterPath, specPaths = []) {
  const master = readFileSync(masterPath, 'utf8');
  const specs = specPaths.length
    ? specPaths.map((p) => `--- ${p} ---\n${readFileSync(p, 'utf8')}`).join('\n\n')
    : '(无子 plan)';
  return [
    '你是计划审核者。审核以下总纲 + 子 plan，严格按下方 15 维输出 markdown 报告。',
    '立场：假设计划有问题，找证据推翻或坐实；禁止把「写得详细」当「通过」。',
    '',
    '## 总纲', master,
    '',
    '## 子 plan', specs,
    '',
    '## 输出要求（逐行对应，缺维度写 N/A(理由)，不新增维度，只输出报告无 preamble）',
    '计划审核：<总纲路径> + <子plan>',
    '- 依赖顺序：✅ / ❌（哪批有问题）',
    '- 验收点可观测性：✅ / ❌（哪些批次模糊）',
    '- 批次大小：✅ / ❌（哪批太大）',
    '- 范围清晰度：✅ / ❌',
    '- 遗漏依赖：✅ / ❌（漏了什么）',
    '- 架构层归属：✅ / ❌（哪批横跨多层）',
    '- Invariant 可验证：✅ / ❌（哪些是废话）',
    '- 半完成态可发布：✅ / ❌（哪批不可发布）',
    '- 回滚边界：✅ / ❌（哪批连锁）',
    '- 根因/症状比例：✅ / ❌（占比 X%，超 40% 回炉）',
    '- 契约绑定：✅ / ❌',
    '- Spec 同步：✅ / ❌（哪批缺 spec 同步字段）',
    '- 否决方案(ADR)：✅ / ❌',
    '- 现状拓扑：✅ / ❌',
    '- 对抗式退出条件：✅ / ❌',
    '- 结论：通过 / 需修订（具体建议）',
    '- 下一步：通过 → /lt-execute；需修订 → 回 /lt-plan',
    '',
    '只输出这份报告。',
  ].join('\n');
}

/** lt-review diff 的审核维度关键词（用于覆盖自检）。 */
export const DIFF_REVIEW_DIMS = ['严重 bug', '边界', '安全', '测试覆盖', '半完成', 'verdict'];

/**
 * 截断超长 diff（防压垮强模型）；超 maxLines 只取前段并标注。
 * batch diff 理论上有界（每批小），这是安全网。
 */
export function capDiff(diffText, maxLines = 500) {
  const lines = String(diffText || '').split('\n');
  if (lines.length <= maxLines) return lines.join('\n');
  return lines.slice(0, maxLines).join('\n') +
    `\n\n…（diff 截断：${lines.length - maxLines} 行未显示，强模型只审前 ${maxLines} 行；完整 diff 走 git 自查）`;
}

/**
 * 拼 diff-review prompt：对抗式审一批 git diff，找 bug/边界/安全/逻辑错。
 * 与 plan-review 平行，但维度是 diff 维（不是计划维度）。
 */
export function buildDiffReviewPrompt(diffText, baseRef, headRef) {
  return [
    '你是 diff 审核者。对抗式审核以下 git diff，找 bug / 边界 / 安全 / 逻辑错。',
    '立场：假设有问题，找证据；禁止把「能跑」当「通过」。',
    '',
    `## diff（${baseRef}..${headRef}）`,
    diffText,
    '',
    '## 输出要求（markdown，逐行对应，缺项写 N/A(理由)，不新增维度，只输出报告）',
    `diff 审核：${baseRef}..${headRef}`,
    '- 严重 bug（逻辑错/崩溃/数据损坏）：✅ / ❌（file:line + 问题）',
    '- 边界 / 异常路径：✅ / ❌',
    '- 安全（注入/鉴权/泄漏）：✅ / ❌',
    '- 测试覆盖：✅ / ❌（改了行为却没测？）',
    '- 半完成 / 遗漏：✅ / ❌',
    '- verdict：APPROVE / CONCERNS（blocker 清单）',
    '',
    '只输出这份报告。',
  ].join('\n');
}

/** 维度覆盖自检：<threshold/总维度 则追加 ⚠️ 警告 + 原文回吐（不卡死、不强解）。 */
export function coverageWarn(report, { dims = PLAN_REVIEW_DIMS, threshold = 12 } = {}) {
  const hit = dims.filter((d) => String(report || '').includes(d)).length;
  if (hit >= threshold) return '';
  return `\n\n⚠️ 强模型输出维度不全(${hit}/${dims.length})，报告原文见上；建议重跑或回退会话模型 /lt-review 审。`;
}

/**
 * 去尾部 JSON 行（kimi 的 meta / claude 的 usage 残留）。
 * extractAgentContent 对「纯文本报告 + 尾随换行 + JSON 行」场景可能残留尾部 JSON（末尾空行使 pop 提前 break）；
 * socai-call 兜底清理，保证给编排者的报告无 JSON 噪音。对真实 kimi（parts 路径已干净）无副作用。
 */
export function stripTrailingJsonLines(text) {
  const lines = String(text || '').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  while (lines.length) {
    const tail = lines[lines.length - 1].trim();
    if (!tail.startsWith('{')) break;
    try { JSON.parse(tail); lines.pop(); } catch { break; }
  }
  return lines.join('\n');
}

/**
 * 主入口。返回退出码（不直接 process.exit，便于单测）。
 * @param {string[]} argv 默认 process.argv.slice(2)
 * @param {object} hooks 测试注入：env / cwd / stdout / stderr
 */
export async function main(argv = process.argv.slice(2), hooks = {}) {
  const env = hooks.env || process.env;
  const out = hooks.stdout || process.stdout;
  const err = hooks.stderr || process.stderr;
  const cwd = hooks.cwd;

  const [cmd, ...rest] = argv;
  if (cmd !== 'plan-review' && cmd !== 'diff-review' && cmd !== 'exec') {
    err.write('用法: node socai-call.mjs plan-review <master.md> [spec.md...] | diff-review <base> <head> | exec <prompt-file> [--timeout=3600]\n');
    return 2;
  }
  const opts = rest.filter((f) => !f.startsWith('--'));
  const timeoutArg = rest.find((f) => f.startsWith('--timeout'));
  const timeoutSec = timeoutArg ? Number(timeoutArg.split('=')[1]) : defaultTimeoutSec(cmd);
  if (!Number.isFinite(timeoutSec)) {
    err.write('用法: node socai-call.mjs plan-review <master.md> [spec.md...] | diff-review <base> <head> | exec <prompt-file> [--timeout=3600]\n');
    return 2;
  }
  const riskArg = rest.find((f) => f.startsWith('--risk='));
  const riskFlag = riskArg ? riskArg.split('=')[1] : null;
  const risk = riskFlag === 'high' || riskFlag === 'low' ? riskFlag : null;

  // exec：spawn 外部 executor backend（claude-deepseek/dsh/cursor/codex/claude-glm）跑一个 batch prompt 文件。
  // 与原生 socai-executor subagent 二选一；编排者按 roles.executor 决定是否调本命令。无 coverageWarn（执行非审核）。
  if (cmd === 'exec') {
    if (opts.length < 1) {
      err.write('用法: node socai-call.mjs exec <prompt-file>\n');
      return 2;
    }
    const [promptFile] = opts;
    let execPrompt;
    try {
      execPrompt = readFileSync(promptFile, 'utf8');
    } catch (e) {
      err.write(`[socai-call] 读 prompt 文件失败: ${e.message}\n`);
      return 2;
    }
    // --risk= 优先；否则从 prompt 文件抽 ^risk:（编排者也可把子 plan 拼进 prompt）
    const riskResolved = risk || extractRiskField(execPrompt);
    const rt = loadRouting('executor', { env, cwd, risk: riskResolved });
    if (!rt || !rt.backend) {
      err.write('[socai-call] executor 未配置。原生路径用 socai-executor subagent；外部路径在 ~/.config/socai/config.json 配 roles.executor={backend:"claude-deepseek"|...}\n');
      return 2;
    }
    if (rt.backend === 'sparring') {
      err.write('[socai-call] executor 配成 sparring（仅 reviewer）；换成 claude-deepseek/dsh/cursor/codex/claude-glm/claude。\n');
      return 1;
    }
    try {
      const r = await runAgent(rt.backend, execPrompt, {
        model: rt.model, fallback: null, // exec 不 fallback：配置的 executor 失败应干净报错（让编排者 fixer/escalation 处理），
        // 不静默换模型（如 claude-deepseek 401 → fallback cursor → cursor 自主 git 挂起）。profile 的 fallback 在此忽略。
        timeoutMs: timeoutSec * 1000,
        cwd: cwd || process.cwd(),
      });
      const summary = (r.content || '').trim();
      if (!summary) {
        err.write(`[socai-call] ${rt.backend} 返回空内容（可能超时或无响应）。\n`);
        return 1;
      }
      out.write(summary + '\n');
      if (r.degraded) err.write(`[socai-call] 降级 ${r.degraded}\n`);
      return 0;
    } catch (e) {
      err.write(`[socai-call] ${rt.backend} 失败: ${e.message}\n`);
      return 1;
    }
  }

  // 按命令拼 prompt + 选覆盖维度（plan-review / diff-review 共享）
  let prompt;
  let dims;
  if (cmd === 'plan-review') {
    if (opts.length < 1) {
      err.write('用法: node socai-call.mjs plan-review <master.md> [spec.md...]\n');
      return 2;
    }
    const [master, ...specs] = opts;
    try {
      prompt = buildPlanReviewPrompt(master, specs);
    } catch (e) {
      err.write(`[socai-call] 读计划文件失败: ${e.message}\n`);
      return 2;
    }
    dims = PLAN_REVIEW_DIMS;
  } else {
    // diff-review：跑 git diff <base> <head>，截断，拼 prompt
    if (opts.length < 2) {
      err.write('用法: node socai-call.mjs diff-review <base> <head>\n');
      return 2;
    }
    const [base, head] = opts;
    const g = spawnSync('git', ['diff', base, head], { encoding: 'utf8', cwd: cwd || process.cwd() });
    if (g.status !== 0) {
      err.write(`[socai-call] git diff ${base} ${head} 失败 (exit ${g.status}): ${(g.stderr || '').trim() || '(无 stderr)'}\n`);
      return 2;
    }
    const diffText = capDiff(g.stdout);
    if (!diffText.trim()) {
      err.write(`[socai-call] diff ${base}..${head} 为空（无改动或 ref 不存在）。\n`);
      return 2;
    }
    prompt = buildDiffReviewPrompt(diffText, base, head);
    dims = DIFF_REVIEW_DIMS;
  }

  const rt = loadRouting('reviewer', { env, cwd });
  const execRt = loadRouting('executor', { env, cwd });
  const theaterRisk = warnTheaterRisk(execRt, rt, err, { nativeExecutor: isNativeExecutorMode(env) });

  // sparring 是审 diff 的 exit-code 协议（runSparringReview CONCERNS 会 .slice(-500) 截断），
  // 不吐长 markdown 报告；plan-review/diff-review 需长推理 backend。要 exit-code 式审 diff 直接调 sparring。
  if (rt.backend === 'sparring') {
    err.write('[socai-call] reviewer 配成 sparring（仅 exit-code 协议，长报告会被截断）；plan-review/diff-review 需长推理 backend。\n');
    err.write('把 ~/.config/socai/config.json 的 roles.reviewer.backend 改成 kimi/claude，或 SOCAI_REVIEWER_BACKEND=kimi（或 MA_REVIEWER_BACKEND）。\n');
    return 1;
  }

  try {
    const r = await runAgent(rt.backend, prompt, {
      model: rt.model, fallback: rt.fallback, timeoutMs: timeoutSec * 1000,
    });
    const report = stripTrailingJsonLines(r.content || '').trim();
    if (!report) {
      err.write(`[socai-call] ${rt.backend} 返回空内容（进程成功但无输出，可能超时截断或模型无响应）。\n`);
      err.write('降级建议：编排者改用会话模型按 /lt-review 流程审（SKILL.md 现有路径）。\n');
      return 1;
    }
    const threshold = cmd === 'plan-review' ? 12 : 4;
    const theaterHeader = (theaterRisk && reportHasConcerns(report)) ? 'THEATER_RISK=1\n' : '';
    out.write(theaterHeader + report + coverageWarn(report, { dims, threshold }) + '\n');
    if (r.degraded) err.write(`[socai-call] 降级 ${r.degraded}\n`);
    return 0;
  } catch (e) {
    err.write(`[socai-call] ${rt.backend} 失败: ${e.message}\n`);
    err.write('降级建议：编排者改用会话模型按 /lt-review 流程审（SKILL.md 现有路径）。\n');
    return 1;
  }
}

// realpathSync：经 symlink 调用（~/.local/bin/socai-call → 此文件）时 argv[1] 是软链路径、
// import.meta.url 是真实路径，不等会让 main 不跑（静默 exit 0 无输出）。解软链后再比。
const isMain = (() => { try { return process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; } })();
if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(`[socai-call] 未捕获: ${e.stack || e.message}`);
    process.exit(1);
  });
}
