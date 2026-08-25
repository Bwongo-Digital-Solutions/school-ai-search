/**
 * Tool-calling adapters — one per provider family.
 *
 * The agent loop works in a single normalised message shape and never learns a provider's wire
 * format; each adapter translates in both directions. That is what lets the same tool registry back
 * the chat, the Lesson Planner and the Digital Examiner across all seven configured providers.
 *
 * Normalised messages:
 *   { role: 'user'    , content: string }
 *   { role: 'assistant', content: string, toolCalls: [{ id, name, input }], raw?: unknown }
 *   { role: 'tool'    , toolCallId, name, content: string, isError?: boolean }
 *
 * `raw` carries the provider's own assistant content back verbatim on the next request. It matters
 * for Claude: thinking blocks must be replayed unchanged on the same model within a tool loop, and
 * reconstructing them from the normalised fields would corrupt them.
 */
import { PROVIDER_ENV, anthropicSamplingParams, postJson } from '../services/llm-models.mjs';

const OPENAI_COMPATIBLE = ['openai', 'groq', 'mistral', 'openrouter'];

/**
 * Providers that can be given tools. Only the local rules engine cannot — it is not a model.
 *
 * Ollama accepts a `tools` array on /api/chat and returns `message.tool_calls`. Whether a given
 * model *uses* them well is another matter: small models often emit the call as fenced JSON in the
 * content instead, which callOllama below recovers.
 */
export const supportsTools = (provider) =>
  OPENAI_COMPATIBLE.includes(provider) || provider === 'anthropic' || provider === 'google' || provider === 'ollama';

const agentMaxTokens = () => Number(process.env.AI_AGENT_MAX_TOKENS || 16000);

const baseUrlFor = (provider) => {
  const env = PROVIDER_ENV[provider];
  return (process.env[env.baseUrl] || env.defaultBaseUrl).replace(/\/$/, '');
};

const requireKey = (provider, label) => {
  const env = PROVIDER_ENV[provider];
  const apiKey = process.env[env.apiKey];
  if (!apiKey) throw new Error(`${env.apiKey} is required for ${label}`);
  return apiKey;
};

/**
 * Tool inputs come back as JSON strings on some providers and as objects on others, and Claude 4.6+
 * may escape them differently (Unicode, forward slashes). Always parse; never string-match.
 */
const parseToolInput = (value) => {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

/* -------------------------------------------------------------------------- Anthropic ------- */

const toAnthropicMessages = (messages) => {
  const result = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
        ...(message.isError ? { is_error: true } : {}),
      };

      // Every tool_result for one assistant turn must arrive in a single user message; splitting
      // them teaches the model to stop making parallel calls.
      const previous = result[result.length - 1];
      if (previous?.role === 'user' && Array.isArray(previous.content)) {
        previous.content.push(block);
      } else {
        result.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (message.role === 'assistant' && message.raw) {
      result.push({ role: 'assistant', content: message.raw });
      continue;
    }

    result.push({ role: message.role, content: message.content });
  }

  return result;
};

const callAnthropic = async ({ model, system, messages, tools, httpClient }) => {
  const apiKey = requireKey('anthropic', 'Anthropic Claude');

  const body = {
    model: model.model,
    max_tokens: agentMaxTokens(),
    ...anthropicSamplingParams(model.model),
    system,
    messages: toAnthropicMessages(messages),
  };

  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));
  }

  const data = await postJson(httpClient, `${baseUrlFor('anthropic')}/v1/messages`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
    },
    body,
  });

  const content = Array.isArray(data?.content) ? data.content : [];

  return {
    text: content
      .filter((block) => block.type === 'text')
      .map((block) => block.text || '')
      .join('\n')
      .trim(),
    toolCalls: content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, input: parseToolInput(block.input) })),
    // Replayed verbatim next turn, which is what keeps thinking blocks intact.
    raw: content,
    stopReason: data?.stop_reason || null,
    usage: data?.usage || null,
    providerResponseId: data?.id || null,
  };
};

/* ----------------------------------------------------------------- OpenAI-compatible -------- */

const toOpenAiMessages = (system, messages) => {
  const result = system ? [{ role: 'system', content: system }] : [];

  for (const message of messages) {
    if (message.role === 'tool') {
      result.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      result.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input) },
        })),
      });
      continue;
    }

    result.push({ role: message.role, content: message.content });
  }

  return result;
};

const callOpenAiCompatible = async ({ model, system, messages, tools, httpClient }) => {
  const apiKey = requireKey(model.provider, model.label);
  const headers = { Authorization: `Bearer ${apiKey}` };

  if (model.provider === 'openrouter') {
    headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER || 'http://localhost';
    headers['X-Title'] = process.env.OPENROUTER_APP_TITLE || 'School AI Search';
  }

  const body = {
    model: model.model,
    messages: toOpenAiMessages(system, messages),
    temperature: Number(process.env.AI_TEMPERATURE || 0.2),
    max_tokens: agentMaxTokens(),
  };

  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  const data = await postJson(httpClient, `${baseUrlFor(model.provider)}/chat/completions`, {
    headers,
    body,
  });

  const choice = data?.choices?.[0]?.message || {};

  return {
    text: (choice.content || '').trim(),
    toolCalls: (choice.tool_calls || []).map((call) => ({
      id: call.id,
      name: call.function?.name,
      input: parseToolInput(call.function?.arguments),
    })),
    raw: null,
    stopReason: data?.choices?.[0]?.finish_reason || null,
    usage: data?.usage || null,
    providerResponseId: data?.id || null,
  };
};

/* ------------------------------------------------------------------------- Google ----------- */

const toGoogleContents = (messages) => {
  const result = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      const part = {
        functionResponse: {
          name: message.name,
          // Gemini requires an object here; wrap the tool's string output rather than sending bare
          // text, which it rejects.
          response: { result: message.content },
        },
      };

      const previous = result[result.length - 1];
      if (previous?.role === 'user' && previous.parts.every((entry) => entry.functionResponse)) {
        previous.parts.push(part);
      } else {
        result.push({ role: 'user', parts: [part] });
      }
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      result.push({
        role: 'model',
        parts: [
          ...(message.content ? [{ text: message.content }] : []),
          ...message.toolCalls.map((call) => ({
            functionCall: { name: call.name, args: call.input },
          })),
        ],
      });
      continue;
    }

    result.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    });
  }

  return result;
};

// Gemini's schema dialect is a subset of JSON Schema and rejects the annotation keywords the other
// providers ignore harmlessly.
const toGoogleSchema = (schema) => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(toGoogleSchema);

  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (['additionalProperties', '$schema', 'default', 'examples'].includes(key)) continue;
    result[key] = value && typeof value === 'object' ? toGoogleSchema(value) : value;
  }
  return result;
};

const callGoogle = async ({ model, system, messages, tools, httpClient }) => {
  const apiKey = requireKey('google', 'Google Gemini');

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: toGoogleContents(messages),
    generationConfig: {
      temperature: Number(process.env.AI_TEMPERATURE || 0.2),
      maxOutputTokens: agentMaxTokens(),
    },
  };

  if (tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: toGoogleSchema(tool.input_schema),
        })),
      },
    ];
  }

  const data = await postJson(
    httpClient,
    `${baseUrlFor('google')}/models/${encodeURIComponent(model.model)}:generateContent`,
    { headers: { 'x-goog-api-key': apiKey }, body },
  );

  const parts = data?.candidates?.[0]?.content?.parts || [];

  return {
    text: parts
      .filter((part) => part.text)
      .map((part) => part.text)
      .join('\n')
      .trim(),
    toolCalls: parts
      .filter((part) => part.functionCall)
      .map((part, index) => ({
        // Gemini does not issue call ids; synthesise stable ones so the loop can match results.
        id: `gemini-${index}-${part.functionCall.name}`,
        name: part.functionCall.name,
        input: parseToolInput(part.functionCall.args),
      })),
    raw: null,
    stopReason: data?.candidates?.[0]?.finishReason || null,
    usage: data?.usageMetadata || null,
    providerResponseId: data?.responseId || null,
  };
};

/* ------------------------------------------------------------------------- Ollama ----------- */

/**
 * Recovers a tool call a model wrote into its message text instead of returning structurally.
 *
 * Small local models do this constantly — they emit ```json {"name": "...", "arguments": {...}}```
 * rather than populating tool_calls. Without this the call is invisible and the caller reports the
 * model "finished without submitting anything", which is both wrong and unhelpful.
 */
const recoverToolCallFromText = (text, toolNames) => {
  if (!text || toolNames.length === 0) return [];

  // Prefer fenced blocks, then fall back to any balanced-looking object mentioning a known tool.
  const candidates = [...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((match) => match[1]);
  if (candidates.length === 0) candidates.push(String(text));

  const calls = [];
  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;

    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      const declared = parsed.name || parsed.tool || parsed.function?.name;
      const input = parseToolInput(
        parsed.arguments ?? parsed.parameters ?? parsed.input ?? parsed.function?.arguments ?? parsed,
      );

      // A model that names the call correctly is the easy case. Models also routinely put something
      // else in `name` — the topic, a title — while the payload is exactly right. Rejecting those on
      // the label alone threw away good work, so when a single tool is on offer the payload is
      // accepted whatever it was called.
      const name = toolNames.includes(declared)
        ? declared
        : toolNames.length === 1 && input && Object.keys(input).length > 0
          ? toolNames[0]
          : null;

      if (!name) continue;

      calls.push({ id: `recovered-${calls.length}`, name, input });
    } catch {
      // Not JSON, or truncated mid-object — nothing to recover from this candidate.
    }
  }

  return calls;
};

const callOllama = async ({ model, system, messages, tools, httpClient }) => {
  const baseUrl = (process.env.OLLAMA_BASE_URL || PROVIDER_ENV.ollama.defaultBaseUrl).replace(/\/$/, '');

  const body = {
    model: model.model,
    stream: false,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages.map((message) => {
        // Ollama identifies a tool result by `tool_name`, not by a call id — it has no
        // tool_call_id at all. Omitting it leaves parallel results ambiguous, because several
        // `tool` messages arrive in a row with nothing to say which call each answers.
        if (message.role === 'tool') {
          return { role: 'tool', tool_name: message.name, content: message.content };
        }
        if (message.role === 'assistant' && message.toolCalls?.length) {
          return {
            role: 'assistant',
            content: message.content || '',
            // `type` and `function.index` are part of the documented shape; index is what pairs a
            // call with its position when the model made several.
            tool_calls: message.toolCalls.map((call, index) => ({
              type: 'function',
              function: { index, name: call.name, arguments: call.input },
            })),
          };
        }
        return { role: message.role, content: message.content };
      }),
    ],
    options: { temperature: Number(process.env.AI_TEMPERATURE || 0.2) },
  };

  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
    }));
  }

  const data = await postJson(httpClient, `${baseUrl}/api/chat`, { body });

  const text = (data?.message?.content || '').trim();
  // Ollama returns arguments as an object rather than a JSON string, unlike OpenAI.
  const structured = (data?.message?.tool_calls || []).map((call, index) => ({
    id: `ollama-${index}-${call.function?.name}`,
    name: call.function?.name,
    input: parseToolInput(call.function?.arguments),
  }));

  const toolCalls =
    structured.length > 0 ? structured : recoverToolCallFromText(text, tools.map((tool) => tool.name));

  return {
    text,
    toolCalls,
    raw: null,
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
    usage: { prompt_eval_count: data?.prompt_eval_count, eval_count: data?.eval_count },
    providerResponseId: null,
  };
};

/**
 * One turn of the conversation. Returns the normalised
 * { text, toolCalls, raw, stopReason, usage, providerResponseId }.
 */
export const callModelWithTools = async ({ model, system, messages, tools = [], httpClient = fetch }) => {
  const params = { model, system, messages, tools, httpClient };

  if (OPENAI_COMPATIBLE.includes(model.provider)) return callOpenAiCompatible(params);
  if (model.provider === 'anthropic') return callAnthropic(params);
  if (model.provider === 'google') return callGoogle(params);
  if (model.provider === 'ollama') return callOllama(params);

  throw new Error(`Unsupported AI provider: ${model.provider}`);
};
