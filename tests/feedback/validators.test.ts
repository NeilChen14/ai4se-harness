import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScopeFence } from '../../src/governance/scope.js';
import { ProcessExecutor } from '../../src/governance/executor.js';
import { runTests, makeParseFileValidator } from '../../src/feedback/validators.js';

function ctx(dir: string) {
  return { scope: new ScopeFence([dir]), executor: new ProcessExecutor(), workdir: dir };
}

describe('validators', () => {
  it('runTests detects a failing node:test file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-val-'));
    writeFileSync(join(dir, 'x.test.js'), `const { test } = require('node:test'); const assert = require('node:assert'); test('fails', () => assert.strictEqual(1, 2));`);
    const res = await runTests(ctx(dir));
    expect(res.ok).toBe(false);
  });
  it('makeParseFileValidator asserts file content predicate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4se-val-'));
    writeFileSync(join(dir, 'a.js'), 'export function f() {}');
    const ok = await makeParseFileValidator(new ScopeFence([dir]), 'a.js', (c) => c.includes('function f'));
    expect(ok.ok).toBe(true);
    const bad = await makeParseFileValidator(new ScopeFence([dir]), 'a.js', (c) => c.includes('function g'));
    expect(bad.ok).toBe(false);
  });
});
