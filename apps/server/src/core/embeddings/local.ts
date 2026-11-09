import { l2normalize, type EmbeddingProvider } from './provider.js';

const STOPWORDS = new Set(
  (
    'a an and are as at be by for from has have in is it its of on or that the this to was were ' +
    'will with what which who how when where why do does did can could should would i you we they'
  ).split(' '),
);

/** FNV-1a 32-bit hash — fast, deterministic, well distributed for feature hashing. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Very light stemmer: strips common English suffixes so "deploying" ≈ "deploy". */
export function stem(token: string): string {
  for (const suffix of ['ingly', 'edly', 'ing', 'ies', 'ed', 'es', 's', 'ly']) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
      return suffix === 'ies' ? token.slice(0, -3) + 'y' : token.slice(0, -suffix.length);
    }
  }
  return token;
}

/**
 * Zero-dependency, offline embedding model based on the hashing trick.
 *
 * Features: stemmed unigrams, bigrams (word order), and character trigrams (typo
 * tolerance), weighted with sublinear TF and signed hashing to reduce collision bias.
 * It is a lexical model, not a semantic one, but it makes the whole pipeline runnable
 * and testable with no API keys or GPU.
 */
export class LocalHashEmbeddings implements EmbeddingProvider {
  readonly name = 'local-hash';

  constructor(private readonly dimensions = 1024) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const counts = new Map<string, number>();
    const add = (feature: string, weight: number) =>
      counts.set(feature, (counts.get(feature) ?? 0) + weight);

    const tokens = tokenize(text).map(stem);
    tokens.forEach((token, i) => {
      add(`w:${token}`, 1);
      const next = tokens[i + 1];
      if (next) add(`b:${token}_${next}`, 0.7);
      const padded = `#${token}#`;
      for (let j = 0; j + 3 <= padded.length; j++) add(`c:${padded.slice(j, j + 3)}`, 0.25);
    });

    const vector = new Array<number>(this.dimensions).fill(0);
    for (const [feature, count] of counts) {
      const hash = fnv1a(feature);
      const sign = hash & 1 ? 1 : -1;
      const index = (hash >>> 1) % this.dimensions;
      vector[index] = (vector[index] ?? 0) + sign * (1 + Math.log(count));
    }
    return l2normalize(vector);
  }
}
