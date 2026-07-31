import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { deriveKey, encrypt, decrypt, Encrypted } from './crypto.js';

export class SecretError extends Error {
  constructor(m: string) { super(m); this.name = 'SecretError'; }
}

interface FileShape {
  version: number; kdf: 'scrypt'; salt: string;
  check: Encrypted; entries: Record<string, Encrypted>;
}

export class SecretStore {
  private key: Buffer | null = null;
  constructor(private readonly filePath: string) {}

  async isInitialized(): Promise<boolean> { return existsSync(this.filePath); }

  private async requireKey(): Promise<Buffer> {
    if (!this.key) throw new SecretError('store is locked; call unlock() or init() first');
    return this.key;
  }

  private load(): FileShape {
    if (!existsSync(this.filePath)) throw new SecretError('secret file not found; run init() first');
    return JSON.parse(readFileSync(this.filePath, 'utf8')) as FileShape;
  }

  private save(shape: FileShape): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(shape, null, 2), { mode: 0o600 });
  }

  async init(masterPassword: string): Promise<void> {
    if (existsSync(this.filePath)) throw new SecretError('already initialized');
    const salt = randomBytes(16);
    const key = await deriveKey(masterPassword, salt);
    const check = encrypt(key, 'ok');
    this.save({ version: 1, kdf: 'scrypt', salt: salt.toString('base64'), check, entries: {} });
    this.key = key;
  }

  async unlock(masterPassword: string): Promise<void> {
    const shape = this.load();
    const salt = Buffer.from(shape.salt, 'base64');
    const key = await deriveKey(masterPassword, salt);
    try {
      decrypt(key, shape.check);
    } catch {
      throw new SecretError('wrong master password');
    }
    this.key = key;
  }

  async set(name: string, value: string): Promise<void> {
    const key = await this.requireKey();
    const shape = this.load();
    shape.entries[name] = encrypt(key, value);
    this.save(shape);
  }

  async get(name: string): Promise<string | null> {
    const key = await this.requireKey();
    const shape = this.load();
    const e = shape.entries[name];
    if (!e) return null;
    try { return decrypt(key, e); } catch { throw new SecretError('decryption failed'); }
  }

  async unset(name: string): Promise<void> {
    await this.requireKey();
    const shape = this.load();
    delete shape.entries[name];
    this.save(shape);
  }

  async list(): Promise<Array<{ name: string; masked: string }>> {
    const key = await this.requireKey();
    const shape = this.load();
    return Object.entries(shape.entries).map(([name, e]) => {
      const v = decrypt(key, e);
      return { name, masked: `••••${v.slice(-4)}` };
    });
  }
}
