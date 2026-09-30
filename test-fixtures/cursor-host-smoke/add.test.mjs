import assert from 'node:assert/strict';
import test from 'node:test';
import { add } from './add.mjs';

test('add positive numbers', () => {
  assert.equal(add(2, 3), 5);
});

test('add negative and boundary values', () => {
  assert.equal(add(-2, -3), -5);
  assert.equal(add(0, 0), 0);
});
