// Mock life-kb search CLI for bug-memory tests (plain node, no tsx).

const SSE_ENTRY = {
  id: 'sse-1',
  content: `---
paradigm_class: sse-lifecycle
trigger_keywords: [eventsource, sse, reconnect, stream]
---
SSE 连接断开后须自动重连；勿在 onerror 里直接 close 而不 backoff。`,
  category: 'procedure',
  score: 0.92,
  source: 'fts',
};

const LEGACY_CONTROL = {
  id: 'ctrl-1',
  content: '选择控件：radio/option 变更后须即时反馈；禁止锁死已选项不可改（coffee-quiz 教训）。',
  category: 'procedure',
  score: 0.85,
  source: 'fts',
};

function normQuery(q) {
  return q.toLowerCase().replace(/\s+or\s+/g, ' ');
}

function matchesAny(q, words) {
  const n = normQuery(q);
  return words.some((w) => n.includes(w.toLowerCase()));
}

function search(query, categories, limit) {
  const q = normQuery(query);
  const hits = [];

  if (
    matchesAny(q, ['eventsource', 'sse', 'reconnect', 'stream']) ||
    q.includes('sse-lifecycle')
  ) {
    hits.push(SSE_ENTRY);
  }

  if (
    matchesAny(q, [
      'choice',
      'select',
      'radio',
      'option',
      'change',
      'lock',
      'paradigm',
      'quiz',
      'widget',
      'control-paradigm',
    ])
  ) {
    hits.push(LEGACY_CONTROL);
  }

  if (
    matchesAny(q, ['paradigm_class', 'trigger_keywords', 'procedure scan']) ||
    q.includes('__paradigm_scan__')
  ) {
    hits.push(SSE_ENTRY);
    hits.push(LEGACY_CONTROL);
  }

  const catSet = new Set(categories);
  return hits
    .filter((h) => catSet.size === 0 || catSet.has(h.category))
    .slice(0, limit);
}

function formatText(hits) {
  if (hits.length === 0) return '(no hits)';
  return hits.map((h) => `- [${h.score.toFixed(3)} ${h.source}] ${h.content}`).join('\n');
}

async function run(argv = process.argv.slice(2)) {
  const positional = [];
  let limit = 5;
  let format = 'json';
  const categories = [];

  for (const a of argv) {
    if (a.startsWith('--limit=')) limit = Number.parseInt(a.slice('--limit='.length), 10) || 5;
    else if (a.startsWith('--category=')) categories.push(a.slice('--category='.length));
    else if (a.startsWith('--format=')) {
      const f = a.slice('--format='.length);
      if (f === 'text' || f === 'json') format = f;
    } else if (!a.startsWith('-')) positional.push(a);
  }

  const query = positional.join(' ').trim();
  if (!query) {
    console.error('search: no query provided');
    process.exitCode = 1;
    return;
  }

  const hits = search(query, categories, limit);
  if (format === 'text') {
    process.stdout.write(`${formatText(hits)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(hits)}\n`);
  }
}

run();
