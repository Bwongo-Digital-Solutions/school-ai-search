/**
 * Minimal Model Context Protocol client (Streamable HTTP transport).
 *
 * Speaks JSON-RPC 2.0 over a single POST endpoint: `initialize`, then `tools/list`, then
 * `tools/call`. That is the whole surface the agent needs — resources, prompts, sampling and the
 * SSE notification channel are deliberately not implemented, because nothing here consumes them.
 *
 * Uses the same injectable httpClient as every other outbound call, so an MCP server is mocked in
 * tests exactly the way an LLM provider is.
 */

const PROTOCOL_VERSION = '2025-06-18';

const CLIENT_INFO = { name: 'schoolbot-ai', version: '1.0.0' };

// A remote server is a third party we do not control; a hung connection must not hold a teacher's
// request open indefinitely.
const REQUEST_TIMEOUT_MS = Number(process.env.MCP_TIMEOUT_MS || 20000);

/** Tools discovered over MCP are namespaced so they can never collide with a built-in tool name. */
export const MCP_TOOL_PREFIX = 'mcp__';

export const namespaceToolName = (serverName, toolName) =>
  `${MCP_TOOL_PREFIX}${String(serverName).replace(/[^a-zA-Z0-9_-]/g, '_')}__${toolName}`;

export const parseNamespacedToolName = (name) => {
  if (!String(name || '').startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const separator = rest.indexOf('__');
  if (separator === -1) return null;
  return { serverKey: rest.slice(0, separator), toolName: rest.slice(separator + 2) };
};

/**
 * A Streamable HTTP server may answer a POST with either a JSON body or an SSE stream carrying the
 * same JSON-RPC envelope. Both are valid; parse whichever arrived.
 */
const readRpcResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;

  const contentType = response.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`MCP server returned a non-JSON response: ${text.slice(0, 200)}`);
    }
  }

  // Take the last `data:` payload that parses as a JSON-RPC envelope carrying our result.
  let parsed = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const candidate = JSON.parse(payload);
      if (candidate && (candidate.result !== undefined || candidate.error !== undefined)) {
        parsed = candidate;
      }
    } catch {
      // Ignore keep-alive and partial frames.
    }
  }
  return parsed;
};

const createTransport = ({ url, authToken, httpClient }) => {
  let sessionId = null;
  let nextId = 0;

  const send = async (method, params, { notification = false } = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    };

    const body = notification
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id: (nextId += 1), method, params };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
      response = await httpClient(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    // The server assigns a session on initialize and expects it echoed on every later call.
    const assigned = response.headers?.get?.('mcp-session-id');
    if (assigned) sessionId = assigned;

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`MCP request ${method} failed with ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }

    // Notifications are answered with 202 and no body.
    if (notification) return null;

    const envelope = await readRpcResponse(response);
    if (envelope?.error) {
      throw new Error(envelope.error.message || `MCP request ${method} failed`);
    }
    return envelope?.result ?? null;
  };

  return { send };
};

/**
 * Handshakes with a server and lists its tools.
 *
 * Returns { serverInfo, tools } where each tool already carries its namespaced `name` and the
 * `input_schema` key the agent's tool registry expects, so a discovered tool drops straight into
 * the same array as a built-in one.
 */
export const connectMcpServer = async ({ name, url, authToken, httpClient = fetch }) => {
  const transport = createTransport({ url, authToken, httpClient });

  const initialised = await transport.send('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    clientInfo: CLIENT_INFO,
  });

  // Required by the spec: the server may reject tools/list until it has been told the handshake
  // completed. Best-effort — some servers answer 404 to notifications and still work.
  await transport.send('notifications/initialized', {}, { notification: true }).catch(() => null);

  const listed = await transport.send('tools/list', {});
  const tools = (listed?.tools || []).map((tool) => ({
    name: namespaceToolName(name, tool.name),
    remoteName: tool.name,
    description: tool.description || `${tool.name} (via ${name})`,
    input_schema: tool.inputSchema || tool.input_schema || { type: 'object', properties: {} },
  }));

  return {
    serverInfo: initialised?.serverInfo || { name },
    tools,
    transport,
  };
};

/**
 * Calls one tool on a server, returning its text content.
 *
 * MCP returns content as typed blocks; the agent loop feeds tool output back as a string, so text
 * blocks are joined and anything else is described rather than dropped silently.
 */
export const callMcpTool = async ({ transport, toolName, args }) => {
  const result = await transport.send('tools/call', { name: toolName, arguments: args || {} });

  const blocks = Array.isArray(result?.content) ? result.content : [];
  const text = blocks
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'resource') return block.resource?.text || `[resource ${block.resource?.uri || ''}]`;
      return `[${block.type} content omitted]`;
    })
    .filter(Boolean)
    .join('\n')
    .trim();

  return {
    content: text || 'The tool returned no content.',
    isError: Boolean(result?.isError),
  };
};

/**
 * Connects every enabled server and returns their tools plus a per-tool dispatcher.
 *
 * One unreachable server must not take the others down, nor block the chat: failures are collected
 * and reported alongside whatever did connect.
 */
export const loadMcpTools = async ({ servers, httpClient = fetch }) => {
  const tools = [];
  const errors = [];

  await Promise.all(
    (servers || []).map(async (server) => {
      try {
        const connection = await connectMcpServer({
          name: server.name,
          url: server.url,
          authToken: server.auth_token,
          httpClient,
        });

        for (const tool of connection.tools) {
          tools.push({
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema,
            source: 'mcp',
            serverId: server.id,
            serverName: server.name,
            handler: async (args) => {
              const { content, isError } = await callMcpTool({
                transport: connection.transport,
                toolName: tool.remoteName,
                args,
              });
              if (isError) throw new Error(content);
              return content;
            },
          });
        }
      } catch (error) {
        errors.push({
          serverId: server.id,
          serverName: server.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  return { tools, errors };
};
