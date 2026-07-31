import type { LLMClient, LLMMessage, LLMResult } from './client.js';
import { FormatError } from './decode.js';

export type MockScript = string | ((messages: LLMMessage[]) => string);

export class MockLLM implements LLMClient {
  private i = 0;
  constructor(private readonly scripts: MockScript[]) {}
  async complete(messages: LLMMessage[]): Promise<LLMResult> {
    const script = this.scripts[this.i++];
    if (script === undefined) throw new FormatError('mock scripts exhausted');
    const content = typeof script === 'function' ? script(messages) : script;
    return { content, id: `mock-${this.i}` };
  }
}
