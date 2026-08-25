import { describe, expect, test, vi } from "vitest";

import type { AgentSessionConfig } from "./agent-sdk-types.js";
import {
  resolveTrustedSembleRuntime,
  stripInternalTrustedSembleMcpServer,
  withRuntimePaseoMcpServer,
  withRuntimeTrustedSembleMcpServer,
} from "./runtime-mcp-config.js";

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

describe("withRuntimeTrustedSembleMcpServer", () => {
  const runtime = {
    uvxPath: "/opt/homebrew/bin/uvx",
    proxyPath: "/opt/paseo/trusted-semble-proxy.mjs",
    paseoHome: "/var/lib/paseo",
  };

  test("injects only the confined proxy and exact trusted-tool preapprovals", () => {
    const result = withRuntimeTrustedSembleMcpServer({
      config: {
        ...BASE_CONFIG,
        toolPolicy: {
          preapproved: [{ kind: "mcp", server: "paseo", tool: "beads_status" }],
        },
      },
      agentId: "agent-1",
      runtime,
      roleBound: true,
      supportsMcpServers: true,
      supportsExactMcpPreapproval: true,
    });

    expect(result.mcpServers?.semble).toMatchObject({
      type: "stdio",
      command: process.execPath,
      args: [runtime.proxyPath],
      alwaysLoad: true,
      env: {
        PASEO_TRUSTED_SEMBLE_REPO_ROOT: "/tmp/agent",
        PASEO_TRUSTED_SEMBLE_UVX_PATH: runtime.uvxPath,
        SEMBLE_CACHE_LOCATION: expect.stringContaining("/tool-cache/semble/agents/"),
        HF_HOME: "/var/lib/paseo/tool-cache/semble/model-cache",
        UV_CACHE_DIR: "/var/lib/paseo/tool-cache/semble/uv-cache",
        UV_PYTHON_INSTALL_DIR: "/var/lib/paseo/tool-cache/semble/python",
        UV_OFFLINE: "1",
        HF_HUB_OFFLINE: "1",
      },
    });
    expect(result.toolPolicy?.preapproved).toEqual([
      { kind: "mcp", server: "paseo", tool: "beads_status" },
      { kind: "mcp", server: "semble", tool: "search" },
      { kind: "mcp", server: "semble", tool: "find_related" },
    ]);
    const stripped = stripInternalTrustedSembleMcpServer(result);
    expect(stripped.mcpServers).toBeUndefined();
    expect(stripped.toolPolicy?.preapproved).toEqual([
      { kind: "mcp", server: "paseo", tool: "beads_status" },
    ]);
  });

  test("does not inject without a role binding and rejects reserved-name collisions", () => {
    expect(
      withRuntimeTrustedSembleMcpServer({
        config: BASE_CONFIG,
        agentId: "agent-1",
        runtime,
        roleBound: false,
        supportsMcpServers: true,
        supportsExactMcpPreapproval: true,
      }),
    ).toEqual(BASE_CONFIG);

    expect(() =>
      withRuntimeTrustedSembleMcpServer({
        config: {
          ...BASE_CONFIG,
          mcpServers: {
            semble: { type: "stdio", command: "untrusted-semble" },
          },
        },
        agentId: "agent-1",
        runtime,
        roleBound: true,
        supportsMcpServers: true,
        supportsExactMcpPreapproval: true,
      }),
    ).toThrow("MCP server name semble is reserved for Paseo trusted tools");
  });
});

describe("resolveTrustedSembleRuntime", () => {
  test("returns a runtime only after pinned preparation succeeds", async () => {
    const prepareRuntime = vi.fn(async () => true);
    const runtime = await resolveTrustedSembleRuntime({
      paseoHome: "/var/lib/paseo",
      proxyPath: process.execPath,
      resolveExecutable: async () => "/opt/homebrew/bin/uvx",
      prepareRuntime,
    });

    expect(runtime).toEqual({
      paseoHome: "/var/lib/paseo",
      proxyPath: process.execPath,
      uvxPath: "/opt/homebrew/bin/uvx",
    });
    expect(prepareRuntime).toHaveBeenCalledWith(runtime);
  });

  test("keeps trusted Semble unavailable when preparation fails", async () => {
    await expect(
      resolveTrustedSembleRuntime({
        paseoHome: "/var/lib/paseo",
        proxyPath: process.execPath,
        resolveExecutable: async () => "/opt/homebrew/bin/uvx",
        prepareRuntime: async () => false,
      }),
    ).resolves.toBeNull();
  });
});
