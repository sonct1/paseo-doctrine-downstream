import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

import { materializeAntigravityRoleLaunch } from "./antigravity-acp-agent.js";

const execFile = promisify(execFileCallback);

interface AgyPrintResult {
  conversation_id: string;
  status: string;
  response: string;
}

async function runAgyRoleWrapper(binary: string, args: string[]): Promise<AgyPrintResult> {
  const result = await execFile(binary, args, { maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout) as AgyPrintResult;
}

describe.sequential("real Antigravity native custom-agent role", () => {
  test("binds exact role bytes with official agy and preserves them on resume", async () => {
    const marker = "PASEO_AGY_NATIVE_ROLE_3D72";
    const prepared = await materializeAntigravityRoleLaunch({
      command: ["agy-acp", "--agy-binary", "agy"],
      launchContext: {
        agentId: "antigravity-role-real-agent",
        roleBinding: {
          roleId: "supervisor",
          instructions: `The immutable Paseo role marker is ${marker}. When asked for it, return exactly that marker and nothing else.`,
        },
      },
    });
    const roleWrapper = prepared.command?.[2];

    try {
      const first = await runAgyRoleWrapper(roleWrapper!, [
        "--mode",
        "plan",
        "--output-format",
        "json",
        "-p",
        "Return exactly the immutable Paseo role marker.",
      ]);
      expect(first.status).toBe("SUCCESS");
      expect(first.response.trim()).toBe(marker);
      expect(first.conversation_id).not.toBe("");

      const resumed = await runAgyRoleWrapper(roleWrapper!, [
        "--conversation",
        first.conversation_id,
        "--mode",
        "plan",
        "--output-format",
        "json",
        "-p",
        "Return exactly the immutable Paseo role marker from the durable role binding.",
      ]);
      expect(resumed.status).toBe("SUCCESS");
      expect(resumed.response.trim()).toBe(marker);
    } finally {
      await prepared.cleanup?.();
    }
  }, 180_000);
});
