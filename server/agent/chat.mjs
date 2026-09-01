/**
 * Chat orchestration: decides how a message gets answered.
 *
 * Three modes, in increasing capability:
 *
 *   local  — the rules engine in services/student-chat.mjs. No network, no keys.
 *   direct — one model call with the roster (and any retrieved passages) in the prompt. What the
 *            chat has always done, plus retrieval and conversation history.
 *   agent  — a bounded tool-calling loop with the school tool registry and any MCP servers the
 *            teacher enabled for this message.
 *
 * Lives here rather than in local-backend.mjs so the 2000-line request file does not absorb the
 * whole feature, and so the modes can be tested directly.
 */
import { loadMcpTools } from './mcp-client.mjs';
import { createAgentContext, runAgent } from './loop.mjs';
import { buildToolRegistry } from './tools.mjs';
import { supportsTools } from './providers.mjs';
import { loadEnabledMcpServers } from '../services/mcp-servers.mjs';
import { formatCitationsForPrompt, retrieveCurriculum, toStoredCitations } from '../rag/retriever.mjs';
import { generateLlmSearchReply } from '../services/llm-models.mjs';

// How many prior turns to replay. The chat sent none at all before this, so anything is an
// improvement; 8 keeps a normal follow-up conversation coherent without unbounded prompt growth.
const HISTORY_TURNS = Number(process.env.AI_HISTORY_TURNS || 8);

/**
 * Replays recent turns of the conversation.
 *
 * Excludes the message just written for this request (the caller inserts the user turn before
 * calling), and drops a leading assistant turn — every provider requires the first message after
 * the system prompt to be from the user.
 */
export const loadHistory = async (database, conversationId, { excludeMessageId = null } = {}) => {
  if (!conversationId) return [];

  const { rows } = await database.query(
    `
      SELECT id, role, content
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [conversationId, HISTORY_TURNS * 2],
  );

  const ordered = rows
    .filter((row) => row.id !== excludeMessageId && String(row.content || '').trim())
    .reverse()
    .map((row) => ({ role: row.role, content: row.content }));

  while (ordered.length > 0 && ordered[0].role !== 'user') {
    ordered.shift();
  }

  return ordered;
};

const buildSystemPrompt = ({ students, citations, actor }) =>
  [
    'You are  SchoolBot AI, the assistant for eschool management system.',
    `You are helping ${actor.name || 'a member of staff'} (${actor.role}).`,
    '',
    'Rules:',
    '- Use your tools to look things up. Never guess at student records, grades, fees, attendance',
    '  or syllabus content — call a tool instead.',
    '- Answer in concise Markdown.',
    '- Always provide a source of your findings, if it actually does not exist, say so.',
    '- When you use a retrieved syllabus passage, cite it as [1], [2] and so on.',
    '- If a tool returns nothing useful, say so plainly rather than filling the gap yourself. Never returns false information.',
    '',
    `The school currently has ${students} student records. Use search_students to find specific ones.`,
    citations.length > 0
      ? ['', 'Curriculum passages already retrieved for this question:', formatCitationsForPrompt(citations)].join('\n')
      : '',
  ]
    .filter((line) => line !== '')
    .join('\n');

/**
 * Answers one chat message.
 *
 * Returns the same { message, studentsFound, ... } shape the chat has always used, plus `steps` and
 * `citations` when the agent ran, so the UI can show what happened. Never throws for a provider
 * failure — the caller renders the returned error text as the assistant's reply.
 */
export const answerChatMessage = async ({
  database,
  model,
  message,
  students,
  hasImage,
  conversationId,
  excludeMessageId,
  mode = 'direct',
  useRag = false,
  mcpServerIds = null,
  actor,
  httpClient = fetch,
  generateLocalReply,
  // Map of student id -> fee summary. Only the rules engine uses it; the agent path fetches the
  // full history on demand through the student_payment_history tool instead of carrying it here.
  feeSummaries = null,
}) => {
  const history = await loadHistory(database, conversationId, { excludeMessageId });

  // Retrieval is independent of mode: even a single-shot call answers better with the syllabus in
  // front of it, and the local rules engine ignores it harmlessly.
  let citations = [];
  if (useRag && message) {
    citations = await retrieveCurriculum(database, { query: message, limit: 6, httpClient });
  }

  if (model.provider === 'local_rules') {
    const reply = generateLocalReply({ message, students, hasImage, feeSummaries });
    return { ...reply, steps: [], citations: toStoredCitations(citations), mode: 'local' };
  }

  // Agent mode needs a provider that can call tools; Ollama cannot, so it falls back to a direct
  // call with the retrieved context rather than silently doing nothing useful.
  const canRunAgent = mode === 'agent' && supportsTools(model.provider);

  if (!canRunAgent) {
    const reply = await generateLlmSearchReply({
      modelId: model.id,
      message,
      students,
      hasImage,
      contextBlocks: citations.length > 0 ? formatCitationsForPrompt(citations) : '',
      history,
      httpClient,
    });

    return {
      ...reply,
      steps: [],
      citations: toStoredCitations(citations),
      mode: mode === 'agent' ? 'direct-fallback' : 'direct',
      ...(mode === 'agent'
        ? { notice: `${model.label} cannot call tools, so this was answered without them.` }
        : {}),
    };
  }

  // MCP tools are loaded per message: a teacher picks which registered servers to bring in, and an
  // unreachable one is reported alongside the answer rather than failing the whole request.
  let mcpTools = [];
  let mcpErrors = [];
  if (Array.isArray(mcpServerIds) && mcpServerIds.length > 0) {
    const servers = await loadEnabledMcpServers(database, { ids: mcpServerIds });
    ({ tools: mcpTools, errors: mcpErrors } = await loadMcpTools({ servers, httpClient }));
  }

  const context = createAgentContext({ database, httpClient, actor, requesterRole: actor.role });
  context.citations.push(...citations);

  const registry = buildToolRegistry({ requesterRole: actor.role, extraTools: mcpTools });

  const result = await runAgent({
    model,
    system: buildSystemPrompt({ students: students.length, citations, actor }),
    messages: [...history, { role: 'user', content: message || 'Please analyse this request.' }],
    registry,
    context,
    httpClient,
  });

  return {
    message: result.message || 'The model returned an empty response.',
    // What the agent actually looked at, rather than the size of the roster it was handed.
    studentsFound: result.steps.filter((step) => step.tool === 'search_students').length > 0 ? students.length : 0,
    steps: result.steps,
    citations: toStoredCitations(result.citations),
    mode: 'agent',
    mcpErrors,
    stoppedAtStepLimit: result.stoppedAtStepLimit,
    usage: result.usage,
    providerResponseId: result.providerResponseId,
    toolsAvailable: registry.names,
  };
};
