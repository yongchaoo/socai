// impl 内联在 test 文件 — FAIL_TO_PASS 无法 revert 实现，gate 须 fail-loud
import assert from 'node:assert/strict';
import test from 'node:test';

export function add(a, b) {
  return a + b;
}

test('add works', () => {
  assert.equal(add(1, 2), 3);
});
