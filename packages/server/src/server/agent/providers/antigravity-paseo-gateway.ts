import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { serializePaseoToolInputParameters } from "../tools/paseo-tool-serialization.js";
import type { PaseoToolCatalog } from "../tools/types.js";

const MAX_REQUEST_BYTES = 1_000_000;

interface GatewayRequest {
  action: "list" | "describe" | "call";
  tool?: string;
  input?: unknown;
}

export interface AntigravityPaseoGateway {
  env: Record<string, string>;
  instructions: string;
  close(): Promise<void>;
}

export interface StartAntigravityPaseoGatewayOptions {
  catalog: PaseoToolCatalog;
  temporaryRoot?: string;
  nodeExecutable?: string;
  inheritedPath?: string;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new Error("request body exceeds 1000000 bytes");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isGatewayRequest(value: unknown): value is GatewayRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return request.action === "list" || request.action === "describe" || request.action === "call";
}

function toolDefinitions(catalog: PaseoToolCatalog): unknown[] {
  return [...catalog.tools.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: serializePaseoToolInputParameters(tool),
  }));
}

async function executeGatewayRequest(
  request: GatewayRequest,
  catalog: PaseoToolCatalog,
): Promise<unknown> {
  if (request.action === "list") {
    return { tools: toolDefinitions(catalog) };
  }
  if (!request.tool) {
    throw new Error("tool is required");
  }
  const tool = catalog.getTool(request.tool);
  if (!tool) {
    throw new Error(`Paseo tool is not granted: ${request.tool}`);
  }
  if (request.action === "describe") {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: serializePaseoToolInputParameters(tool),
    };
  }
  return await catalog.executeTool(request.tool, request.input ?? {});
}

function gatewayCliSource(): string {
  return `#!/usr/bin/env node
const [actionOrTool, toolOrInput, maybeInput] = process.argv.slice(2);
if (!actionOrTool) {
  process.stderr.write("usage: paseo-agent-tool list | describe <tool> | call <tool> '<json>' | <tool> '<json>'\\n");
  process.exit(64);
}
let action = actionOrTool;
let tool = toolOrInput;
let rawInput = maybeInput;
if (action !== "list" && action !== "describe" && action !== "call") {
  tool = action;
  action = "call";
  rawInput = toolOrInput;
}
let input = {};
if (rawInput) {
  try { input = JSON.parse(rawInput); }
  catch (error) {
    process.stderr.write("paseo-agent-tool: input must be one JSON value\\n");
    process.exit(64);
  }
}
const response = await fetch(process.env.PASEO_AGENT_TOOL_URL, {
  method: "POST",
  headers: {
    authorization: "Bearer " + process.env.PASEO_AGENT_TOOL_TOKEN,
    "content-type": "application/json",
  },
  body: JSON.stringify({ action, ...(tool ? { tool } : {}), input }),
});
const text = await response.text();
process.stdout.write(text + (text.endsWith("\\n") ? "" : "\\n"));
if (!response.ok) process.exit(1);
`;
}

export async function startAntigravityPaseoGateway(
  options: StartAntigravityPaseoGatewayOptions,
): Promise<AntigravityPaseoGateway> {
  const token = randomBytes(32).toString("base64url");
  const root = options.temporaryRoot ?? tmpdir();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const gatewayDirectory = await mkdtemp(join(root, "paseo-antigravity-tools-"));
  const cliPath = join(gatewayDirectory, "paseo-agent-tool");
  await writeFile(cliPath, gatewayCliSource(), { encoding: "utf8", mode: 0o700 });

  const server = createServer(async (request, response) => {
    if (
      request.method !== "POST" ||
      request.url !== "/call" ||
      request.headers.authorization !== `Bearer ${token}`
    ) {
      writeJson(response, 401, { ok: false, error: "unauthorized" });
      return;
    }
    try {
      const body = await readJson(request);
      if (!isGatewayRequest(body)) {
        throw new Error("invalid gateway request");
      }
      writeJson(response, 200, {
        ok: true,
        result: await executeGatewayRequest(body, options.catalog),
      });
    } catch (error) {
      writeJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    await rm(gatewayDirectory, { recursive: true, force: true });
    throw new Error("Antigravity Paseo gateway did not bind a TCP port");
  }

  let closed = false;
  return {
    env: {
      PASEO_AGENT_TOOL_URL: `http://127.0.0.1:${address.port}/call`,
      PASEO_AGENT_TOOL_TOKEN: token,
      PATH: `${gatewayDirectory}${delimiter}${options.inheritedPath ?? process.env.PATH ?? ""}`,
      ...(options.nodeExecutable ? { PASEO_AGENT_TOOL_NODE: options.nodeExecutable } : {}),
    },
    instructions:
      "Paseo tools are available only through the exact `paseo-agent-tool` command. " +
      "Call a tool with `paseo-agent-tool <tool_name> '<json_input>'`; use " +
      "`paseo-agent-tool describe <tool_name>` when its input is unknown. " +
      "Treat a non-zero exit or `{ok:false}` as a failed tool call. Do not use `call_mcp_tool` for Paseo tools.",
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(gatewayDirectory, { recursive: true, force: true });
    },
  };
}
