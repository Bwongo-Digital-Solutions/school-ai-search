/**
 * The agent loop: call the model, run whatever tools it asks for, feed the results back, repeat.
 *
 * Bounded on purpose. A school deployment pays per token and a runaway loop is both a bill and a
 * hung request, so the loop stops at AI_AGENT_MAX_STEPS and returns whatever it has — a partial
 * answer with a note beats a timeout. Every step is recorded and returned so the chat window can
 * show what the assistant actually did rather than asking the user to trust it.
 */
import { callModelWithTools, supportsTools } from './providers.mjs';

const DEFAULT_MAX_STEPS = Number(process.env.AI_AGENT_MAX_STEPS || 6);

// Tool output goes back into the prompt, so an unbounded result would blow the context window on a
// single careless query. Truncation is announced in the text the model sees, so it knows to narrow
// its filter rather than assuming it saw everything.
const MAX_TOOL_RESULT_CHARS = Number(process.env.AI_TOOL_RESULT_MAX_CHARS || 12000);

const truncate = (text) => {
  const value = String(text ?? '');
  if (value.length <= MAX_TOOL_RESULT_CHARS) return value;
  return `${value.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[Output truncated. Narrow your filter and call the tool again if you need more.]`;
};

const mergeUsage = (total, usage) => {
  if (!usage) return total;

  // Providers disagree on field names; sum whatever each one supplies rather than normalising to a
  // single vocabulary and silently dropping the rest.
  const next = { ...total };
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === 'number') {
      next[key] = (next[key] || 0) + value;
    }
  }
  return next;
};

/**
 * Runs one tool call, converting any failure into a tool result the model can read and recover
 * from. A thrown error must not abort the turn: the model can often retry with better arguments,
 * and an is_error result is how it is told to.
 */
const executeTool = async (registry, call, context) => {
  const started = Date.now();
  const tool = registry.get(call.name);

  if (!tool) {
    return {
      step: { tool: call.name, input: call.input, output: `Unknown tool: ${call.name}`, ms: 0, isError: true },
      message: {
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: `Unknown tool: ${call.name}. Available tools: ${registry.names.join(', ')}.`,
        isError: true,
      },
    };
  }

  try {
    const output = truncate(await tool.handler(call.input || {}, context));
    return {
      step: { tool: call.name, input: call.input, output, ms: Date.now() - started, isError: false },
      message: { role: 'tool', toolCallId: call.id, name: call.name, content: output },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      step: { tool: call.name, input: call.input, output: message, ms: Date.now() - started, isError: true },
      message: {
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: `Tool ${call.name} failed: ${message}`,
        isError: true,
      },
    };
  }
};

/**
 * Drives the conversation to completion.
 *
 * Returns { message, steps, usage, citations, stoppedAtStepLimit, finalToolInput }.
 * `finalToolInput` carries the arguments of the last call to `terminalTool`, which is how the
 * Digital Examiner gets structured JSON out of a provider-neutral loop: it declares a
 * `submit_questions` tool and reads the arguments the model passed rather than parsing prose.
 */
export const runAgent = async ({
  model,
  system,
  messages,
  registry,
  context,
  maxSteps = DEFAULT_MAX_STEPS,
  terminalTool = null,
  httpClient = fetch,
}) => {
  const steps = [];
  const conversation = [...messages];
  let usage = {};
  let finalToolInput = null;
  let lastText = '';

  // Ollama and the local rules engine cannot call tools; retrieval has already been folded into the
  // system prompt for them, so one plain turn is the whole interaction.
  const tools = supportsTools(model.provider) ? registry.definitions : [];

  for (let step = 0; step < maxSteps; step += 1) {
    const response = await callModelWithTools({
      model,
      system,
      messages: conversation,
      tools,
      httpClient,
    });

    usage = mergeUsage(usage, response.usage);
    if (response.text) lastText = response.text;

    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        message: response.text || lastText,
        steps,
        usage,
        citations: context.citations,
        stoppedAtStepLimit: false,
        finalToolInput,
        providerResponseId: response.providerResponseId,
      };
    }

    conversation.push({
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls,
      raw: response.raw,
    });

    // Parallel calls run concurrently and every result goes back in one batch — splitting them
    // across turns trains the model out of making parallel calls at all.
    const results = await Promise.all(
      response.toolCalls.map((call) => executeTool(registry, call, context)),
    );

    for (const result of results) {
      steps.push(result.step);
      conversation.push(result.message);
    }

    if (terminalTool) {
      const terminal = response.toolCalls.find((call) => call.name === terminalTool);
      if (terminal) {
        return {
          message: response.text || lastText,
          steps,
          usage,
          citations: context.citations,
          stoppedAtStepLimit: false,
          finalToolInput: terminal.input,
          providerResponseId: response.providerResponseId,
        };
      }
    }
  }

  return {
    message:
      lastText ||
      `I stopped after ${maxSteps} tool steps without reaching an answer. Try narrowing the question.`,
    steps,
    usage,
    citations: context.citations,
    stoppedAtStepLimit: true,
    finalToolInput,
    providerResponseId: null,
  };
};

/**
 * The per-request context handed to every tool handler.
 *
 * `citations` is a live array the retrieval tool appends to, so whatever the model was shown is
 * exactly what gets persisted and rendered — the numbering cannot drift between the two.
 */
export const createAgentContext = ({ database, httpClient = fetch, actor = {}, requesterRole = 'teacher' }) => ({
  database,
  httpClient,
  actor,
  requesterRole,
  citations: [],
});
