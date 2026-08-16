import type { AgentSessionConfig, McpServerConfig } from "./agent-sdk-types.js";

const PASEO_MCP_SERVER_NAME = "paseo";
const runtimePaseoMcpServers = new WeakSet<object>();

export function isRuntimePaseoMcpServer(config: McpServerConfig): boolean {
  return runtimePaseoMcpServers.has(config);
}

export function stripInternalPaseoMcpServer(config: AgentSessionConfig): AgentSessionConfig {
  const mcpServers = config.mcpServers;
  if (!mcpServers) {
    return config;
  }

  const paseoServer = mcpServers[PASEO_MCP_SERVER_NAME];
  if (
    !paseoServer ||
    (!isRuntimePaseoMcpServer(paseoServer) && !isLegacyLocalPaseoMcpServer(paseoServer))
  ) {
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
  /** Exact role-ceiling tools that providers may run without a second approval prompt. */
  preapprovedTools?: readonly string[];
  /** Non-secret daemon-run identity used to force provider MCP reconnection after resume. */
  mcpRuntimeId?: string;
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

  const runtimeUrl = new URL(params.mcpBaseUrl);
  runtimeUrl.searchParams.set("callerAgentId", params.agentId);
  if (params.mcpRuntimeId) {
    runtimeUrl.searchParams.set("runtimeInstanceId", params.mcpRuntimeId);
  }
  const runtimeServer: McpServerConfig = {
    type: "http",
    url: runtimeUrl.toString(),
    ...(params.mcpAuthToken ? { headers: { Authorization: `Bearer ${params.mcpAuthToken}` } } : {}),
  };
  runtimePaseoMcpServers.add(runtimeServer);

  const existingPreapprovals = storedConfig.toolPolicy?.preapproved ?? [];
  const preapprovedTools = Array.from(new Set(params.preapprovedTools ?? []));
  const paseoPreapprovals = preapprovedTools
    .filter(
      (tool) =>
        !existingPreapprovals.some(
          (grant) =>
            grant.kind === "mcp" && grant.server === PASEO_MCP_SERVER_NAME && grant.tool === tool,
        ),
    )
    .map((tool) => ({ kind: "mcp" as const, server: PASEO_MCP_SERVER_NAME, tool }));

  return {
    ...storedConfig,
    ...(paseoPreapprovals.length > 0
      ? { toolPolicy: { preapproved: [...existingPreapprovals, ...paseoPreapprovals] } }
      : {}),
    mcpServers: {
      [PASEO_MCP_SERVER_NAME]: runtimeServer,
      ...storedConfig.mcpServers,
    },
  };
}

function isLegacyLocalPaseoMcpServer(config: McpServerConfig): boolean {
  if (config.type !== "http" && config.type !== "sse") return false;
  try {
    const url = new URL(config.url);
    const isLoopback =
      url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    return (
      isLoopback && url.pathname === "/mcp/agents" && Boolean(url.searchParams.get("callerAgentId"))
    );
  } catch {
    return false;
  }
}
