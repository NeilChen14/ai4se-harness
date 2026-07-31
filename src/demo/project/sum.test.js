import { test } from 'node:test';
import assert from 'node:assert';
import { sum } from './sum.js';

test('sum(1, 2) === 3', () => {
  assert.strictEqual(sum(1, 2), 3);
});
