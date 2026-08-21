/**
 * SchoolBot's own MCP server — the outbound half of the MCP support.
 *
 * Exposes the same tool registry the chat and the two teaching modules use, over JSON-RPC 2.0 on
 * POST /api/mcp, so Claude Desktop, Claude Code or any other MCP client can query the school's
 * records and curriculum directly.
 *
 * Because the registry is shared, a tool added for the chat is automatically available here — there
 * is no second definition to keep in step.
 *
 * Auth is a bearer token (MCP_SERVER_TOKEN). Unset means the server is disabled rather than open:
 * these tools read student records, so failing closed is the only safe default.
 */
import { buildToolRegistry } from '../agent/tools.mjs';
import { createAgentContext } from '../agent/loop.mjs';

const PROTOCOL_VERSION = '2025-06-18';

const SERVER_INFO = { name: 'schoolbot-ai', version: '1.0.0' };

// The role an MCP client acts as. Token holders are trusted staff integrations, but they are not
// interactive administrators, so they get the teacher tool surface rather than everything.
const MCP_CLIENT_ROLE = process.env.MCP_SERVER_ROLE || 'teacher';

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// JSON-RPC 2.0 reserved codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

export const isMcpServerEnabled = () => Boolean(process.env.MCP_SERVER_TOKEN);

const isAuthorized = (headers = {}) => {
  const token = process.env.MCP_SERVER_TOKEN;
  if (!token) return false;

  const supplied = String(headers.authorization || headers.Authorization || '');
  return supplied === `Bearer ${token}`;
};

/**
 * Handles one JSON-RPC request.
 *
 * Returns { status, body } rather than writing a response, so it slots into the same dispatch
 * contract every other route here uses and stays testable without a socket.
 */
export const handleMcpServerRequest = async ({ database, body, headers = {}, httpClient = fetch }) => {
  if (!isMcpServerEnabled()) {
    return {
      status: 404,
      body: rpcError(null, METHOD_NOT_FOUND, 'The MCP server is not enabled. Set MCP_SERVER_TOKEN to enable it.'),
    };
  }

  if (!isAuthorized(headers)) {
    return { status: 401, body: rpcError(null, INVALID_REQUEST, 'Unauthorized') };
  }

  if (!body || typeof body !== 'object') {
    return { status: 400, body: rpcError(null, PARSE_ERROR, 'Malformed JSON-RPC request') };
  }

  const { id = null, method, params = {} } = body;

  // A notification carries no id and expects no result, only an acknowledgement.
  const isNotification = id === null || id === undefined;

  if (method === 'initialize') {
    return {
      status: 200,
      body: rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      }),
    };
  }

  if (String(method || '').startsWith('notifications/')) {
    return { status: 202, body: null };
  }

  const registry = buildToolRegistry({ requesterRole: MCP_CLIENT_ROLE });

  if (method === 'tools/list') {
    return {
      status: 200,
      body: rpcResult(id, {
        tools: registry.definitions.map((definition) => ({
          name: definition.name,
          description: definition.description,
          inputSchema: definition.input_schema,
        })),
      }),
    };
  }

  if (method === 'tools/call') {
    const tool = registry.get(params.name);
    if (!tool) {
      return { status: 200, body: rpcError(id, METHOD_NOT_FOUND, `Unknown tool: ${params.name}`) };
    }

    const context = createAgentContext({
      database,
      httpClient,
      requesterRole: MCP_CLIENT_ROLE,
      actor: { name: 'MCP client', role: MCP_CLIENT_ROLE },
    });

    try {
      const output = await tool.handler(params.arguments || {}, context);
      return {
        status: 200,
        body: rpcResult(id, { content: [{ type: 'text', text: String(output) }], isError: false }),
      };
    } catch (error) {
      // A tool failure is a result the client can read and retry from, not a transport error.
      return {
        status: 200,
        body: rpcResult(id, {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        }),
      };
    }
  }

  if (isNotification) {
    return { status: 202, body: null };
  }

  return { status: 200, body: rpcError(id, METHOD_NOT_FOUND, `Unsupported method: ${method}`) };
};
