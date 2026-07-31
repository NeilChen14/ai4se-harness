import { describe, expect, it } from 'vitest';
import { decodeAction, FormatError } from '../../src/llm/decode.js';

describe('decodeAction', () => {
  it('parses a valid action', () => {
    const a = decodeAction('{"tool":"run_command","args":{"command":"npm test"}}');
    expect(a.tool).toBe('run_command');
    expect(a.args.command).toBe('npm test');
  });
  it('throws FormatError on invalid JSON', () => {
    expect(() => decodeAction('not json')).toThrow(FormatError);
  });
  it('throws FormatError when tool is missing', () => {
    expect(() => decodeAction('{"args":{}}')).toThrow(FormatError);
  });
});
