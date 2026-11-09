import { AppError } from '../../lib/errors.js';

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.pdf', '.json', '.csv'] as const;

type Parser = (buffer: Buffer) => Promise<string>;

const utf8: Parser = async (buffer) => buffer.toString('utf8');

const pdf: Parser = async (buffer) => {
  // Lazy import keeps pdf.js out of memory until the first PDF arrives.
  const { extractText, getDocumentProxy } = await import('unpdf');
  try {
    const document = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(document, { mergePages: false });
    return text.join('\n\n');
  } catch {
    throw AppError.badRequest('Could not read PDF — the file may be corrupt or encrypted');
  }
};

const json: Parser = async (buffer) => {
  try {
    return JSON.stringify(JSON.parse(buffer.toString('utf8')), null, 2);
  } catch {
    throw AppError.badRequest('File is not valid JSON');
  }
};

const PARSERS: Record<string, Parser> = {
  '.txt': utf8,
  '.md': utf8,
  '.markdown': utf8,
  '.csv': utf8,
  '.json': json,
  '.pdf': pdf,
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

export async function parseDocument(filename: string, buffer: Buffer): Promise<string> {
  const parser = PARSERS[extensionOf(filename)];
  if (!parser) {
    throw AppError.unsupported(
      `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    );
  }
  return normalizeText(await parser(buffer));
}

/** Normalizes whitespace while preserving paragraph boundaries for the chunker. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replaceAll(String.fromCharCode(0), '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
