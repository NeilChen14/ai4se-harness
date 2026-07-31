import { describe, expect, it } from 'vitest';
import { FeedbackClassifier } from '../../src/feedback/classifier.js';
import type { ToolResult } from '../../src/types.js';

const cls = new FeedbackClassifier();
const r = (over: Partial<ToolResult>): ToolResult => ({ ok: false, output: '', exitCode: 1, error: 'x', ...over });

describe('FeedbackClassifier', () => {
  it('classifies passing tests as PASS', () => {
    expect(cls.classify('run_tests', { ok: true, output: '# pass 1', exitCode: 0 })).toMatchObject({ category: 'PASS' });
  });
  it('classifies failing tests as TEST_FAILURE', () => {
    expect(cls.classify('run_tests', r({ output: 'FAIL', error: '1 failing' })).category).toBe('TEST_FAILURE');
  });
  it('classifies typecheck failure as COMPILE_ERROR', () => {
    expect(cls.classify('run_typecheck', r({ error: 'error TS1000: x' })).category).toBe('COMPILE_ERROR');
  });
  it('classifies lint failure as LINT_ERROR', () => {
    expect(cls.classify('run_lint', r({})).category).toBe('LINT_ERROR');
  });
  it('classifies timeout as TIMEOUT', () => {
    expect(cls.classify('run_command', { ok: false, output: '', exitCode: null, error: 'timed out' }).category).toBe('TIMEOUT');
  });
  it('classifies other failures as OTHER', () => {
    expect(cls.classify('read_file', r({ error: 'ENOENT' })).category).toBe('OTHER');
  });
});
