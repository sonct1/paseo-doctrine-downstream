import { describe, expect, test } from "vitest";

import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { withRuntimePaseoMcpServer } from "./runtime-mcp-config.js";

const BASE_CONFIG: AgentSessionConfig = {
  provider: "claude",
  cwd: "/tmp/agent",
};

describe("withRuntimePaseoMcpServer", () => {
  test("injects the paseo MCP server with a bearer header when a token is provided", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers?.paseo).toMatchObject({
      type: "http",
      url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1",
      headers: { Authorization: "Bearer cap-token" },
    });
  });

  test("omits the header when no token is available", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
      mcpAuthToken: null,
    });

    expect(result.mcpServers?.paseo).toMatchObject({
      type: "http",
      url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1",
    });
  });

  test("adds a non-secret daemon-run marker so resumed providers reconnect MCP", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
      mcpAuthToken: "cap-token",
      mcpRuntimeId: "daemon-run-2",
    });

    expect(result.mcpServers?.paseo).toMatchObject({
      type: "http",
      url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1&runtimeInstanceId=daemon-run-2",
    });
  });

  test("adds exact role-tool preapprovals for the injected paseo server", () => {
    const result = withRuntimePaseoMcpServer({
      config: {
        ...BASE_CONFIG,
        mcpServers: {
          hub: { type: "http", url: "https://hub.example.test/mcp" },
        },
        toolPolicy: {
          preapproved: [{ kind: "mcp", server: "hub", tool: "finish_execution" }],
        },
      },
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
      mcpAuthToken: "cap-token",
      preapprovedTools: ["list_profiles", "beads_status", "list_profiles"],
    });

    expect(result.toolPolicy?.preapproved).toEqual([
      { kind: "mcp", server: "hub", tool: "finish_execution" },
      { kind: "mcp", server: "paseo", tool: "list_profiles" },
      { kind: "mcp", server: "paseo", tool: "beads_status" },
    ]);
  });

  test("does not inject when no MCP base URL is configured", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: null,
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers).toBeUndefined();
  });

  test("rejects an untrusted collision with the reserved paseo server name", () => {
    expect(() =>
      withRuntimePaseoMcpServer({
        config: {
          ...BASE_CONFIG,
          mcpServers: {
            paseo: { type: "http", url: "https://other-host/mcp/agents" },
          },
        },
        agentId: "agent-1",
        mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
        mcpAuthToken: "cap-token",
      }),
    ).toThrow("MCP server name paseo is reserved for Paseo runtime");
  });
});
