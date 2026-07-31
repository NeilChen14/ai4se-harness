import type { LLMClient, LLMMessage, LLMResult } from './client.js';

export interface OpenAICompatOptions {
  baseURL: string; apiKey: string; model: string;
  timeoutMs?: number; maxRetries?: number; fetchImpl?: typeof fetch;
}

export class OpenAICompatClient implements LLMClient {
  constructor(private readonly opts: OpenAICompatOptions) {}

  async complete(messages: LLMMessage[], opts?: { signal?: AbortSignal }): Promise<LLMResult> {
    const { baseURL, apiKey, model, maxRetries = 3, fetchImpl = fetch } = this.opts;
    const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
    let last: Error = new Error('llm request failed');
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages }),
        signal: opts?.signal,
      });
      if (!res.ok) { last = new Error(`llm http ${res.status}`); continue; }
      const data = (await res.json()) as { id: string; choices: Array<{ message: { content: string } }> };
      return { content: data.choices[0]?.message?.content ?? '', id: data.id };
    }
    throw last;
  }
}
