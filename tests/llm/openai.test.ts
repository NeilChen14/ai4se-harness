import { describe, expect, it } from 'vitest';
import { OpenAICompatClient } from '../../src/llm/openai.js';

function fakeFetch(content: string) {
  return async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'cmpl-1', choices: [{ message: { content: `${content}:${body.model}:${body.messages.length}` } }] }),
    } as unknown as Response;
  };
}

describe('OpenAICompatClient', () => {
  it('posts chat/completions with bearer auth and returns content', async () => {
    const client = new OpenAICompatClient({
      baseURL: 'https://example.test/v1', apiKey: 'k-test', model: 'm-1', fetchImpl: fakeFetch('echo'),
    });
    const res = await client.complete([{ role: 'user', content: 'hi' }]);
    expect(res.content).toBe('echo:m-1:1');
    expect(res.id).toBe('cmpl-1');
  });
  it('retries on 5xx up to maxRetries', async () => {
    let calls = 0;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      calls += 1;
      if (calls < 3) return { ok: false, status: 500 } as unknown as Response;
      return fakeFetch('echo')('', init) as Promise<Response>;
    };
    const client = new OpenAICompatClient({
      baseURL: 'https://example.test/v1', apiKey: 'k', model: 'm', maxRetries: 3, fetchImpl,
    });
    await expect(client.complete([])).resolves.toMatchObject({ content: 'echo:m:0' });
    expect(calls).toBe(3);
  });
});
