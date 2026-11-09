import { describe, expect, it } from 'vitest';
import { SseParser } from './sse';

describe('SseParser', () => {
  it('parses complete frames', () => {
    const parser = new SseParser();
    expect(parser.push('event: token\ndata: {"text":"hi"}\n\n')).toEqual([
      { event: 'token', data: '{"text":"hi"}' },
    ]);
  });

  it('buffers frames split across network chunks', () => {
    const parser = new SseParser();
    expect(parser.push('event: tok')).toEqual([]);
    expect(parser.push('en\ndata: {"a":1}\n')).toEqual([]);
    expect(parser.push('\nevent: done\ndata: {}\n\n')).toEqual([
      { event: 'token', data: '{"a":1}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('defaults the event name and handles CRLF', () => {
    const parser = new SseParser();
    expect(parser.push('data: x\r\n\r\n')).toEqual([{ event: 'message', data: 'x' }]);
  });
});
