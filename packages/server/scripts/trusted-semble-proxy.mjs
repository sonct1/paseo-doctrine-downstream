import { mkdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const SEMBLE_PACKAGE = "semble[mcp]==0.5.4";
const TRUSTED_TOOL_NAMES = ["search", "find_related"];
const TOOL_CALL_TIMEOUT_MS = 5 * 60 * 1000;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function rejectsRemoteLocation(value) {
  return /^[a-z][a-z\d+.-]*:\/\//iu.test(value) || /^git@/iu.test(value);
}

async function canonicalDirectory(path) {
  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new Error(`Trusted Semble root is not a directory: ${path}`);
  return canonical;
}

async function canonicalRequestedRepo(requestedRepo, allowedRoot) {
  if (typeof requestedRepo !== "string" || !requestedRepo.trim()) {
    throw new Error("Trusted Semble calls require a non-empty repo path");
  }
  if (rejectsRemoteLocation(requestedRepo)) {
    throw new Error("Trusted Semble rejects remote repository URLs");
  }
  const candidate = isAbsolute(requestedRepo) ? requestedRepo : resolve(allowedRoot, requestedRepo);
  const canonical = await realpath(candidate);
  if (canonical !== allowedRoot) {
    throw new Error("Trusted Semble repo must equal the assignment workspace root");
  }
  return allowedRoot;
}

async function trustedRelativeFile(requestedFile, allowedRoot) {
  if (typeof requestedFile !== "string" || !requestedFile.trim()) {
    throw new Error("Trusted Semble find_related requires a non-empty file_path");
  }
  if (rejectsRemoteLocation(requestedFile)) {
    throw new Error("Trusted Semble rejects remote file locations");
  }
  const candidate = isAbsolute(requestedFile) ? requestedFile : resolve(allowedRoot, requestedFile);
  const canonical = await realpath(candidate);
  const relativePath = relative(allowedRoot, canonical);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Trusted Semble file_path must stay inside the assignment workspace root");
  }
  return relativePath;
}

export async function resolveTrustedSembleCallArguments(toolName, input, configuredRoot) {
  if (!TRUSTED_TOOL_NAMES.includes(toolName)) {
    throw new Error(`Trusted Semble tool is not allowed: ${toolName}`);
  }
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Trusted Semble tool arguments must be an object");
  }
  const allowedRoot = await canonicalDirectory(configuredRoot);
  const args = { ...input };
  args.repo = await canonicalRequestedRepo(args.repo, allowedRoot);
  if (toolName === "find_related") {
    args.file_path = await trustedRelativeFile(args.file_path, allowedRoot);
  }
  return args;
}

function controlledBackendEnvironment() {
  const inheritedKeys = [
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
  ];
  const controlledKeys = [
    "SEMBLE_CACHE_LOCATION",
    "HF_HOME",
    "UV_CACHE_DIR",
    "UV_PYTHON_INSTALL_DIR",
    "XDG_CACHE_HOME",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "UV_NO_CONFIG",
    "UV_MANAGED_PYTHON",
    "UV_NO_PROGRESS",
    "UV_OFFLINE",
    "HF_HUB_OFFLINE",
    "HF_HUB_DISABLE_PROGRESS_BARS",
    "TOKENIZERS_PARALLELISM",
    "NO_COLOR",
  ];
  const env = {};
  for (const key of inheritedKeys) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const key of controlledKeys) {
    env[key] = requiredEnvironment(key);
  }
  env.HF_HUB_DISABLE_TELEMETRY = "1";
  env.DO_NOT_TRACK = "1";
  return env;
}

async function createBackendClient(uvxPath) {
  const backendTransport = new StdioClientTransport({
    command: uvxPath,
    args: [
      "--offline",
      "--python",
      "3.12",
      "--managed-python",
      "--no-progress",
      "--no-config",
      "--from",
      SEMBLE_PACKAGE,
      "semble",
    ],
    env: controlledBackendEnvironment(),
    stderr: "pipe",
  });
  backendTransport.stderr?.pipe(process.stderr);
  const backend = new Client(
    { name: "paseo-trusted-semble-proxy", version: "1.0.0" },
    { capabilities: {} },
  );
  await backend.connect(backendTransport);
  return backend;
}

async function trustedBackendTools(backend) {
  const tools = [];
  let cursor;
  do {
    const page = await backend.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);

  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const missing = TRUSTED_TOOL_NAMES.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(`Pinned Semble runtime is missing trusted tool(s): ${missing.join(", ")}`);
  }
  const trustedTools = [];
  for (const name of TRUSTED_TOOL_NAMES) {
    const tool = byName.get(name);
    trustedTools.push({
      ...tool,
      annotations: {
        ...tool.annotations,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
  }
  return trustedTools;
}

function toolError(error) {
  return {
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

async function main() {
  const configuredRoot = requiredEnvironment("PASEO_TRUSTED_SEMBLE_REPO_ROOT");
  const uvxPath = requiredEnvironment("PASEO_TRUSTED_SEMBLE_UVX_PATH");
  await Promise.all(
    [
      "SEMBLE_CACHE_LOCATION",
      "HF_HOME",
      "UV_CACHE_DIR",
      "UV_PYTHON_INSTALL_DIR",
      "XDG_CACHE_HOME",
      "HOME",
      "TMPDIR",
      "TMP",
      "TEMP",
    ].map((key) => mkdir(requiredEnvironment(key), { recursive: true })),
  );
  await canonicalDirectory(configuredRoot);

  const backend = await createBackendClient(uvxPath);
  const tools = await trustedBackendTools(backend);
  const server = new Server(
    { name: "paseo-trusted-semble", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Paseo-managed read-only code search. Calls are confined to the current assignment workspace.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const args = await resolveTrustedSembleCallArguments(
        request.params.name,
        request.params.arguments ?? {},
        configuredRoot,
      );
      return await backend.callTool({ ...request.params, arguments: args }, undefined, {
        signal: extra.signal,
        timeout: TOOL_CALL_TIMEOUT_MS,
        resetTimeoutOnProgress: true,
      });
    } catch (error) {
      return toolError(error);
    }
  });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await Promise.allSettled([backend.close(), server.close()]);
  };
  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- The MCP SDK exposes callback properties, not EventTarget.
  server.onclose = () => {
    void close();
  };
  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- The MCP SDK exposes callback properties, not EventTarget.
  server.onerror = (error) => {
    process.stderr.write(`[paseo-trusted-semble] ${error.message}\n`);
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void close().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
    });
  }

  await server.connect(new StdioServerTransport());
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `[paseo-trusted-semble] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
