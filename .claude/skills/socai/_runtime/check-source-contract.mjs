#!/usr/bin/env node
/**
 * check-source-contract — SoCai 合同门（法官在 SoCai，不在目标仓测试）。
 * Usage: node check-source-contract.mjs <子plan.md> <目标仓根>
 * Exit 0 = 全等或跳过；非 0 = 拒（打印两侧 token / 缺声明）。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [, , specPath, targetRoot] = process.argv;
if (!specPath || !targetRoot) {
  process.stderr.write('usage: check-source-contract.sh <子plan.md> <目标仓根>\n');
  process.exit(2);
}

const spec = readFileSync(specPath, 'utf8');
const root = path.resolve(targetRoot);

function fieldLine(re) {
  const m = spec.match(re);
  return m ? m[1].trim() : '';
}

const risk = fieldLine(/^risk:\s*(.+)$/m);
const tagsRaw = fieldLine(/^tags:\s*(.+)$/m);
const tags = tagsRaw
  .split(/[,/\s]+/)
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);

const hasContractNone = /^contract:\s*none\b/m.test(spec);
const hasContractList = /^contract:\s*$/m.test(spec) || /^contract:\s*\n\s*-/m.test(spec);

function parseContracts(text) {
  const items = [];
  if (hasContractNone || !hasContractList) return items;

  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    if (!/^contract:\s*$/.test(lines[i]) && !/^contract:\s*-/.test(lines[i])) {
      i += 1;
      continue;
    }
    i += 1;
    let cur = null;
    while (i < lines.length) {
      const line = lines[i];
      if (/^[a-zA-Z0-9_-]+:/.test(line) && !/^\s/.test(line)) break;
      const kindM = line.match(/^\s*-\s*kind:\s*(\S+)\s*$/);
      if (kindM) {
        if (cur) items.push(cur);
        cur = { kind: kindM[1], files: [] };
        i += 1;
        continue;
      }
      if (!cur) {
        i += 1;
        continue;
      }
      const jsM = line.match(/^\s+js:\s*(.+)\s*$/);
      if (jsM) {
        cur.js = jsM[1].trim();
        i += 1;
        continue;
      }
      const rustM = line.match(/^\s+rust:\s*(.+)\s*$/);
      if (rustM) {
        cur.rust = rustM[1].trim();
        i += 1;
        continue;
      }
      const needleM = line.match(/^\s+needle:\s*(.+)\s*$/);
      if (needleM) {
        let n = needleM[1].trim();
        if ((n.startsWith('"') && n.endsWith('"')) || (n.startsWith("'") && n.endsWith("'"))) {
          n = n.slice(1, -1);
        }
        cur.needle = n;
        i += 1;
        continue;
      }
      if (/^\s+files:\s*$/.test(line)) {
        i += 1;
        while (i < lines.length) {
          const fm = lines[i].match(/^\s+-\s+(.+)\s*$/);
          if (!fm) break;
          cur.files.push(fm[1].trim());
          i += 1;
        }
        continue;
      }
      i += 1;
    }
    if (cur) items.push(cur);
    break;
  }
  return items;
}

const contracts = parseContracts(spec);

if (contracts.length === 0 && !hasContractNone) {
  const needsDeclare = risk === 'high' && tags.includes('tauri');
  if (needsDeclare) {
    process.stderr.write(
      'source-contract: risk: high + tags 含 tauri，须声明 contract: 列表或 contract: none（附理由）\n',
    );
    process.exit(1);
  }
  process.stdout.write('source-contract: skip (no contract:)\n');
  process.exit(0);
}

if (hasContractNone && contracts.length === 0) {
  process.stdout.write('source-contract: skip (contract: none)\n');
  process.exit(0);
}

function sortedSet(arr) {
  return [...new Set(arr)].sort();
}

function equalSets(a, b) {
  const aa = sortedSet(a);
  const bb = sortedSet(b);
  return aa.length === bb.length && aa.every((x, i) => x === bb[i]);
}

function extractInvokeNames(jsText) {
  const out = [];
  const re = /invoke\s*\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(jsText))) out.push(m[1]);
  return out;
}

function extractCommandFns(rustText) {
  const out = [];
  const re = /#\[tauri::command\][\s\S]*?\b(?:async\s+)?fn\s+(\w+)/g;
  let m;
  while ((m = re.exec(rustText))) out.push(m[1]);
  return out;
}

function mustRead(rel) {
  const p = path.join(root, rel);
  if (!existsSync(p)) {
    process.stderr.write(`source-contract: missing file: ${rel}\n`);
    process.exit(1);
  }
  return readFileSync(p, 'utf8');
}

let failed = false;
for (const c of contracts) {
  if (c.kind === 'tauri-command') {
    if (!c.js || !c.rust) {
      process.stderr.write('source-contract: tauri-command 须有 js: 与 rust:\n');
      failed = true;
      continue;
    }
    const jsNames = extractInvokeNames(mustRead(c.js));
    const rustNames = extractCommandFns(mustRead(c.rust));
    if (!equalSets(jsNames, rustNames)) {
      failed = true;
      process.stderr.write('source-contract: tauri-command mismatch\n');
      process.stderr.write(`  js:   ${sortedSet(jsNames).join(', ') || '(empty)'}\n`);
      process.stderr.write(`  rust: ${sortedSet(rustNames).join(', ') || '(empty)'}\n`);
    }
  } else if (c.kind === 'same-literal') {
    if (!c.needle || !c.files?.length) {
      process.stderr.write('source-contract: same-literal 须有 needle: 与 files:\n');
      failed = true;
      continue;
    }
    for (const f of c.files) {
      const text = mustRead(f);
      if (!text.includes(c.needle)) {
        failed = true;
        process.stderr.write(`source-contract: same-literal missing needle in ${f}\n`);
        process.stderr.write(`  needle: ${c.needle}\n`);
      }
    }
  } else {
    process.stderr.write(`source-contract: unknown kind: ${c.kind} (v1 仅 tauri-command|same-literal)\n`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
