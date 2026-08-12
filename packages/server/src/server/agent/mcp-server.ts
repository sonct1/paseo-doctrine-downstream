import { randomUUID } from "node:crypto";
import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { addModelVisibleStructuredContent } from "./tools/paseo-tool-serialization.js";
import { createPaseoToolCatalog, type PaseoToolHostDependencies } from "./tools/paseo-tools.js";
import type { PaseoToolResult } from "./tools/types.js";

export type AgentMcpServerOptions = PaseoToolHostDependencies;

type McpToolContext = ServerContext;

const CURSOR_PROVIDER_ID = "cursor";

function normalizeMcpInputSchema(inputSchema: z.ZodRawShape | z.ZodType | undefined): z.ZodType {
  if (!inputSchema) return z.object({});
  if (typeof (inputSchema as { safeParseAsync?: unknown }).safeParseAsync === "function") {
    return inputSchema as z.ZodType;
  }
  return z.object(inputSchema as z.ZodRawShape);
}

function shouldRecordAuthoritativeToolReceipt(options: AgentMcpServerOptions): boolean {
  if (!options.callerAgentId) return false;
  return options.agentManager.getAgent(options.callerAgentId)?.provider === CURSOR_PROVIDER_ID;
}

function paseoMcpTimelineName(toolName: string): string {
  return `mcp__paseo__${toolName}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function executeWithAuthoritativeToolReceipt(input: {
  options: AgentMcpServerOptions;
  toolName: string;
  toolTitle?: string;
  args: unknown;
  execute: () => Promise<PaseoToolResult>;
}): Promise<PaseoToolResult> {
  const callerAgentId = input.options.callerAgentId;
  if (!callerAgentId || !shouldRecordAuthoritativeToolReceipt(input.options)) {
    return input.execute();
  }

  const callId = `paseo-mcp-${randomUUID()}`;
  const base = {
    type: "tool_call" as const,
    callId,
    name: paseoMcpTimelineName(input.toolName),
    detail: { type: "unknown" as const, input: input.args, output: null },
    metadata: {
      kind: "mcp",
      title: input.toolTitle ?? input.toolName,
      source: "paseo-mcp-server",
      authoritativeToolName: input.toolName,
    },
  };
  await input.options.agentManager.appendTimelineItem(callerAgentId, {
    ...base,
    status: "running",
    error: null,
  });

  let result: PaseoToolResult;
  try {
    result = await input.execute();
  } catch (error) {
    await input.options.agentManager.appendTimelineItem(callerAgentId, {
      ...base,
      status: "failed",
      error: { message: errorMessage(error) },
    });
    throw error;
  }

  const output = result.structuredContent ?? result.content;
  if (result.isError) {
    await input.options.agentManager.appendTimelineItem(callerAgentId, {
      ...base,
      detail: { type: "unknown", input: input.args, output },
      status: "failed",
      error: { message: "Paseo MCP tool returned an error result" },
    });
  } else {
    await input.options.agentManager.appendTimelineItem(callerAgentId, {
      ...base,
      detail: { type: "unknown", input: input.args, output },
      status: "completed",
      error: null,
    });
  }
  return result;
}

function toMcpToolResult(result: PaseoToolResult): CallToolResult {
  const modelVisibleResult = addModelVisibleStructuredContent(result);
  return {
    content: modelVisibleResult.content as CallToolResult["content"],
    ...(modelVisibleResult.structuredContent !== undefined
      ? {
          structuredContent:
            modelVisibleResult.structuredContent as CallToolResult["structuredContent"],
        }
      : {}),
    ...(modelVisibleResult.isError !== undefined ? { isError: modelVisibleResult.isError } : {}),
  };
}

export async function createAgentMcpServer(options: AgentMcpServerOptions): Promise<McpServer> {
  const catalog = await createPaseoToolCatalog(options);
  const server = new McpServer({
    name: "agent-mcp",
    version: "2.0.0",
  });

  for (const tool of catalog.tools.values()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: normalizeMcpInputSchema(tool.inputSchema),
      },
      async (args: unknown, context?: McpToolContext) =>
        toMcpToolResult(
          await executeWithAuthoritativeToolReceipt({
            options,
            toolName: tool.name,
            toolTitle: tool.title,
            args,
            execute: () => catalog.executeTool(tool.name, args, { signal: context?.mcpReq.signal }),
          }),
        ),
    );
  }

  return server;
}
