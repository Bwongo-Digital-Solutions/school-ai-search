/**
 * Registry of external MCP servers an administrator has connected to this school.
 *
 * Reached through POST /api/functions/mcp. Admin-only throughout: registering an MCP server hands a
 * third party a tool surface inside the assistant, which is an administrator's decision, not a
 * teacher's. Teachers then choose which of the registered servers to enable per chat message.
 *
 * auth_token never leaves the server. Reads return a masked placeholder, and a save that omits the
 * token keeps the stored one — so editing a server's URL does not silently blank its credential.
 */
import { randomUUID } from 'node:crypto';

import { connectMcpServer } from '../agent/mcp-client.mjs';

const trimmed = (value) => String(value ?? '').trim();

const PUBLIC_COLUMNS =
  'id, name, url, transport, enabled, last_connected_at, last_error, discovered_tools, created_by, created_at, updated_at';

// What the browser sees in place of a stored credential. Never the token, never its length.
const TOKEN_PLACEHOLDER = '••••••••';

const toPublic = (row) => ({
  ...row,
  hasAuthToken: Boolean(row.auth_token),
  auth_token: row.auth_token ? TOKEN_PLACEHOLDER : '',
});

const listServers = async ({ database }) => {
  const { rows } = await database.query(
    `SELECT ${PUBLIC_COLUMNS}, auth_token FROM mcp_servers ORDER BY name`,
  );
  return { servers: rows.map(toPublic) };
};

const isSafeUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

const saveServer = async ({ database, body, actor }) => {
  const name = trimmed(body.name);
  const url = trimmed(body.url);

  if (!name) return { error: 'A server name is required' };
  if (!isSafeUrl(url)) return { error: 'The server URL must be a valid http(s) URL' };

  const id = trimmed(body.id);
  const enabled = body.enabled !== false;
  // An omitted token means "leave it as it is"; an explicitly empty string clears it.
  const tokenSupplied = Object.prototype.hasOwnProperty.call(body, 'authToken');
  const token = trimmed(body.authToken);

  if (id) {
    const { rows: existing } = await database.query('SELECT auth_token FROM mcp_servers WHERE id = $1', [id]);
    if (!existing[0]) return { error: 'MCP server not found' };

    const { rows } = await database.query(
      `
        UPDATE mcp_servers
        SET name = $1, url = $2, auth_token = $3, enabled = $4, updated_at = NOW()
        WHERE id = $5
        RETURNING ${PUBLIC_COLUMNS}, auth_token
      `,
      [name, url, tokenSupplied ? token : existing[0].auth_token, enabled, id],
    );

    return { server: toPublic(rows[0]) };
  }

  const { rows } = await database.query(
    `
      INSERT INTO mcp_servers (id, name, url, auth_token, enabled, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING ${PUBLIC_COLUMNS}, auth_token
    `,
    [randomUUID(), name, url, token, enabled, actor.email || actor.name],
  );

  return { server: toPublic(rows[0]) };
};

const deleteServer = async ({ database, body }) => {
  const id = trimmed(body.id);
  if (!id) return { error: 'A server id is required' };

  await database.query('DELETE FROM mcp_servers WHERE id = $1', [id]);
  return { deleted: { id } };
};

/**
 * Handshakes with a registered server and caches its tool list.
 *
 * Records the outcome either way: a failure is stored in last_error so the settings screen can show
 * why a server is not contributing tools, instead of it silently offering none.
 */
const testServer = async ({ database, body, httpClient }) => {
  const id = trimmed(body.id);
  if (!id) return { error: 'A server id is required' };

  const { rows } = await database.query('SELECT id, name, url, auth_token FROM mcp_servers WHERE id = $1', [id]);
  const server = rows[0];
  if (!server) return { error: 'MCP server not found' };

  try {
    const connection = await connectMcpServer({
      name: server.name,
      url: server.url,
      authToken: server.auth_token,
      httpClient,
    });

    const tools = connection.tools.map((tool) => ({
      name: tool.name,
      remoteName: tool.remoteName,
      description: tool.description,
    }));

    await database.query(
      `
        UPDATE mcp_servers
        SET discovered_tools = $1, last_connected_at = NOW(), last_error = '', updated_at = NOW()
        WHERE id = $2
      `,
      [JSON.stringify(tools), id],
    );

    return { connected: true, serverInfo: connection.serverInfo, tools };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await database.query('UPDATE mcp_servers SET last_error = $1, updated_at = NOW() WHERE id = $2', [message, id]);
    return { connected: false, error: message };
  }
};

const ACTIONS = {
  list: listServers,
  save: saveServer,
  delete: deleteServer,
  test: testServer,
};

export const MCP_ACTIONS = Object.keys(ACTIONS);

/**
 * Loads the enabled servers *with* their tokens, for the agent to connect with.
 *
 * Server-side callers only — the returned rows carry live credentials and must never be serialised
 * into an HTTP response.
 */
export const loadEnabledMcpServers = async (database, { ids = null } = {}) => {
  try {
    const { rows } = await database.query(
      'SELECT id, name, url, auth_token FROM mcp_servers WHERE enabled = TRUE ORDER BY name',
    );
    if (!Array.isArray(ids)) return rows;

    const wanted = new Set(ids.map(String));
    return rows.filter((row) => wanted.has(row.id));
  } catch {
    // The table may not exist on a database that predates this feature.
    return [];
  }
};

export const handleMcpFunction = async (database, body = {}, httpClient = fetch) => {
  if (body.requesterRole !== 'admin') return { error: 'Unauthorized' };

  const handler = ACTIONS[body.action];
  if (!handler) return { error: `Unsupported MCP action: ${body.action}` };

  const actor = {
    email: trimmed(body.actorEmail),
    name: trimmed(body.actorName),
    role: body.requesterRole,
  };

  return handler({ database, body, actor, httpClient });
};
