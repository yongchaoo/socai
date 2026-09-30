import assert from 'node:assert/strict';
import test from 'node:test';
import { add } from './impl.mjs';

test('add works', () => {
  assert.equal(add(1, 2), 3);
});
