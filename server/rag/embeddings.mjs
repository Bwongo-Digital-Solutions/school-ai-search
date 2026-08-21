/**
 * Embedding providers for the curriculum corpus.
 *
 * Mirrors server/services/llm-models.mjs — same PROVIDER_ENV credential table, same injectable
 * httpClient so every provider path is testable without a network, same "return something usable
 * rather than throw" posture. The one behavioural difference is the null return: when no embedding
 * provider is configured this yields null rather than erroring, and the retriever falls back to
 * BM25. That keeps the whole feature working on a deployment with no API keys at all.
 *
 * Anthropic is deliberately absent — the Messages API has no embeddings endpoint. A school running
 * Claude for chat should pair it with OpenAI or a local Ollama model here (or with Voyage, which
 * would slot in as another entry in EMBEDDING_MODELS).
 */
import { PROVIDER_ENV, postJson } from '../services/llm-models.mjs';

const EMBEDDING_MODELS = {
  openai: {
    provider: 'openai',
    model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    dimensions: 1536,
  },
  google: {
    provider: 'google',
    model: process.env.GOOGLE_EMBEDDING_MODEL || 'text-embedding-004',
    dimensions: 768,
  },
  mistral: {
    provider: 'mistral',
    model: process.env.MISTRAL_EMBEDDING_MODEL || 'mistral-embed',
    dimensions: 1024,
  },
  ollama: {
    provider: 'ollama',
    model: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
    dimensions: 768,
  },
};

const hasCredentials = (provider) => {
  if (provider === 'ollama') return Boolean(process.env.OLLAMA_BASE_URL || process.env.RAG_ENABLE_OLLAMA);
  const env = PROVIDER_ENV[provider];
  return Boolean(env?.apiKey && process.env[env.apiKey]);
};

/**
 * Picks the embedding model to use. An explicit EMBEDDING_MODEL_ID wins; otherwise the first
 * provider that has credentials, in a deliberate order — OpenAI is the cheapest and most widely
 * configured, Ollama last because reaching it requires a running local daemon.
 */
export const resolveEmbeddingModel = () => {
  const requested = process.env.EMBEDDING_MODEL_ID;
  if (requested && EMBEDDING_MODELS[requested] && hasCredentials(requested)) {
    return EMBEDDING_MODELS[requested];
  }

  for (const provider of ['openai', 'google', 'mistral', 'ollama']) {
    if (hasCredentials(provider)) {
      return EMBEDDING_MODELS[provider];
    }
  }

  return null;
};

export const isEmbeddingConfigured = () => resolveEmbeddingModel() !== null;

const baseUrlFor = (provider) => {
  const env = PROVIDER_ENV[provider];
  return (process.env[env.baseUrl] || env.defaultBaseUrl).replace(/\/$/, '');
};

const embedOpenAiCompatible = async ({ model, texts, httpClient }) => {
  const env = PROVIDER_ENV[model.provider];
  const data = await postJson(httpClient, `${baseUrlFor(model.provider)}/embeddings`, {
    headers: { Authorization: `Bearer ${process.env[env.apiKey]}` },
    body: { model: model.model, input: texts },
  });

  // The API guarantees nothing about ordering, but every entry carries its request index.
  return (data?.data || [])
    .slice()
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((entry) => entry.embedding);
};

const embedGoogle = async ({ model, texts, httpClient }) => {
  const data = await postJson(
    httpClient,
    `${baseUrlFor('google')}/models/${encodeURIComponent(model.model)}:batchEmbedContents`,
    {
      headers: { 'x-goog-api-key': process.env[PROVIDER_ENV.google.apiKey] },
      body: {
        requests: texts.map((text) => ({
          model: `models/${model.model}`,
          content: { parts: [{ text }] },
        })),
      },
    },
  );

  return (data?.embeddings || []).map((entry) => entry.values);
};

const embedOllama = async ({ model, texts, httpClient }) => {
  // Ollama's embeddings endpoint takes one prompt per call, so batching is ours to do.
  const vectors = [];
  for (const text of texts) {
    const data = await postJson(httpClient, `${baseUrlFor('ollama')}/api/embeddings`, {
      body: { model: model.model, prompt: text },
    });
    vectors.push(data?.embedding || []);
  }
  return vectors;
};

const BATCH_SIZE = Number(process.env.EMBEDDING_BATCH_SIZE || 64);

/**
 * Embeds an array of strings, returning { model, vectors } or null when nothing is configured.
 *
 * Never throws on a provider failure: ingestion stores chunks with a null embedding and retrieval
 * carries on lexically. A syllabus upload that half-embedded is still fully searchable, which
 * matters more here than surfacing the provider error.
 */
export const embedTexts = async ({ texts, httpClient = fetch }) => {
  const model = resolveEmbeddingModel();
  if (!model || !Array.isArray(texts) || texts.length === 0) {
    return null;
  }

  const vectors = [];

  try {
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE);
      const params = { model, texts: batch, httpClient };

      if (['openai', 'mistral'].includes(model.provider)) {
        vectors.push(...(await embedOpenAiCompatible(params)));
      } else if (model.provider === 'google') {
        vectors.push(...(await embedGoogle(params)));
      } else if (model.provider === 'ollama') {
        vectors.push(...(await embedOllama(params)));
      } else {
        return null;
      }
    }
  } catch (error) {
    console.warn(
      `Embedding with ${model.provider}/${model.model} failed; retrieval falls back to keyword ranking:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }

  // A partial or malformed response would silently corrupt the index; treat it as unavailable.
  if (vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector) || vector.length === 0)) {
    return null;
  }

  return { model: `${model.provider}/${model.model}`, vectors };
};

export const embedQuery = async ({ query, httpClient = fetch }) => {
  const result = await embedTexts({ texts: [query], httpClient });
  return result ? { model: result.model, vector: result.vectors[0] } : null;
};
