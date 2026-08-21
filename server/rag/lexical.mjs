/**
 * BM25 keyword ranking over curriculum chunks.
 *
 * This is the floor the whole retrieval layer stands on: it needs no API key, no network and no
 * database extension, so it works in the pg-mem test path and in a deployment where nobody has
 * configured an embedding provider. When embeddings *are* available the retriever fuses both
 * rankings rather than replacing this one — keyword matching is still the stronger signal for the
 * exact topic names ("Photosynthesis", "Quadratic Equations") that teachers actually search for.
 */

// Standard BM25 constants: k1 controls term-frequency saturation, b the length normalisation.
const K1 = 1.5;
const B = 0.75;

// Short function words carry no topical signal and would otherwise dominate the scoring of
// question-shaped queries ("what is the ...", "how do I ...").
const STOP_WORDS = new Set([
  'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does', 'for',
  'from', 'had', 'has', 'have', 'how', 'i', 'in', 'is', 'it', 'its', 'me', 'of', 'on', 'or',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'was', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your',
]);

export const tokenize = (text) =>
  String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

/**
 * Ranks `chunks` against `query`, returning [{ chunk, score }] sorted best-first.
 *
 * Scoring is over the supplied set only — the caller has already narrowed by curriculum, subject
 * and grade, so document frequencies are computed against that candidate set rather than the whole
 * corpus. For a per-request shortlist that is both cheaper and more discriminating.
 */
export const rankLexical = (chunks, query) => {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || chunks.length === 0) {
    return [];
  }

  const documents = chunks.map((chunk) => {
    const terms = tokenize(chunk.content);
    const frequencies = new Map();
    for (const term of terms) {
      frequencies.set(term, (frequencies.get(term) || 0) + 1);
    }
    return { chunk, frequencies, length: terms.length };
  });

  const averageLength =
    documents.reduce((total, document) => total + document.length, 0) / documents.length || 1;

  const documentFrequency = new Map();
  for (const term of new Set(queryTerms)) {
    const count = documents.filter((document) => document.frequencies.has(term)).length;
    documentFrequency.set(term, count);
  }

  const scored = documents.map((document) => {
    let score = 0;

    for (const term of queryTerms) {
      const frequency = document.frequencies.get(term);
      if (!frequency) continue;

      const count = documentFrequency.get(term) || 0;
      // BM25's probabilistic IDF. The +1 inside the log keeps it positive even for a term that
      // appears in every candidate, which would otherwise score negative and rank matches below
      // non-matches.
      const idf = Math.log(1 + (documents.length - count + 0.5) / (count + 0.5));
      const normalisation = 1 - B + (B * document.length) / averageLength;
      score += idf * ((frequency * (K1 + 1)) / (frequency + K1 * normalisation));
    }

    return { chunk: document.chunk, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
};

export const cosineSimilarity = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? 0 : dot / denominator;
};

/**
 * Reciprocal rank fusion. Merges two orderings without needing their scores to be on a comparable
 * scale — which BM25 scores and cosine similarities emphatically are not. A chunk ranked well by
 * either method surfaces; one ranked well by both surfaces higher.
 */
export const fuseRankings = (rankings, { k = 60, limit = 10 } = {}) => {
  const scores = new Map();

  for (const ranking of rankings) {
    ranking.forEach((entry, index) => {
      const id = entry.chunk.id;
      const previous = scores.get(id);
      const contribution = 1 / (k + index + 1);
      if (previous) {
        previous.score += contribution;
      } else {
        scores.set(id, { chunk: entry.chunk, score: contribution });
      }
    });
  }

  return [...scores.values()].sort((left, right) => right.score - left.score).slice(0, limit);
};
