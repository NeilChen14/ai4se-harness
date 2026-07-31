export function splitCommand(cmd: string): string[] {
  const out: string[] = [];
  const cur: string[] = [];
  let quote: '"' | "'" | null = null;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur.push(ch);
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur.length) { out.push(cur.join('')); cur.length = 0; }
    } else {
      cur.push(ch);
    }
  }
  if (quote) throw new Error('unterminated quote in command');
  if (cur.length) out.push(cur.join(''));
  return out;
}
