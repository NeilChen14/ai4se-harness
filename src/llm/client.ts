export interface LLMMessage { role: 'system' | 'user' | 'assistant'; content: string; }
export interface LLMResult { content: string; id: string; }
export interface LLMClient {
  complete(messages: LLMMessage[], opts?: { signal?: AbortSignal }): Promise<LLMResult>;
}
