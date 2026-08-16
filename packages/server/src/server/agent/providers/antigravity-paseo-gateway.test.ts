import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";

import type { PaseoToolCatalog, PaseoToolDefinition } from "../tools/types.js";
import { startAntigravityPaseoGateway } from "./antigravity-paseo-gateway.js";

const execFile = promisify(execFileCallback);

function createCatalog(): PaseoToolCatalog {
  const executeTool = vi.fn(async (name: string, input: unknown) => ({
    content: [{ type: "text", text: `${name}:${JSON.stringify(input)}` }],
    structuredContent: { name, input },
  }));
  const tool: PaseoToolDefinition = {
    name: "beads_get",
    description: "Read one granted issue",
    inputSchema: z.object({ issueId: z.string(), view: z.literal("checkpoint") }),
    handler: async (input) => await executeTool("beads_get", input),
  };
  const tools = new Map([[tool.name, tool]]);
  return {
    tools,
    getTool: (name) => tools.get(name),
    executeTool,
  };
}

describe("Antigravity Paseo command gateway", () => {
  test.skipIf(process.platform === "win32")(
    "executes only the caller-scoped catalog through the generated CLI",
    async () => {
      const catalog = createCatalog();
      const gateway = await startAntigravityPaseoGateway({ catalog });
      try {
        const executable = gateway.env.PATH?.split(":")[0];
        const result = await execFile(
          `${executable}/paseo-agent-tool`,
          ["beads_get", JSON.stringify({ issueId: "ps-test", view: "checkpoint" })],
          {
            env: { ...process.env, ...gateway.env },
          },
        );
        expect(JSON.parse(result.stdout)).toMatchObject({
          ok: true,
          result: { structuredContent: { name: "beads_get", input: { issueId: "ps-test" } } },
        });
        expect(catalog.executeTool).toHaveBeenCalledWith("beads_get", {
          issueId: "ps-test",
          view: "checkpoint",
        });
      } finally {
        await gateway.close();
      }
    },
  );

  test("rejects ungranted tools and invalid bearer credentials", async () => {
    const gateway = await startAntigravityPaseoGateway({ catalog: createCatalog() });
    try {
      const denied = await fetch(gateway.env.PASEO_AGENT_TOOL_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${gateway.env.PASEO_AGENT_TOOL_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "call", tool: "beads_create", input: {} }),
      });
      await expect(denied.json()).resolves.toMatchObject({
        ok: false,
        error: "Paseo tool is not granted: beads_create",
      });

      const unauthorized = await fetch(gateway.env.PASEO_AGENT_TOOL_URL, {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
      });
      expect(unauthorized.status).toBe(401);
    } finally {
      await gateway.close();
    }
  });
});
