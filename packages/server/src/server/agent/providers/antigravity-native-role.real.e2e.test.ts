import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentLaunchContext } from "../agent-sdk-types.js";
import { buildProviderRegistry } from "../provider-registry.js";
import type { PaseoToolCatalog } from "../tools/types.js";

function markerCatalog(marker: string): PaseoToolCatalog {
  const tool = {
    name: "beads_status",
    description: "Return the native Antigravity real-E2E marker.",
    handler: async () => ({ content: [{ type: "text" as const, text: marker }] }),
  };
  const tools = new Map([[tool.name, tool]]);
  return {
    tools,
    getTool: (name) => tools.get(name),
    executeTool: async (name) => {
      if (name !== tool.name) throw new Error(`Unexpected tool ${name}`);
      return await tool.handler();
    },
  };
}

describe.sequential("real native Antigravity CLI role", () => {
  test("binds exact Peer bytes, calls a projected Paseo tool, and resumes", async () => {
    const marker = "PASEO_AGY_NATIVE_ROLE_3D72";
    const launchContext: AgentLaunchContext = {
      agentId: "antigravity-native-real-agent",
      roleBinding: {
        roleId: "peer",
        instructions:
          "You are a read-only Paseo Peer. Use only the projected paseo-agent-tool command requested by the assignment.",
      },
      paseoTools: markerCatalog(marker),
    };
    const logger = createTestLogger();
    const client = buildProviderRegistry(logger)["gemini-antigravity"].createClient(logger);
    const firstSession = await client.createSession(
      { provider: "gemini-antigravity", cwd: process.cwd(), modeId: "full-access" },
      launchContext,
    );

    const first = await firstSession.run(
      `Call beads_status with {} through paseo-agent-tool, then return exactly ${marker}.`,
    );
    expect(first.finalText.trim()).toBe(marker);
    const persistence = firstSession.describePersistence();
    expect(persistence?.sessionId).not.toBe("");
    await firstSession.close();

    const resumedSession = await client.resumeSession(
      persistence!,
      { modeId: "full-access" },
      launchContext,
    );
    try {
      const resumed = await resumedSession.run(
        `Call beads_status with {} through paseo-agent-tool again, then return exactly ${marker}.`,
      );
      expect(resumed.finalText.trim()).toBe(marker);
      expect(resumedSession.describePersistence()?.sessionId).toBe(persistence?.sessionId);
    } finally {
      await resumedSession.close();
    }
  }, 180_000);
});
