const createDefaultModelCatalog = () => [
  {
    id: 'local-rules',
    label: 'Local Rules',
    provider: 'local_rules',
    model: 'student-search-rules',
    type: 'local',
    description: 'Fast local student search without external API calls.',
  },
  {
    id: 'openai-default',
    label: 'OpenAI',
    provider: 'openai',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    type: 'commercial',
    description: 'OpenAI chat model using the Chat Completions API.',
  },
  {
    id: 'anthropic-default',
    label: 'Anthropic Claude',
    provider: 'anthropic',
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    type: 'commercial',
    description: 'Anthropic Messages API model.',
  },
  {
    id: 'google-default',
    label: 'Google Gemini',
    provider: 'google',
    model: process.env.GOOGLE_GEMINI_MODEL || 'gemini-2.5-flash',
    type: 'commercial',
    description: 'Google Gemini generateContent model.',
  },
  {
    id: 'groq-default',
    label: 'Groq',
    provider: 'groq',
    model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
    type: 'commercial',
    description: 'Groq OpenAI-compatible chat endpoint.',
  },
  {
    id: 'mistral-default',
    label: 'Mistral',
    provider: 'mistral',
    model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
    type: 'commercial',
    description: 'Mistral OpenAI-compatible chat endpoint.',
  },
  {
    id: 'openrouter-default',
    label: 'OpenRouter',
    provider: 'openrouter',
    model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct',
    type: 'commercial',
    description: 'OpenRouter gateway for commercial and open-weight hosted models.',
  },
  {
    id: 'ollama-default',
    label: 'Ollama',
    provider: 'ollama',
    model: process.env.OLLAMA_MODEL || 'qwen3.5:2b',
    type: 'open_source',
    description: 'Local open-source model served by Ollama.',
  },
];

// Exported so the embeddings layer (server/rag/embeddings.mjs) and the agent's tool-calling
// adapters (server/agent/providers.mjs) resolve credentials and base URLs from this one table
// rather than each keeping their own copy.
export const PROVIDER_ENV = {
  openai: {
    apiKey: 'OPENAI_API_KEY',
    baseUrl: 'OPENAI_BASE_URL',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  groq: {
    apiKey: 'GROQ_API_KEY',
    baseUrl: 'GROQ_BASE_URL',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
  },
  mistral: {
    apiKey: 'MISTRAL_API_KEY',
    baseUrl: 'MISTRAL_BASE_URL',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
  },
  openrouter: {
    apiKey: 'OPENROUTER_API_KEY',
    baseUrl: 'OPENROUTER_BASE_URL',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  anthropic: {
    apiKey: 'ANTHROPIC_API_KEY',
    baseUrl: 'ANTHROPIC_BASE_URL',
    defaultBaseUrl: 'https://api.anthropic.com',
  },
  google: {
    apiKey: 'GOOGLE_GEMINI_API_KEY',
    baseUrl: 'GOOGLE_GEMINI_BASE_URL',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  ollama: {
    baseUrl: 'OLLAMA_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:11434',
  },
};

const parseCatalogOverride = () => {
  if (!process.env.AI_MODEL_CATALOG) return null;

  try {
    const parsed = JSON.parse(process.env.AI_MODEL_CATALOG);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const providerHasCredentials = (provider) => {
  if (provider === 'local_rules') return true;
  if (provider === 'ollama') return true;

  const env = PROVIDER_ENV[provider];
  return Boolean(env?.apiKey && process.env[env.apiKey]);
};

export const publicModel = (model) => ({
  id: model.id,
  label: model.label,
  provider: model.provider,
  model: model.model,
  type: model.type,
  description: model.description,
  configured: providerHasCredentials(model.provider),
});

export const getModelCatalog = () => {
  const override = parseCatalogOverride();
  const catalog = override || createDefaultModelCatalog();
  return catalog.map((model) => ({
    ...model,
    id: model.id || `${model.provider}:${model.model}`,
    label: model.label || `${model.provider} ${model.model}`,
    type: model.type || (model.provider === 'ollama' ? 'open_source' : 'commercial'),
    description: model.description || '',
  }));
};

export const getPublicModelCatalog = () => getModelCatalog().map(publicModel);

export const resolveModelSelection = (modelId) => {
  const catalog = getModelCatalog();
  const defaultModelId = process.env.AI_DEFAULT_MODEL_ID || 'local-rules';
  const selected = catalog.find((model) => model.id === (modelId || defaultModelId));
  return selected || catalog.find((model) => model.id === 'local-rules') || catalog[0];
};

const createStudentContext = (students) =>
  students
    .map((student) =>
      [
        `${student.first_name} ${student.last_name} (${student.student_id})`,
        `Grade ${student.grade_level}-${student.class_section}`,
        `GPA ${Number(student.gpa).toFixed(2)}`,
        `Attendance ${Number(student.attendance_rate).toFixed(1)}%`,
        `Status ${student.status}`,
        `Subjects: ${Array.isArray(student.subjects) ? student.subjects.join(', ') : ''}`,
        student.notes ? `Notes: ${student.notes}` : null,
      ]
        .filter(Boolean)
        .join('; '),
    )
    .join('\n');

// Inlining the whole roster stops scaling somewhere around a few hundred students. Past this many,
// the caller is expected to have narrowed the set by retrieval first; the prompt then says so
// explicitly, so the model reports "not in the records I can see" rather than "no such student".
// Read per call, like every other tunable in this file, so it stays reconfigurable at runtime.
const rosterInlineLimit = () => Number(process.env.AI_ROSTER_INLINE_LIMIT || 50);

export const createMessages = ({ message, students, hasImage, contextBlocks = '', history = [] }) => {
  const roster = students.slice(0, rosterInlineLimit());
  const truncated = students.length > roster.length;

  return [
    {
      role: 'system',
      content: [
        'You are SchoolBot AI, a school information assistant.',
        'Answer only from the provided records and reference material.',
        'Use concise Markdown. If the answer is not in the records, say so.',
        'Never invent student records, grades, payments, health details, or attendance.',
        hasImage
          ? 'The user attached an image, but local OCR is not available unless the selected model can interpret it.'
          : '',
        contextBlocks
          ? [
              '',
              'Reference material. Cite it as [1], [2] and so on when you use it:',
              contextBlocks,
            ].join('\n')
          : '',
        '',
        truncated
          ? `Student records (showing ${roster.length} of ${students.length}; ask the user to narrow ` +
            'the query if the student they mean is not listed):'
          : 'Student records:',
        createStudentContext(roster),
      ]
        .filter((line) => line !== '')
        .join('\n'),
    },
    ...history,
    {
      role: 'user',
      content: message || 'Please analyze this request.',
    },
  ];
};

export const readJson = async (response) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

export const postJson = async (httpClient, url, { headers = {}, body }) => {
  const response = await httpClient(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `LLM provider request failed with ${response.status}`);
  }

  return data;
};

const describeOllamaConnectionError = (error) => {
  const baseUrl = process.env.OLLAMA_BASE_URL || PROVIDER_ENV.ollama.defaultBaseUrl;
  const model = process.env.OLLAMA_MODEL || 'qwen3.5:2b';
  const detail = error instanceof Error && error.message ? error.message : 'Unknown connection error';

  return [
    `Could not reach Ollama at ${baseUrl}.`,
    `Current Ollama model setting: ${model}.`,
    '',
    `Provider detail: ${detail}`,
    '',
    'Start Ollama, pull the configured model, and set OLLAMA_BASE_URL to the URL reachable from the backend.',
    'For a non-Docker backend use http://127.0.0.1:11434.',
    'For the Docker backend use http://host.docker.internal:11434, or http://ollama:11434 if Ollama runs as a Compose service.',
  ].join('\n');
};

const callOpenAiCompatible = async ({ model, messages, httpClient }) => {
  const env = PROVIDER_ENV[model.provider];
  const apiKey = process.env[env.apiKey];
  if (!apiKey) throw new Error(`${env.apiKey} is required for ${model.label}`);

  const baseUrl = process.env[env.baseUrl] || env.defaultBaseUrl;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };

  if (model.provider === 'openrouter') {
    headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER || 'http://localhost';
    headers['X-Title'] = process.env.OPENROUTER_APP_TITLE || 'School AI Search';
  }

  const data = await postJson(httpClient, `${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    headers,
    body: {
      model: model.model,
      messages,
      temperature: Number(process.env.AI_TEMPERATURE || 0.2),
      max_tokens: Number(process.env.AI_MAX_TOKENS || 900),
    },
  });

  return {
    message: data?.choices?.[0]?.message?.content || '',
    usage: data?.usage || null,
    providerResponseId: data?.id || null,
  };
};

// Claude 4.6 and later (the Opus 4.6/4.7/4.8 and 5 family, Sonnet 4.6/5, Fable and Mythos) removed
// the sampling parameters: sending `temperature` to one of them is a 400, not a silent ignore.
// Older Claude models still honour it, and a school may well have pinned one through
// ANTHROPIC_MODEL, so this is a targeted deny-list rather than dropping temperature outright.
const ANTHROPIC_NO_SAMPLING =
  /^claude-(?:fable|mythos)-|^claude-opus-(?:5|4-6|4-7|4-8)|^claude-sonnet-(?:5|4-6)/;

export const anthropicSamplingParams = (modelName) =>
  ANTHROPIC_NO_SAMPLING.test(String(modelName || ''))
    ? {}
    : { temperature: Number(process.env.AI_TEMPERATURE || 0.2) };

const callAnthropic = async ({ model, messages, httpClient }) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for Anthropic Claude');

  const baseUrl = process.env.ANTHROPIC_BASE_URL || PROVIDER_ENV.anthropic.defaultBaseUrl;
  const system = messages.find((item) => item.role === 'system')?.content || '';
  const chatMessages = messages
    .filter((item) => item.role !== 'system')
    .map((item) => ({ role: item.role, content: item.content }));

  const data = await postJson(httpClient, `${baseUrl.replace(/\/$/, '')}/v1/messages`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
    },
    body: {
      model: model.model,
      max_tokens: Number(process.env.AI_MAX_TOKENS || 900),
      ...anthropicSamplingParams(model.model),
      system,
      messages: chatMessages,
    },
  });

  return {
    message: (data?.content || []).map((part) => part.text || '').join('\n').trim(),
    usage: data?.usage || null,
    providerResponseId: data?.id || null,
  };
};

const callGoogle = async ({ model, messages, httpClient }) => {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GEMINI_API_KEY is required for Google Gemini');

  const baseUrl = process.env.GOOGLE_GEMINI_BASE_URL || PROVIDER_ENV.google.defaultBaseUrl;
  const data = await postJson(
    httpClient,
    `${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model.model)}:generateContent`,
    {
      headers: {
        'x-goog-api-key': apiKey,
      },
      body: {
        systemInstruction: {
          parts: [{ text: messages.find((item) => item.role === 'system')?.content || '' }],
        },
        contents: messages
          .filter((item) => item.role !== 'system')
          .map((item) => ({
            role: item.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: item.content }],
          })),
        generationConfig: {
          temperature: Number(process.env.AI_TEMPERATURE || 0.2),
          maxOutputTokens: Number(process.env.AI_MAX_TOKENS || 900),
        },
      },
    },
  );

  return {
    message: (data?.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('\n').trim(),
    usage: data?.usageMetadata || null,
    providerResponseId: data?.responseId || null,
  };
};

const callOllama = async ({ model, messages, httpClient }) => {
  const baseUrl = process.env.OLLAMA_BASE_URL || PROVIDER_ENV.ollama.defaultBaseUrl;
  let data;
  try {
    data = await postJson(httpClient, `${baseUrl.replace(/\/$/, '')}/api/chat`, {
      body: {
        model: model.model,
        stream: false,
        messages,
        options: {
          temperature: Number(process.env.AI_TEMPERATURE || 0.2),
        },
      },
    });
  } catch (error) {
    throw new Error(describeOllamaConnectionError(error));
  }

  return {
    message: data?.message?.content || '',
    usage: {
      prompt_eval_count: data?.prompt_eval_count,
      eval_count: data?.eval_count,
    },
    providerResponseId: null,
  };
};

export const generateLlmSearchReply = async ({
  modelId,
  message,
  students,
  hasImage,
  contextBlocks = '',
  history = [],
  httpClient = fetch,
}) => {
  const model = resolveModelSelection(modelId);
  if (!model || model.provider === 'local_rules') {
    return null;
  }

  const messages = createMessages({ message, students, hasImage, contextBlocks, history });
  const params = { model, messages, httpClient };

  let result;
  if (['openai', 'groq', 'mistral', 'openrouter'].includes(model.provider)) {
    result = await callOpenAiCompatible(params);
  } else if (model.provider === 'anthropic') {
    result = await callAnthropic(params);
  } else if (model.provider === 'google') {
    result = await callGoogle(params);
  } else if (model.provider === 'ollama') {
    result = await callOllama(params);
  } else {
    throw new Error(`Unsupported AI provider: ${model.provider}`);
  }

  return {
    message: result.message || 'The selected model returned an empty response.',
    studentsFound: students.length,
    model: publicModel(model),
    usage: result.usage,
    providerResponseId: result.providerResponseId,
  };
};
