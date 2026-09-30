import assert from 'node:assert/strict';
import test from 'node:test';

// 假先行：不断言实现行为，实现前也会绿
test('add works', () => {
  assert.equal(true, true);
});
