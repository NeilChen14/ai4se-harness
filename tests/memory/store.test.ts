import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../../src/memory/store.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'ai4se-mem-')), 'mem.jsonl');

describe('MemoryStore', () => {
  it('adds and persists entries', async () => {
    const p = file();
    const m = new MemoryStore(p);
    await m.add('project-convention', 'use vitest not jest', ['testing']);
    const m2 = new MemoryStore(p);
    const all = await m2.all();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('use vitest not jest');
  });
  it('queries by kind and keywords', async () => {
    const m = new MemoryStore(file());
    await m.add('project-convention', 'use vitest', ['testing']);
    await m.add('task-decision', 'prefer async/await', ['style']);
    const byKind = await m.query({ kind: 'task-decision' });
    expect(byKind).toHaveLength(1);
    const byKw = await m.query({ keywords: ['vitest'] });
    expect(byKw[0].kind).toBe('project-convention');
  });
  it('summary returns only recent contents, not full dump', async () => {
    const m = new MemoryStore(file());
    await m.add('task-decision', 'AAA', []);
    await m.add('task-decision', 'BBB', []);
    const s = await m.summary(1);
    expect(s).toContain('BBB');
    expect(s).not.toContain('AAA');
  });
  it('empty store summary is empty string', async () => {
    expect(await new MemoryStore(file()).summary()).toBe('');
  });
});
