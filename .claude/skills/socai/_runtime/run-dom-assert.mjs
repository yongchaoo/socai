#!/usr/bin/env node
/**
 * jsdom DOM 断言 — 加载 HTML（执行 script），按 selectors.json 断言。
 * Usage: node run-dom-assert.mjs <htmlPath> <selectors.json>
 * exit 0 = 全过；exit 1 + EXPECTED/ACTUAL
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const [htmlPath, selectorsPath] = process.argv.slice(2);
if (!htmlPath || !selectorsPath) {
  console.error('用法: node run-dom-assert.mjs <htmlPath> <selectors.json>');
  process.exit(2);
}

const html = readFileSync(htmlPath, 'utf8');
const spec = JSON.parse(readFileSync(selectorsPath, 'utf8'));

const mustExist = spec.mustExist || [];
const mustCount = spec.mustCount || {};

if (mustExist.length === 0 && Object.keys(mustCount).length === 0) {
  console.error('DOM assert 失败：selectors 为空占位（须填 mustExist 或 mustCount）');
  process.exit(1);
}

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
const { window } = dom;
// jsdom 不自动触发 onload；单文件 HTML fixture 依赖 window.onload 渲染
if (typeof window.onload === 'function') {
  window.onload({ target: window });
} else {
  window.dispatchEvent(new window.Event('load'));
}
const doc = window.document;

for (const sel of mustExist) {
  const el = doc.querySelector(sel);
  if (!el) {
    console.error(`DOM assert 失败`);
    console.error(`EXPECTED=selector "${sel}" exists in document`);
    console.error(`ACTUAL=not found`);
    process.exit(1);
  }
}

for (const [sel, minCount] of Object.entries(mustCount)) {
  const nodes = doc.querySelectorAll(sel);
  const count = nodes.length;
  const min = Number(minCount);
  if (count < min) {
    console.error(`DOM assert 失败`);
    console.error(`EXPECTED=at least ${min} elements matching "${sel}"`);
    console.error(`ACTUAL=found ${count}`);
    process.exit(1);
  }
}

console.log('✓ DOM assert 通过');
