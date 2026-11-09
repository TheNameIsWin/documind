import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaChat } from '../src/core/llm/ollama.js';
import { OpenAIChat } from '../src/core/llm/openai.js';
import type { GenerateInput } from '../src/core/llm/provider.js';
import { AppError } from '../src/lib/errors.js';
import {
  collect,
  mockFetch,
  sentBody,
  sentHeaders,
  streamResponse,
  textResponse,
} from './http-mocks.js';

const INPUT: GenerateInput = {
  messages: [
    { role: 'system', content: 'Answer only from context.' },
    { role: 'user', content: 'What is the refund window?' },
  ],
  context: [],
  question: 'What is the refund window?',
};

/** One OpenAI streaming frame carrying a content delta. */
const sse = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

/** One Ollama NDJSON frame. */
const nd = (content: string, done = false) =>
  `${JSON.stringify({ message: { role: 'assistant', content }, done })}\n`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAIChat', () => {
  const llm = () =>
    new OpenAIChat({ apiKey: 'test-key', baseUrl: 'https://llm.test/v1', model: 'gpt-test' });

  it('identifies itself with the model name (shown in the UI and logs)', () => {
    expect(llm().name).toBe('openai:gpt-test');
  });

  it('streams content deltas in order', async () => {
    mockFetch(
      streamResponse([sse('Refunds '), sse('within '), sse('30 days [1].'), 'data: [DONE]\n\n']),
    );

    expect(await collect(llm().stream(INPUT))).toEqual(['Refunds ', 'within ', '30 days [1].']);
  });

  it('sends a streaming chat-completions request with auth and low temperature', async () => {
    const fetch = mockFetch(streamResponse(['data: [DONE]\n']));

    await collect(llm().stream(INPUT));

    expect(fetch.mock.calls[0]![0]).toBe('https://llm.test/v1/chat/completions');
    expect(sentHeaders(fetch).authorization).toBe('Bearer test-key');
    expect(sentBody(fetch)).toEqual({
      model: 'gpt-test',
      messages: INPUT.messages,
      stream: true,
      temperature: 0.2,
    });
  });

  it('stops at [DONE] and ignores anything the server sends afterwards', async () => {
    mockFetch(streamResponse([sse('final'), 'data: [DONE]\n\n', sse('LEAKED')]));

    expect(await collect(llm().stream(INPUT))).toEqual(['final']);
  });

  it('handles frames split across network chunks', async () => {
    const frame = sse('hello world');
    mockFetch(streamResponse([frame.slice(0, 15), frame.slice(15), 'data: [DONE]\n']));

    expect(await collect(llm().stream(INPUT))).toEqual(['hello world']);
  });

  it('skips keep-alives, comments, role-only and malformed frames', async () => {
    mockFetch(
      streamResponse([
        ': keep-alive\n\n',
        `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`,
        'data: {not json\n\n',
        `data: ${JSON.stringify({ choices: [] })}\n\n`,
        sse('ok'),
        'data: [DONE]\n',
      ]),
    );

    expect(await collect(llm().stream(INPUT))).toEqual(['ok']);
  });

  it('ends cleanly if the stream closes without [DONE]', async () => {
    mockFetch(streamResponse([sse('partial')]));

    expect(await collect(llm().stream(INPUT))).toEqual(['partial']);
  });

  it('forwards the abort signal so generation stops when the client disconnects', async () => {
    const fetch = mockFetch(streamResponse(['data: [DONE]\n']));
    const controller = new AbortController();

    await collect(llm().stream({ ...INPUT, signal: controller.signal }));

    expect((fetch.mock.calls[0]![1] as RequestInit).signal).toBe(controller.signal);
  });

  it('turns an HTTP error into an upstream AppError with the provider message', async () => {
    mockFetch(textResponse('{"error":{"message":"Incorrect API key"}}', 401));

    const err = await collect(llm().stream(INPUT)).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      status: 502,
      message: 'LLM request failed (401)',
      details: expect.stringContaining('Incorrect API key'),
    });
  });
});

describe('OllamaChat', () => {
  const llm = () => new OllamaChat({ baseUrl: 'http://ollama.test:11434', model: 'llama-test' });

  it('identifies itself with the model name', () => {
    expect(llm().name).toBe('ollama:llama-test');
  });

  it('streams NDJSON message content in order', async () => {
    mockFetch(streamResponse([nd('Refunds '), nd('within 30 days.'), nd('', true)]));

    expect(await collect(llm().stream(INPUT))).toEqual(['Refunds ', 'within 30 days.']);
  });

  it('sends a streaming /api/chat request with the configured model', async () => {
    const fetch = mockFetch(streamResponse([nd('', true)]));

    await collect(llm().stream(INPUT));

    expect(fetch.mock.calls[0]![0]).toBe('http://ollama.test:11434/api/chat');
    expect(sentBody(fetch)).toEqual({
      model: 'llama-test',
      messages: INPUT.messages,
      stream: true,
      options: { temperature: 0.2 },
    });
  });

  it('yields content carried on the final done frame, then stops', async () => {
    mockFetch(streamResponse([nd('a'), nd('b', true), nd('LEAKED')]));

    expect(await collect(llm().stream(INPUT))).toEqual(['a', 'b']);
  });

  it('skips malformed lines instead of failing the whole answer', async () => {
    mockFetch(streamResponse([nd('good '), '{"broken\n', nd('still good'), nd('', true)]));

    expect(await collect(llm().stream(INPUT))).toEqual(['good ', 'still good']);
  });

  it('turns an HTTP error into an upstream AppError (e.g. model not pulled)', async () => {
    mockFetch(textResponse('model "llama-test" not found, try pulling it first', 404));

    await expect(collect(llm().stream(INPUT))).rejects.toMatchObject({
      status: 502,
      message: 'Ollama request failed (404)',
      details: expect.stringContaining('not found'),
    });
  });
});
