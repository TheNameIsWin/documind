import { describe, expect, it } from 'vitest';
import { LocalHashEmbeddings } from '../src/core/embeddings/local.js';
import { IngestionService } from '../src/core/ingestion/ingestion-service.js';
import { ExtractiveAnswerer, splitSentences } from '../src/core/llm/extractive.js';
import type { GenerateInput, LlmProvider } from '../src/core/llm/provider.js';
import { buildMessages, SYSTEM_PROMPT } from '../src/core/rag/prompt.js';
import { bestSnippet, RagService, type AnswerEvent } from '../src/core/rag/rag-service.js';
import { HybridRetriever } from '../src/core/rag/retriever.js';
import { MemoryVectorStore } from '../src/core/vectorstore/memory-store.js';
import { HANDBOOK } from './fixtures.js';

class RecordingLlm implements LlmProvider {
  readonly name = 'recording';
  lastInput?: GenerateInput;
  async *stream(input: GenerateInput) {
    this.lastInput = input;
    yield 'Deploys use ';
    yield 'blue-green [1].';
  }
}

async function makeRag(llm: LlmProvider) {
  const embeddings = new LocalHashEmbeddings();
  const store = new MemoryVectorStore(embeddings.name);
  await new IngestionService(store, embeddings, { chunkSize: 300, overlap: 50 }).ingestText(
    'handbook.md',
    HANDBOOK,
  );
  return new RagService(new HybridRetriever(store, embeddings), llm, { topK: 3, minScore: 0.05 });
}

async function collect(gen: AsyncGenerator<AnswerEvent>) {
  const events: AnswerEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe('RagService', () => {
  it('emits citations, then tokens, then done', async () => {
    const rag = await makeRag(new RecordingLlm());
    const events = await collect(rag.ask({ question: 'How are deployments released?' }));

    expect(events[0]?.type).toBe('citations');
    expect(events.at(-1)?.type).toBe('done');
    const done = events.at(-1) as Extract<AnswerEvent, { type: 'done' }>;
    expect(done.answer).toBe('Deploys use blue-green [1].');
    expect(done.usage.model).toBe('recording');
  });

  it('grounds the prompt in retrieved context', async () => {
    const llm = new RecordingLlm();
    const rag = await makeRag(llm);
    await rag.answer({ question: 'How are deployments released?' });

    const userMessage = llm.lastInput?.messages.at(-1)?.content ?? '';
    expect(llm.lastInput?.messages[0]?.content).toBe(SYSTEM_PROMPT);
    expect(userMessage).toContain('[1] (source: handbook.md');
    expect(userMessage).toContain('blue-green');
  });

  it('does not call the model when nothing relevant is found', async () => {
    const llm = new RecordingLlm();
    const embeddings = new LocalHashEmbeddings();
    const rag = new RagService(
      new HybridRetriever(new MemoryVectorStore(embeddings.name), embeddings),
      llm,
      { topK: 3, minScore: 0.2 },
    );
    const result = await rag.answer({ question: 'What is the meaning of life?' });
    expect(result.citations).toEqual([]);
    expect(result.answer).toMatch(/couldn't find/);
    expect(llm.lastInput).toBeUndefined();
  });
});

describe('ExtractiveAnswerer', () => {
  it('answers offline with inline citations', async () => {
    const rag = await makeRag(new ExtractiveAnswerer());
    const { answer } = await rag.answer({
      question: 'How many days of paid leave do engineers get?',
    });
    expect(answer).toContain('24 days');
    expect(answer).toMatch(/\[\d\]/);
  });

  it('ignores headings and weakly related sentences', async () => {
    const rag = await makeRag(new ExtractiveAnswerer());
    const { answer } = await rag.answer({
      question: 'How quickly must on-call engineers acknowledge pages, and when do they escalate?',
    });
    expect(answer).toContain('15 minutes');
    expect(answer).not.toContain('#');
    expect(answer).not.toContain('Docker');
  });

  it('drops markdown headings and list markers', () => {
    expect(
      splitSentences('## Title\n- First bullet item is long enough.\nPlain line that is long.'),
    ).toEqual(['First bullet item is long enough.', 'Plain line that is long.']);
  });

  it('splits sentences sensibly', () => {
    expect(splitSentences('First sentence is here. Second one follows now! tiny.')).toEqual([
      'First sentence is here.',
      'Second one follows now! tiny.',
    ]);
  });
});

describe('bestSnippet', () => {
  it('centres the preview on the sentence that matches the question', () => {
    const snippet = bestSnippet(HANDBOOK, 'What does ERR_4012 mean?');
    expect(snippet.startsWith('Error ERR_4012')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(280);
  });
});

describe('buildMessages', () => {
  it('keeps only recent non-system history', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: `m${i}`,
    }));
    const messages = buildMessages('q', [], history, 4);
    expect(messages.map((m) => m.content).slice(1, -1)).toEqual(['m6', 'm7', 'm8', 'm9']);
  });
});
