import type { ChatMessage, ScoredChunk } from '../types.js';

export interface GenerateInput {
  messages: ChatMessage[];
  /** Retrieved context, also passed raw so non-LLM strategies (extractive) can use it. */
  context: ScoredChunk[];
  question: string;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly name: string;
  /** Yields answer text incrementally (token or word deltas). */
  stream(input: GenerateInput): AsyncGenerator<string>;
}
