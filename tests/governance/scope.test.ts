import { describe, expect, it } from 'vitest';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScopeFence, ScopeViolationError } from '../../src/governance/scope.js';

function makeRoot(): string { return mkdtempSync(join(tmpdir(), 'ai4se-scope-')); }

describe('ScopeFence', () => {
  it('resolves a path inside the root', () => {
    const root = makeRoot();
    const f = new ScopeFence([root]);
    expect(f.resolve('a/b.txt').startsWith(f.getRoots()[0])).toBe(true);
  });
  it('rejects parent traversal', () => {
    const root = makeRoot();
    const f = new ScopeFence([root]);
    expect(() => f.resolve('../outside.txt')).toThrow(ScopeViolationError);
  });
  it('rejects absolute paths outside the root', () => {
    const root = makeRoot();
    const f = new ScopeFence([root]);
    expect(() => f.resolve(join(tmpdir(), 'elsewhere.txt'))).toThrow(ScopeViolationError);
  });
  it('rejects symlink escaping the root when symlinks are supported', () => {
    const outside = makeRoot();
    const root = makeRoot();
    const link = join(root, 'escape');
    try {
      symlinkSync(outside, link, 'junction');
    } catch {
      return; // 平台/权限不允许时跳过
    }
    const f = new ScopeFence([root]);
    expect(() => f.resolve('escape')).toThrow(ScopeViolationError);
  });
});
