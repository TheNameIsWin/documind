export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

export function l2normalize(vector: number[]): number[] {
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  return norm === 0 ? vector : vector.map((v) => v / norm);
}

/** Runs `fn` over `items` in fixed-size batches, preserving order. */
export async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (batch: T[]) => Promise<R[]>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await fn(items.slice(i, i + size))));
  }
  return out;
}
