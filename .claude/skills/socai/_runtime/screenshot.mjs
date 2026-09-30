#!/usr/bin/env node
/**
 * 可选 Playwright 截图 — 缺 playwright 时打印 skip 指引。
 * Usage: node screenshot.mjs <url-or-file> <out.png>
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [target, outPath] = process.argv.slice(2);
if (!target || !outPath) {
  console.log('用法: node screenshot.mjs <url-or-file> <out.png>');
  console.log('skip：未安装 playwright 时运行 `(cd _runtime && npm i playwright)` 后重试');
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('skip：playwright 未安装。可选：cd .claude/skills/socai/_runtime && npm i playwright');
  process.exit(0);
}

const url = existsSync(target) ? pathToFileURL(target).href : target;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`✓ screenshot → ${outPath}`);
} finally {
  await browser.close();
}
