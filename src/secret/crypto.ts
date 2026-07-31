import { randomBytes, scrypt as scryptCb, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number, o: object) => Promise<Buffer>;

export const N = 16384, R = 8, P = 1;
export async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return scrypt(password, salt, 32, { N, r: R, p: P });
}
export interface Encrypted { ct: string; iv: string; }
export function encrypt(key: Buffer, plain: string): Encrypted {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return { ct: Buffer.concat([enc, tag]).toString('base64'), iv: iv.toString('base64') };
}
export function decrypt(key: Buffer, e: Encrypted): string {
  const iv = Buffer.from(e.iv, 'base64');
  const buf = Buffer.from(e.ct, 'base64');
  const enc = buf.subarray(0, buf.length - 16);
  const tag = buf.subarray(buf.length - 16);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
