import { AppError } from '../../lib/errors.js';
import { streamLines } from '../../lib/http-client.js';
import type { GenerateInput, LlmProvider } from './provider.js';

export class OllamaChat implements LlmProvider {
  readonly name: string;

  constructor(private readonly opts: { baseUrl: string; model: string }) {
    this.name = `ollama:${opts.model}`;
  }

  async *stream({ messages, signal }: GenerateInput): AsyncGenerator<string> {
    const res = await fetch(`${this.opts.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.opts.model,
        messages,
        stream: true,
        options: { temperature: 0.2 },
      }),
      signal,
    });

    if (!res.ok) {
      throw AppError.upstream(
        `Ollama request failed (${res.status})`,
        await res.text().catch(() => ''),
      );
    }

    for await (const line of streamLines(res)) {
      try {
        const frame = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
        if (frame.message?.content) yield frame.message.content;
        if (frame.done) return;
      } catch {
        // Skip malformed frames.
      }
    }
  }
}
