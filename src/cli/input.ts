import { createInterface } from 'node:readline';

export function readHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const out = process.stdout;
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = function (s: string) {
    if (s === '\r\n' || s === '\n') { out.write(s); return; }
    out.write('*'.repeat(s.length));
  };
  return new Promise(resolve => rl.question('', (answer) => { rl.close(); resolve(answer); }));
}

export function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, (answer) => { rl.close(); resolve(answer); }));
}
