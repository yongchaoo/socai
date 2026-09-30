// smoke.json 断言强度自检（WEAK_SMOKE）—— 纯函数模块，可被 run-smoke.mjs 与单测安全 import。
//
// 防「路径可达」式弱 smoke：交互 smoke 只验终点元素存在、不验交互后的状态，
// 抓不到「选对却标红」「选项不能改选」这类语义/控件 bug（见 docs/problems/token-agent-game-ma-v3-blind-gap.md）。
// gate 层只判断言强度；语义矛盾/控件范式由 reviewer（异模型 + 对抗清单）补，本模块不试图判语义。

// html 含「候选选择元素」（可点选项）：data-i= / class 含 opt|strat|choice|option / role=radio|option
const HTML_CANDIDATE_RE = /data-i\s*=|class\s*=\s*"[^"]*\b(opt|strat|choice|option)\b|role\s*=\s*['"]?(radio|option)/i;
// html 含「对/错反馈 class」：picked-ok / picked-bad / class 含 sel|wrong / correct|incorrect
const HTML_FEEDBACK_RE = /picked-ok|picked-bad|class\s*=\s*"[^"]*\b(sel|wrong)\b"|correct|incorrect/i;
// smoke 的 click selector 指向候选：[data-i] / .opt / .strat / .choice / .option / [role=radio|option]
const CANDIDATE_SEL_RE = /data-i|\.opt\b|\.strat\b|\.choice\b|\.option\b|\[role\s*=\s*['"]?radio|\[role\s*=\s*['"]?option/i;

/** html 是否「选择类产物」（同时含候选元素 + 对/错反馈 class）。 */
export function isChoiceApp(html) {
  return HTML_CANDIDATE_RE.test(String(html)) && HTML_FEEDBACK_RE.test(String(html));
}

/**
 * 断言强度自检。
 * @param {{steps?: any[], forbidPatterns?: string[]}} spec  smoke.json 解析对象
 * @param {string} html  产物 HTML 源码
 * @param {{ allowWeak?: boolean }} opts  allowWeak=true 直接放行（逃生口）
 * @returns {{ weak: false } | { weak: true, code: 'WEAK_SMOKE', layer: 'L1'|'L2', reason: string }}
 */
export function lintSmoke(spec, html, { allowWeak = false } = {}) {
  if (allowWeak) return { weak: false };
  const steps = Array.isArray(spec && spec.steps) ? spec.steps : [];

  const hasMustNotExist = steps.some((s) => Array.isArray(s.mustNotExist) && s.mustNotExist.length > 0);
  const clickSteps = steps.filter((s) => typeof s.click === 'string');
  const hasClickWithAssert = clickSteps.some(
    (s) => s.mustExist || s.mustNotExist || s.mustCount || s.expect || s.eval
  );

  // L2：选择类产物 + smoke click 候选 + 无 mustNotExist（对抗断言）→ 抓「选对却标红」类漏检。
  // mustNotExist 是对抗断言的标准形式（验「坏反馈未出现」，如选对的候选不应带 picked-bad）；
  // 只 mustExist（验「好发生」）抓不到「文案对、颜色错」。复刻 15942ae 的强断言契约。
  if (isChoiceApp(html) && clickSteps.some((s) => CANDIDATE_SEL_RE.test(s.click)) && !hasMustNotExist) {
    return {
      weak: true,
      code: 'WEAK_SMOKE',
      layer: 'L2',
      reason:
        '选择类产物（候选元素 + 对/错反馈 class）的 smoke 须含至少一条 mustNotExist（对抗断言：验「坏反馈未出现」，如 .picked-bad 不应出现在选对的候选上）；只 mustExist 验「好发生」抓不到「选对却标红」。逃生口 ALLOW_WEAK_SMOKE=1。',
    };
  }

  // L1：有 click 但所有 click 步骤均无 post-action 断言 → 纯导航/终点偷懒。
  if (clickSteps.length > 0 && !hasClickWithAssert) {
    return {
      weak: true,
      code: 'WEAK_SMOKE',
      layer: 'L1',
      reason: 'smoke 所有 click 步骤均无 post-action 断言（mustExist/mustNotExist/mustCount），属纯导航无验证。',
    };
  }

  return { weak: false };
}
