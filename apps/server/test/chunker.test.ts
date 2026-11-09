import { describe, expect, it } from 'vitest';
import { chunkText } from '../src/core/ingestion/chunker.js';
import { normalizeText } from '../src/core/ingestion/parsers.js';
import { HANDBOOK } from './fixtures.js';

describe('chunkText', () => {
  it('returns no chunks for blank input', () => {
    expect(chunkText('   \n  ', { chunkSize: 100, overlap: 10 })).toEqual([]);
  });

  it('keeps short text as a single chunk', () => {
    const chunks = chunkText('Hello world.', { chunkSize: 100, overlap: 10 });
    expect(chunks).toEqual([{ text: 'Hello world.', start: 0, end: 12 }]);
  });

  it('never exceeds the chunk size', () => {
    const chunks = chunkText(HANDBOOK, { chunkSize: 200, overlap: 40 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(200);
  });

  it('records offsets that map exactly back to the source text', () => {
    const chunks = chunkText(HANDBOOK, { chunkSize: 250, overlap: 50 });
    for (const c of chunks) expect(HANDBOOK.slice(c.start, c.end)).toBe(c.text);
  });

  it('covers the whole document', () => {
    const chunks = chunkText(HANDBOOK, { chunkSize: 250, overlap: 0 });
    const covered = chunks.map((c) => c.text).join(' ');
    for (const word of ['ERR_4012', 'blue-green', '24 days', 'Monday']) {
      expect(covered).toContain(word);
    }
  });

  it('overlaps consecutive chunks when overlap > 0', () => {
    const chunks = chunkText(HANDBOOK, { chunkSize: 200, overlap: 60 });
    const overlapping = chunks
      .slice(1)
      .filter((c, i) => c.start < (chunks[i] as { end: number }).end);
    expect(overlapping.length).toBeGreaterThan(0);
  });

  it('hard-splits text with no natural boundaries', () => {
    const chunks = chunkText('x'.repeat(1000), { chunkSize: 300, overlap: 0 });
    expect(chunks.map((c) => c.text.length)).toEqual([300, 300, 300, 100]);
  });

  it('rejects invalid options', () => {
    expect(() => chunkText('abc', { chunkSize: 10, overlap: 10 })).toThrow();
    expect(() => chunkText('abc', { chunkSize: 0, overlap: 0 })).toThrow();
  });
});

describe('normalizeText', () => {
  it('collapses whitespace but keeps paragraph breaks', () => {
    expect(normalizeText('a\r\n\r\n\r\n\r\nb   c\t\td  \n  e')).toBe('a\n\nb c d\ne');
  });
});
