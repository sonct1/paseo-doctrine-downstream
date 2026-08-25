import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import type { AgentSessionConfig, McpServerConfig } from "./agent-sdk-types.js";
import { findExecutable } from "../../executable-resolution/executable-resolution.js";
import { execCommand } from "../../utils/spawn.js";

const PASEO_MCP_SERVER_NAME = "paseo";
const TRUSTED_SEMBLE_MCP_SERVER_NAME = "semble";
const TRUSTED_SEMBLE_TOOLS = ["search", "find_related"] as const;
const TRUSTED_SEMBLE_PACKAGE = "semble[mcp]==0.5.4";
const TRUSTED_SEMBLE_PREPARE_TIMEOUT_MS = 180_000;
const TRUSTED_SEMBLE_PREPARE_SCRIPT = [
  "import importlib.metadata as metadata",
  'assert metadata.version("semble") == "0.5.4"',
  "from semble.index.dense import load_model",
  "load_model()",
].join("\n");
const runtimePaseoMcpServers = new WeakSet<object>();
const runtimeTrustedSembleMcpServers = new WeakSet<object>();

export interface TrustedSembleRuntime {
  uvxPath: string;
  proxyPath: string;
  paseoHome: string;
}

export async function resolveTrustedSembleRuntime(input: {
  paseoHome: string;
  resolveExecutable?: (name: string) => Promise<string | null>;
  proxyPath?: string;
  prepareRuntime?: (runtime: TrustedSembleRuntime) => Promise<boolean>;
}): Promise<TrustedSembleRuntime | null> {
  const proxyPath =
    input.proxyPath ??
    fileURLToPath(new URL("../../../scripts/trusted-semble-proxy.mjs", import.meta.url));
  if (!existsSync(proxyPath)) return null;
  const uvxPath = await (input.resolveExecutable ?? findExecutable)("uvx");
  if (!uvxPath) return null;
  const runtime = {
    uvxPath: resolve(uvxPath),
    proxyPath: resolve(proxyPath),
    paseoHome: resolve(input.paseoHome),
  };
  const prepared = await (input.prepareRuntime ?? prepareTrustedSembleRuntime)(runtime);
  return prepared ? runtime : null;
}

function trustedSembleSharedEnvironment(
  runtime: TrustedSembleRuntime,
  offline: boolean,
): Record<string, string> {
  const toolRoot = join(runtime.paseoHome, "tool-cache", "semble");
  const temporaryRoot = join(toolRoot, "bootstrap", "tmp");
  const env: Record<string, string> = {
    SEMBLE_CACHE_LOCATION: join(toolRoot, "bootstrap", "indexes"),
    HF_HOME: join(toolRoot, "model-cache"),
    UV_CACHE_DIR: join(toolRoot, "uv-cache"),
    UV_PYTHON_INSTALL_DIR: join(toolRoot, "python"),
    XDG_CACHE_HOME: join(toolRoot, "xdg-cache"),
    HOME: join(toolRoot, "home"),
    TMPDIR: temporaryRoot,
    TMP: temporaryRoot,
    TEMP: temporaryRoot,
    UV_NO_CONFIG: "1",
    UV_MANAGED_PYTHON: "1",
    UV_NO_PROGRESS: "1",
    HF_HUB_DISABLE_PROGRESS_BARS: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
    TOKENIZERS_PARALLELISM: "false",
    NO_COLOR: "1",
    DO_NOT_TRACK: "1",
  };
  for (const key of [
    "PATH",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
  ]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  if (offline) {
    env.UV_OFFLINE = "1";
    env.HF_HUB_OFFLINE = "1";
  }
  return env;
}

async function runTrustedSemblePreparation(
  runtime: TrustedSembleRuntime,
  offline: boolean,
): Promise<void> {
  const env = trustedSembleSharedEnvironment(runtime, offline);
  await Promise.all(
    [
      "SEMBLE_CACHE_LOCATION",
      "HF_HOME",
      "UV_CACHE_DIR",
      "UV_PYTHON_INSTALL_DIR",
      "XDG_CACHE_HOME",
      "HOME",
      "TMPDIR",
    ].map((key) => mkdir(env[key], { recursive: true })),
  );
  await execCommand(
    runtime.uvxPath,
    [
      ...(offline ? ["--offline"] : []),
      "--python",
      "3.12",
      "--managed-python",
      "--no-progress",
      "--no-config",
      "--from",
      TRUSTED_SEMBLE_PACKAGE,
      "python",
      "-c",
      TRUSTED_SEMBLE_PREPARE_SCRIPT,
    ],
    {
      env,
      envMode: "internal",
      timeout: TRUSTED_SEMBLE_PREPARE_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 256 * 1024,
    },
  );
}

async function prepareTrustedSembleRuntime(runtime: TrustedSembleRuntime): Promise<boolean> {
  try {
    await runTrustedSemblePreparation(runtime, true);
    return true;
  } catch {
    try {
      await runTrustedSemblePreparation(runtime, false);
      return true;
    } catch {
      return false;
    }
  }
}

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

export function stripInternalTrustedSembleMcpServer(
  config: AgentSessionConfig,
): AgentSessionConfig {
  const mcpServers = config.mcpServers;
  if (!mcpServers) return config;
  const sembleServer = mcpServers[TRUSTED_SEMBLE_MCP_SERVER_NAME];
  if (!sembleServer || !runtimeTrustedSembleMcpServers.has(sembleServer)) return config;

  const nextMcpServers = { ...mcpServers };
  delete nextMcpServers[TRUSTED_SEMBLE_MCP_SERVER_NAME];
  const next = { ...config };
  if (Object.keys(nextMcpServers).length > 0) {
    next.mcpServers = nextMcpServers;
  } else {
    delete next.mcpServers;
  }
  const remainingPreapprovals = (next.toolPolicy?.preapproved ?? []).filter(
    (grant) => grant.kind !== "mcp" || grant.server !== TRUSTED_SEMBLE_MCP_SERVER_NAME,
  );
  if (remainingPreapprovals.length > 0) {
    next.toolPolicy = { preapproved: remainingPreapprovals };
  } else {
    delete next.toolPolicy;
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

export function withRuntimeTrustedSembleMcpServer(params: {
  config: AgentSessionConfig;
  agentId: string;
  runtime: TrustedSembleRuntime | null;
  roleBound: boolean;
  supportsMcpServers: boolean;
  supportsExactMcpPreapproval: boolean;
}): AgentSessionConfig {
  const storedConfig = stripInternalTrustedSembleMcpServer(params.config);
  if (
    !params.runtime ||
    !params.roleBound ||
    !params.supportsMcpServers ||
    !params.supportsExactMcpPreapproval
  ) {
    return storedConfig;
  }
  if (storedConfig.mcpServers?.[TRUSTED_SEMBLE_MCP_SERVER_NAME]) {
    throw new Error(
      `MCP server name ${TRUSTED_SEMBLE_MCP_SERVER_NAME} is reserved for Paseo trusted tools`,
    );
  }

  const agentCacheKey = createHash("sha256").update(params.agentId).digest("hex").slice(0, 24);
  const toolRoot = join(params.runtime.paseoHome, "tool-cache", "semble");
  const agentRoot = join(toolRoot, "agents", agentCacheKey);
  const runtimeServer: McpServerConfig = {
    type: "stdio",
    command: process.execPath,
    args: [params.runtime.proxyPath],
    env: {
      PASEO_TRUSTED_SEMBLE_REPO_ROOT: storedConfig.cwd,
      PASEO_TRUSTED_SEMBLE_UVX_PATH: params.runtime.uvxPath,
      SEMBLE_CACHE_LOCATION: join(agentRoot, "indexes"),
      HF_HOME: join(toolRoot, "model-cache"),
      UV_CACHE_DIR: join(toolRoot, "uv-cache"),
      UV_PYTHON_INSTALL_DIR: join(toolRoot, "python"),
      XDG_CACHE_HOME: join(toolRoot, "xdg-cache"),
      HOME: join(toolRoot, "home"),
      TMPDIR: join(agentRoot, "tmp"),
      TMP: join(agentRoot, "tmp"),
      TEMP: join(agentRoot, "tmp"),
      UV_NO_CONFIG: "1",
      UV_MANAGED_PYTHON: "1",
      UV_NO_PROGRESS: "1",
      UV_OFFLINE: "1",
      HF_HUB_OFFLINE: "1",
      HF_HUB_DISABLE_PROGRESS_BARS: "1",
      TOKENIZERS_PARALLELISM: "false",
      NO_COLOR: "1",
    },
    alwaysLoad: true,
  };
  runtimeTrustedSembleMcpServers.add(runtimeServer);

  const existingPreapprovals = storedConfig.toolPolicy?.preapproved ?? [];
  const semblePreapprovals = TRUSTED_SEMBLE_TOOLS.filter(
    (tool) =>
      !existingPreapprovals.some(
        (grant) =>
          grant.kind === "mcp" &&
          grant.server === TRUSTED_SEMBLE_MCP_SERVER_NAME &&
          grant.tool === tool,
      ),
  ).map((tool) => ({
    kind: "mcp" as const,
    server: TRUSTED_SEMBLE_MCP_SERVER_NAME,
    tool,
  }));

  return {
    ...storedConfig,
    toolPolicy: { preapproved: [...existingPreapprovals, ...semblePreapprovals] },
    mcpServers: {
      [TRUSTED_SEMBLE_MCP_SERVER_NAME]: runtimeServer,
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
