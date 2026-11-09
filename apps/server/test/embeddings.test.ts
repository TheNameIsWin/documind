import { describe, expect, it } from 'vitest';
import { LocalHashEmbeddings, stem, tokenize } from '../src/core/embeddings/local.js';
import { inBatches } from '../src/core/embeddings/provider.js';
import { dot } from '../src/core/vectorstore/math.js';

describe('LocalHashEmbeddings', () => {
  const model = new LocalHashEmbeddings(512);

  it('produces unit-length vectors of the configured size', async () => {
    const [v] = await model.embed(['Docker images are pushed by the pipeline']);
    expect(v).toHaveLength(512);
    expect(Math.sqrt(dot(v!, v!))).toBeCloseTo(1, 6);
  });

  it('is deterministic', async () => {
    const [a] = await model.embed(['same input']);
    const [b] = await model.embed(['same input']);
    expect(a).toEqual(b);
  });

  it('scores related text above unrelated text', async () => {
    const [q, related, unrelated] = await model.embed([
      'how do deployments work',
      'Production deployments go through the CI/CD pipeline',
      'Masala chai is brewed with ginger and cardamom',
    ]);
    expect(dot(q!, related!)).toBeGreaterThan(dot(q!, unrelated!));
  });
});

describe('text helpers', () => {
  it('tokenizes, lowercases and drops stopwords', () => {
    expect(tokenize('The Quick, brown FOX!')).toEqual(['quick', 'brown', 'fox']);
  });

  it('stems common suffixes', () => {
    expect(stem('deploying')).toBe('deploy');
    expect(stem('policies')).toBe('policy');
    expect(stem('go')).toBe('go');
  });

  it('batches while preserving order', async () => {
    const calls: number[][] = [];
    const out = await inBatches([1, 2, 3, 4, 5], 2, async (b) => {
      calls.push(b);
      return b.map((x) => x * 10);
    });
    expect(calls).toEqual([[1, 2], [3, 4], [5]]);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });
});
