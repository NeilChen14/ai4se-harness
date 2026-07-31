import { describe, expect, it } from 'vitest';
import { MockLLM } from '../../src/llm/mock.js';

describe('MockLLM', () => {
  it('replays scripted responses in order', async () => {
    const llm = new MockLLM(['first', 'second']);
    expect((await llm.complete([])).content).toBe('first');
    expect((await llm.complete([])).content).toBe('second');
  });
  it('calls function scripts with message history', async () => {
    const seen: string[] = [];
    const llm = new MockLLM([(messages) => { seen.push(messages.map(m => m.content).join('|')); return 'x'; }]);
    await llm.complete([{ role: 'user', content: 'task' }]);
    expect(seen[0]).toContain('task');
  });
  it('fails clearly when scripts are exhausted', async () => {
    const llm = new MockLLM(['only']);
    await llm.complete([]);
    await expect(llm.complete([])).rejects.toThrow(/exhausted/);
  });
});
