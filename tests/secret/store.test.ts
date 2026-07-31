import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretStore, SecretError } from '../../src/secret/store.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ai4se-sec-'));
const pw = 'correct-horse-battery';

describe('SecretStore', () => {
  it('round-trips set/get with correct master password', async () => {
    const p = join(dir(), 'secrets.json');
    const s = new SecretStore(p);
    await s.init(pw);
    await s.set('openai', 'sk-abc12345');
    expect(await s.get('openai')).toBe('sk-abc12345');
    const s2 = new SecretStore(p);
    await s2.unlock(pw);
    expect(await s2.get('openai')).toBe('sk-abc12345');
  });
  it('rejects wrong master password on unlock', async () => {
    const p = join(dir(), 'secrets.json');
    const s = new SecretStore(p);
    await s.init(pw);
    await s.set('openai', 'sk-abc12345');
    const s2 = new SecretStore(p);
    await expect(s2.unlock('wrong-password')).rejects.toThrow(SecretError);
  });
  it('does not store plaintext on disk', async () => {
    const p = join(dir(), 'secrets.json');
    const s = new SecretStore(p);
    await s.init(pw);
    await s.set('openai', 'sk-abc12345');
    const raw = readFileSync(p, 'utf8');
    expect(raw).not.toContain('sk-abc12345');
  });
  it('masks values in list()', async () => {
    const p = join(dir(), 'secrets.json');
    const s = new SecretStore(p);
    await s.init(pw);
    await s.set('openai', 'sk-abc12345');
    const [entry] = await s.list();
    expect(entry.masked).toContain('2345'); // 末4位，符合 SPEC "••••末4位"
    expect(entry.masked).not.toContain('abc');
  });
  it('unset removes entry', async () => {
    const p = join(dir(), 'secrets.json');
    const s = new SecretStore(p);
    await s.init(pw);
    await s.set('openai', 'sk-x');
    await s.unset('openai');
    expect(await s.get('openai')).toBeNull();
  });
  it('isInitialized reflects file existence', async () => {
    const p = join(dir(), 'secrets.json');
    expect(await new SecretStore(p).isInitialized()).toBe(false);
  });
});
