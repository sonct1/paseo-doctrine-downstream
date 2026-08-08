import type { AgentSessionConfig, McpServerConfig } from "./agent-sdk-types.js";

const PASEO_MCP_SERVER_NAME = "paseo";
const RUNTIME_PASEO_MCP_SERVER = Symbol("runtime-paseo-mcp-server");

type RuntimePaseoMcpServerConfig = McpServerConfig & {
  [RUNTIME_PASEO_MCP_SERVER]: true;
};

export function isRuntimePaseoMcpServer(
  config: McpServerConfig,
): config is RuntimePaseoMcpServerConfig {
  return (config as Partial<RuntimePaseoMcpServerConfig>)[RUNTIME_PASEO_MCP_SERVER] === true;
}

export function stripInternalPaseoMcpServer(config: AgentSessionConfig): AgentSessionConfig {
  const mcpServers = config.mcpServers;
  if (!mcpServers) {
    return config;
  }

  const paseoServer = mcpServers[PASEO_MCP_SERVER_NAME];
  if (!paseoServer || !isRuntimePaseoMcpServer(paseoServer)) {
    return config;
  }

  const nextMcpServers = { ...mcpServers };
  delete nextMcpServers[PASEO_MCP_SERVER_NAME];

  const next = { ...config };
  if (Object.keys(nextMcpServers).length > 0) {
    next.mcpServers = nextMcpServers;
  } else {
    delete next.mcpServers;
  }
  return next;
}

export function withRuntimePaseoMcpServer(params: {
  config: AgentSessionConfig;
  agentId: string;
  mcpBaseUrl: string | null;
  /**
   * Capability token authenticating the injected connection to the daemon's
   * Agent MCP endpoint. The daemon password is gated off this route, so without
   * this header the agent's MCP requests are rejected when a password is set.
   */
  mcpAuthToken: string | null;
}): AgentSessionConfig {
  const storedConfig = stripInternalPaseoMcpServer(params.config);
  if (!params.mcpBaseUrl) {
    return storedConfig;
  }
  if (storedConfig.mcpServers?.[PASEO_MCP_SERVER_NAME]) {
    throw new Error(`MCP server name ${PASEO_MCP_SERVER_NAME} is reserved for Paseo runtime`);
  }

  const runtimeServer: RuntimePaseoMcpServerConfig = {
    type: "http",
    url: `${params.mcpBaseUrl}?callerAgentId=${params.agentId}`,
    ...(params.mcpAuthToken ? { headers: { Authorization: `Bearer ${params.mcpAuthToken}` } } : {}),
    [RUNTIME_PASEO_MCP_SERVER]: true,
  };

  return {
    ...storedConfig,
    mcpServers: {
      [PASEO_MCP_SERVER_NAME]: runtimeServer,
      ...storedConfig.mcpServers,
    },
  };
}
