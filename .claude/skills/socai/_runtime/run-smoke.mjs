#!/usr/bin/env node
/**
 * 交互 smoke — jsdom 加载 HTML，执行 setup/click，再断言。
 * 防「只验静态 selector」偷懒；交互型前端应走本脚本而非纯 run-dom-assert。
 *
 * Usage: node run-smoke.mjs <htmlPath> <smoke.json>
 *
 * smoke.json:
 * {
 *   "forbidPatterns": ["banned-substring-in-source"],
 *   "steps": [
 *     { "eval": "window.__TEST__.go(1)" },
 *     { "click": "#ok-btn", "mustExist": [".ok"], "mustNotExist": ["#ok-btn.bad"] },
 *     // 选择类（候选 .strat/.opt/[data-i] + 对/错反馈 class）必须用 mustNotExist 写对抗断言：
 *     { "click": ".strat[data-i='1']", "mustExist": [".strat.picked-ok"], "mustNotExist": [".strat.picked-bad"] }
 *   ]
 * }
 *
 * 断言强度自检（WEAK_SMOKE）：跑 steps 前先 lintSmoke(spec, html)。
 *   L1：所有 click 步骤均无 post-action 断言（mustExist/mustNotExist/mustCount）→ 纯导航偷懒。
 *   L2：选择类产物（html 同时含「候选元素」+「对/错反馈 class」）且 smoke click 了候选，
 *       却无任何 mustNotExist（对抗断言：验「坏反馈未出现」）→ 抓不到「选对却标红」类语义错。
 *   逃生口：ALLOW_WEAK_SMOKE=1（纯导航/展示型 fixture）。详见 lintSmoke。
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { lintSmoke } from './lint-smoke.mjs';

const [htmlPath, smokePath] = process.argv.slice(2);
if (!htmlPath || !smokePath) {
  console.error('用法: node run-smoke.mjs <htmlPath> <smoke.json>');
  process.exit(2);
}

const html = readFileSync(htmlPath, 'utf8');
const spec = JSON.parse(readFileSync(smokePath, 'utf8'));
const steps = spec.steps || [];
if (steps.length === 0) {
  console.error('smoke 失败：steps 为空（交互 smoke 不可占位）');
  process.exit(1);
}

const hasInteraction = steps.some((s) => s.click || s.eval);
if (!hasInteraction) {
  console.error('smoke 失败：steps 无 click/eval（纯 mustExist = 静态偷懒，请用交互步骤）');
  process.exit(1);
}

for (const pat of spec.forbidPatterns || []) {
  if (html.includes(pat)) {
    console.error('smoke 失败：产物含禁止模式（测试专用捷径污染产品）');
    console.error(`EXPECTED=源码不含 "${pat}"`);
    console.error('ACTUAL=found');
    process.exit(1);
  }
}

// 断言强度自检（WEAK_SMOKE）：跑 steps 前先验，弱则拒（防「路径可达」式弱 smoke 漏抓语义错）
const lint = lintSmoke(spec, html, { allowWeak: process.env.ALLOW_WEAK_SMOKE === '1' });
if (lint.weak) {
  console.error('smoke 失败：断言强度不足');
  console.error(`CODE=${lint.code}`);
  console.error(`LAYER=${lint.layer}`);
  console.error(`EXPECTED=交互后状态断言（mustNotExist 验坏反馈未出现 等）`);
  console.error(`ACTUAL=${lint.reason}`);
  process.exit(1);
}

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'https://ma.local/smoke' });
const { window } = dom;
if (typeof window.onload === 'function') {
  window.onload({ target: window });
} else {
  window.dispatchEvent(new window.Event('load'));
}
const doc = window.document;

function fail(expected, actual) {
  console.error('smoke 失败');
  console.error(`EXPECTED=${expected}`);
  console.error(`ACTUAL=${actual}`);
  process.exit(1);
}

for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  const tag = `step[${i}]`;

  if (step.eval) {
    try {
      window.eval(step.eval);
    } catch (e) {
      fail(`${tag} eval ok: ${step.eval}`, `threw: ${e.message}`);
    }
  }

  if (step.click) {
    const el = doc.querySelector(step.click);
    if (!el) fail(`${tag} click target "${step.click}" exists`, 'not found');
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  for (const sel of step.mustExist || []) {
    if (!doc.querySelector(sel)) fail(`${tag} selector "${sel}" exists`, 'not found');
  }

  for (const sel of step.mustNotExist || []) {
    if (doc.querySelector(sel)) fail(`${tag} selector "${sel}" absent`, 'found');
  }

  for (const [sel, minCount] of Object.entries(step.mustCount || {})) {
    const n = doc.querySelectorAll(sel).length;
    const min = Number(minCount);
    if (n < min) fail(`${tag} at least ${min} × "${sel}"`, `found ${n}`);
  }
}

console.log('✓ smoke 通过');
