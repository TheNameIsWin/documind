import { fetchJson } from '../../lib/http-client.js';
import { inBatches, l2normalize, type EmbeddingProvider } from './provider.js';

export class OpenAIEmbeddings implements EmbeddingProvider {
  readonly name: string;

  constructor(private readonly opts: { apiKey: string; baseUrl: string; model: string }) {
    this.name = `openai:${opts.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return inBatches(texts, 96, async (batch) => {
      const res = await fetchJson<{ data: { index: number; embedding: number[] }[] }>(
        `${this.opts.baseUrl}/embeddings`,
        {
          headers: { authorization: `Bearer ${this.opts.apiKey}` },
          body: { model: this.opts.model, input: batch },
        },
      );
      return res.data.sort((a, b) => a.index - b.index).map((d) => l2normalize(d.embedding));
    });
  }
}

export class OllamaEmbeddings implements EmbeddingProvider {
  readonly name: string;

  constructor(private readonly opts: { baseUrl: string; model: string }) {
    this.name = `ollama:${opts.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return inBatches(texts, 32, async (batch) => {
      const res = await fetchJson<{ embeddings: number[][] }>(`${this.opts.baseUrl}/api/embed`, {
        body: { model: this.opts.model, input: batch },
        timeoutMs: 120_000,
      });
      return res.embeddings.map(l2normalize);
    });
  }
}
