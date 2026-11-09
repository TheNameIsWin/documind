import { AppError } from '../../lib/errors.js';
import { streamLines } from '../../lib/http-client.js';
import type { GenerateInput, LlmProvider } from './provider.js';

/** Works with OpenAI and any OpenAI-compatible API (Groq, Together, LM Studio, vLLM…). */
export class OpenAIChat implements LlmProvider {
  readonly name: string;

  constructor(private readonly opts: { apiKey: string; baseUrl: string; model: string }) {
    this.name = `openai:${opts.model}`;
  }

  async *stream({ messages, signal }: GenerateInput): AsyncGenerator<string> {
    const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({ model: this.opts.model, messages, stream: true, temperature: 0.2 }),
      signal,
    });

    if (!res.ok) {
      throw AppError.upstream(
        `LLM request failed (${res.status})`,
        await res.text().catch(() => ''),
      );
    }

    for await (const line of streamLines(res)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch {
        // Ignore keep-alive or partial frames.
      }
    }
  }
}
