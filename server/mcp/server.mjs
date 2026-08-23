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
const DEFAULT_MCP_ROLE = 'teacher';

// Roles an MCP token may be issued for. Support staff are excluded: their access is the fee-status
// endpoint, not a tool surface.
const MCP_ROLES = ['admin', 'teacher'];

/**
 * Resolves the bearer token presented by a client to the role it acts as.
 *
 * MCP_SERVER_TOKENS is a JSON map of token to role, so a school can issue one token for
 * administrators and another for teachers and have each LibreChat user see only the tools their
 * role allows — buildToolRegistry() already filters by role, so this is a lookup, not new gating.
 * MCP_SERVER_TOKEN + MCP_SERVER_ROLE remain supported as the single-token form.
 */
const tokenRoles = () => {
  const map = new Map();

  if (process.env.MCP_SERVER_TOKENS) {
    try {
      for (const [token, role] of Object.entries(JSON.parse(process.env.MCP_SERVER_TOKENS))) {
        if (token && MCP_ROLES.includes(role)) map.set(token, role);
      }
    } catch (error) {
      console.warn('Invalid MCP_SERVER_TOKENS JSON:', error instanceof Error ? error.message : error);
    }
  }

  if (process.env.MCP_SERVER_TOKEN) {
    const role = MCP_ROLES.includes(process.env.MCP_SERVER_ROLE)
      ? process.env.MCP_SERVER_ROLE
      : DEFAULT_MCP_ROLE;
    map.set(process.env.MCP_SERVER_TOKEN, role);
  }

  return map;
};

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// JSON-RPC 2.0 reserved codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

export const isMcpServerEnabled = () => tokenRoles().size > 0;

/** Returns the role the presented token grants, or null when it grants nothing. */
const roleForRequest = (headers = {}) => {
  const supplied = String(headers.authorization || headers.Authorization || '');
  if (!supplied.startsWith('Bearer ')) return null;

  return tokenRoles().get(supplied.slice(7)) || null;
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

  const role = roleForRequest(headers);
  if (!role) {
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

  const registry = buildToolRegistry({ requesterRole: role });

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
      requesterRole: role,
      actor: { name: 'MCP client', role },
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
