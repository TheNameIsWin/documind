export interface ChunkSpan {
  text: string;
  start: number;
  end: number;
}

export interface ChunkerOptions {
  chunkSize: number;
  overlap: number;
}

/** Separators in priority order: paragraphs → lines → sentences → words. */
const SEPARATORS = ['\n\n', '\n', '. ', '? ', '! ', '; ', ', ', ' '];

/**
 * Recursive character splitter.
 *
 * Splits on the most semantic boundary available so chunks keep whole paragraphs or
 * sentences where possible, then greedily packs pieces up to `chunkSize` and carries
 * `overlap` characters of trailing context into the next chunk. Every chunk records its
 * exact [start, end) offsets in the source text so answers can cite precise locations.
 */
export function chunkText(text: string, { chunkSize, overlap }: ChunkerOptions): ChunkSpan[] {
  if (chunkSize <= 0) throw new Error('chunkSize must be positive');
  if (overlap < 0 || overlap >= chunkSize) throw new Error('overlap must be in [0, chunkSize)');
  if (!text.trim()) return [];

  const pieces = split(text, 0, chunkSize, 0);
  return pack(text, pieces, chunkSize, overlap);
}

interface Piece {
  start: number;
  end: number;
}

function split(text: string, offset: number, maxLen: number, level: number): Piece[] {
  if (text.length <= maxLen) return [{ start: offset, end: offset + text.length }];

  const separator = SEPARATORS[level];
  if (separator === undefined) {
    // No natural boundary left — hard split.
    const out: Piece[] = [];
    for (let i = 0; i < text.length; i += maxLen) {
      out.push({ start: offset + i, end: offset + Math.min(i + maxLen, text.length) });
    }
    return out;
  }

  const out: Piece[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = text.indexOf(separator, cursor);
    // Keep the separator attached to the left piece so offsets stay contiguous.
    const end = idx === -1 ? text.length : idx + separator.length;
    const segment = text.slice(cursor, end);

    if (segment.length > maxLen) {
      out.push(...split(segment, offset + cursor, maxLen, level + 1));
    } else {
      out.push({ start: offset + cursor, end: offset + end });
    }
    cursor = end;
  }
  return out;
}

function pack(text: string, pieces: Piece[], chunkSize: number, overlap: number): ChunkSpan[] {
  const chunks: ChunkSpan[] = [];
  let start = pieces[0]?.start ?? 0;
  let end = start;

  const flush = () => {
    const raw = text.slice(start, end);
    const trimmedStart = start + (raw.length - raw.trimStart().length);
    const trimmedEnd = end - (raw.length - raw.trimEnd().length);
    if (trimmedEnd > trimmedStart) {
      chunks.push({
        text: text.slice(trimmedStart, trimmedEnd),
        start: trimmedStart,
        end: trimmedEnd,
      });
    }
  };

  for (const piece of pieces) {
    if (piece.end - start > chunkSize && end > start) {
      flush();
      // Start the next chunk `overlap` chars back, snapped forward to a word boundary.
      let next = Math.max(start, end - overlap);
      const space = text.indexOf(' ', next);
      if (overlap > 0 && space !== -1 && space < end) next = space + 1;
      start = overlap > 0 ? next : piece.start;
      if (piece.end - start > chunkSize) start = piece.start;
    }
    end = piece.end;
  }
  flush();
  return chunks;
}
