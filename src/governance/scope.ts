import { realpathSync, existsSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { platform } from 'node:os';

export class ScopeViolationError extends Error {
  constructor(target: string) {
    super(`path is outside the allowed scope: ${target}`);
    this.name = 'ScopeViolationError';
  }
}

const isWin = platform() === 'win32';

export class ScopeFence {
  private readonly canonicalRoots: string[];

  constructor(roots: string[]) {
    this.canonicalRoots = roots.map(r => {
      const abs = isAbsolute(r) ? r : resolve(r);
      return existsSync(abs) ? realpathSync(abs) : abs;
    });
  }

  getRoots(): string[] { return [...this.canonicalRoots]; }

  resolve(target: string): string {
    const abs = isAbsolute(target) ? target : resolve(this.canonicalRoots[0], target);
    const canon = existsSync(abs) ? realpathSync(abs) : abs;
    const norm = (p: string) => (isWin ? p.toLowerCase() : p);
    const ok = this.canonicalRoots.some(root => {
      const base = norm(root.endsWith(sep) ? root : root + sep);
      return norm(canon) === norm(root) || norm(canon).startsWith(base);
    });
    if (!ok) throw new ScopeViolationError(target);
    return canon;
  }
}
