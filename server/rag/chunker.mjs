/**
 * Splits a curriculum document into retrievable chunks.
 *
 * Boundaries follow Markdown headings wherever the source has them, because a syllabus is already
 * organised the way a teacher searches it — by topic and subtopic. Only when a single heading's
 * body is longer than the target size does it get split further, on paragraph boundaries, with a
 * short overlap so a fact spanning the seam is still retrievable from either side.
 */

// Roughly four characters per token holds well enough for English prose to size chunks by; nothing
// downstream needs an exact count, only a stable one for ranking and for reporting corpus size.
const CHARS_PER_TOKEN = 4;

const DEFAULT_TARGET_TOKENS = Number(process.env.RAG_CHUNK_TOKENS || 800);
const DEFAULT_OVERLAP_TOKENS = Number(process.env.RAG_CHUNK_OVERLAP_TOKENS || 100);

export const estimateTokens = (text) => Math.ceil(String(text || '').length / CHARS_PER_TOKEN);

const HEADING_PATTERN = /^\s{0,3}(#{1,6})\s+(.*\S)\s*$/;

/**
 * Groups lines into { heading, body } sections. Text before the first heading becomes a section
 * with an empty heading, so an unstructured upload still yields one usable section.
 */
const splitIntoSections = (text) => {
  const lines = String(text || '').split(/\r?\n/);
  const sections = [];
  let current = { heading: '', lines: [] };

  for (const line of lines) {
    const match = HEADING_PATTERN.exec(line);
    if (match) {
      if (current.lines.some((entry) => entry.trim())) {
        sections.push(current);
      }
      current = { heading: match[2], lines: [] };
      continue;
    }
    current.lines.push(line);
  }

  if (current.lines.some((entry) => entry.trim()) || current.heading) {
    sections.push(current);
  }

  return sections.map((section) => ({
    heading: section.heading,
    body: section.lines.join('\n').trim(),
  }));
};

/**
 * Packs paragraphs into pieces no larger than targetTokens, carrying `overlapTokens` worth of the
 * previous piece's tail into the next one. A single paragraph longer than the target is emitted
 * whole rather than cut mid-sentence — an oversized chunk retrieves fine, a truncated one does not.
 */
const packParagraphs = (body, targetTokens, overlapTokens) => {
  const paragraphs = body.split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];

  const pieces = [];
  let buffer = [];
  let bufferTokens = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const piece = buffer.join('\n\n');
    pieces.push(piece);

    // Carry the tail into the next buffer so a sentence straddling the seam stays retrievable.
    const overlap = [];
    let overlapSize = 0;
    for (let index = buffer.length - 1; index >= 0; index -= 1) {
      const tokens = estimateTokens(buffer[index]);
      if (overlapSize + tokens > overlapTokens) break;
      overlap.unshift(buffer[index]);
      overlapSize += tokens;
    }

    buffer = overlap;
    bufferTokens = overlapSize;
  };

  for (const paragraph of paragraphs) {
    const tokens = estimateTokens(paragraph);
    if (bufferTokens > 0 && bufferTokens + tokens > targetTokens) {
      flush();
    }
    buffer.push(paragraph);
    bufferTokens += tokens;
  }

  if (buffer.length > 0) {
    pieces.push(buffer.join('\n\n'));
  }

  // The overlap carry means the last flush can duplicate a trailing piece; drop an exact repeat.
  return pieces.filter((piece, index) => index === 0 || piece !== pieces[index - 1]);
};

/**
 * Returns [{ chunkIndex, heading, content, tokenCount }] for a document body.
 *
 * The heading is repeated into the chunk text as well as kept as a field: retrieval ranks on
 * `content`, and a chunk that says "Photosynthesis" in its body matches a query about
 * photosynthesis even when the heading itself was the only place the word appeared.
 */
export const chunkDocument = (
  text,
  { targetTokens = DEFAULT_TARGET_TOKENS, overlapTokens = DEFAULT_OVERLAP_TOKENS } = {},
) => {
  const sections = splitIntoSections(text);
  const chunks = [];

  for (const section of sections) {
    const bodies = section.body ? packParagraphs(section.body, targetTokens, overlapTokens) : [];

    // A heading with no body still carries meaning (a topic listing), so keep it as its own chunk.
    if (bodies.length === 0 && section.heading) {
      bodies.push('');
    }

    for (const body of bodies) {
      const content = [section.heading, body].filter(Boolean).join('\n\n').trim();
      if (!content) continue;

      chunks.push({
        chunkIndex: chunks.length,
        heading: section.heading,
        content,
        tokenCount: estimateTokens(content),
      });
    }
  }

  return chunks;
};
