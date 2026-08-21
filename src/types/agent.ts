import type { Citation } from './teaching';

/** One tool the agent executed, as recorded on an assistant message. */
export interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  ms: number;
  isError: boolean;
}

/** How a chat message was answered. */
export type ChatMode = 'local' | 'direct' | 'direct-fallback' | 'agent';

export interface McpToolSummary {
  name: string;
  remoteName: string;
  description: string;
}

export interface McpServer {
  id: string;
  name: string;
  url: string;
  /** Always a mask or empty — the real token never leaves the server. */
  auth_token: string;
  hasAuthToken: boolean;
  transport: string;
  enabled: boolean;
  last_connected_at: string | null;
  last_error: string;
  discovered_tools: McpToolSummary[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface McpServerError {
  serverId: string;
  serverName: string;
  message: string;
}

/** The options a teacher sets per message in the chat composer. */
export interface ChatOptions {
  agentMode: boolean;
  useRag: boolean;
  mcpServerIds: string[];
}

export { type Citation };
