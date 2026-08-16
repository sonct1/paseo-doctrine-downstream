import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import type { PaseoToolCatalog } from "../tools/types.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { AntigravityNativeAgentClient } from "./antigravity-native-agent.js";

function catalog(): PaseoToolCatalog {
  const executeTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
  const tool = {
    name: "beads_status",
    description: "Check Central",
    handler: executeTool,
  };
  const tools = new Map([[tool.name, tool]]);
  return { tools, getTool: (name) => tools.get(name), executeTool };
}

async function createFakeAgy(root: string): Promise<{ binary: string; argvLog: string }> {
  const binary = join(root, "agy");
  const argvLog = join(root, "argv.log");
  await writeFile(
    binary,
    `#!/bin/sh
set -eu
printf '%s\n' "$@" > "$PASEO_TEST_AGY_ARGV"
if [ "\${1-}" = models ]; then
  printf 'gemini-test\tGemini Test\n'
  exit 0
fi
conversation=test-conversation
for argument do
  if [ "$argument" = existing-conversation ]; then conversation=existing-conversation; fi
done
printf '{"event":"init","conversation_id":"%s","init":{"permission_mode":"always-proceed"}}\n' "$conversation"
printf '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"AGY_OK"}}\n'
printf '{"event":"result","result":{"conversation_id":"%s","status":"SUCCESS","response":"AGY_OK","usage":{"input_tokens":10,"output_tokens":2}}}\n' "$conversation"
`,
    { encoding: "utf8", mode: 0o700 },
  );
  return { binary, argvLog };
}

describe("native Antigravity provider", () => {
  test.skipIf(process.platform === "win32")(
    "creates a role-bound session, streams output and persists the conversation",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "agy-native-test-"));
      const profileRoot = join(root, "profiles");
      const { binary, argvLog } = await createFakeAgy(root);
      await mkdir(profileRoot, { recursive: true });
      const client = new AntigravityNativeAgentClient({
        logger: createTestLogger(),
        command: [binary],
        env: { PASEO_TEST_AGY_ARGV: argvLog },
        profileRoot,
        temporaryRoot: root,
        resolveExecutable: async () => binary,
      });
      const session = await client.createSession(
        {
          provider: "gemini-antigravity",
          cwd: root,
          model: "gemini-test",
          thinkingOptionId: "high",
          modeId: "full-access",
        },
        {
          agentId: "agent-native",
          roleBinding: { roleId: "peer", instructions: "Immutable Peer instructions" },
          paseoTools: catalog(),
        },
      );
      try {
        await expect(session.run("Return AGY_OK")).resolves.toMatchObject({
          sessionId: "test-conversation",
          finalText: "AGY_OK",
          usage: { inputTokens: 10, outputTokens: 2 },
        });
        expect(session.describePersistence()).toMatchObject({
          sessionId: "test-conversation",
          nativeHandle: "test-conversation",
        });
        const argv = await readFile(argvLog, "utf8");
        expect(argv).toContain("--dangerously-skip-permissions\n");
        expect(argv).toContain("--agent\npaseo-peer-");
        const profileNames = await import("node:fs/promises").then((fs) => fs.readdir(profileRoot));
        const profile = await readFile(join(profileRoot, profileNames[0], "agent.md"), "utf8");
        expect(profile).toContain("inheritMcp: false");
        expect(profile).toContain("tools:\n  - run_command");
        expect(profile).toContain("Immutable Peer instructions");
        expect(profile).toContain("paseo-agent-tool <tool_name>");
      } finally {
        await session.close();
      }
    },
  );

  test.skipIf(process.platform === "win32")(
    "resumes the exact native conversation and keeps the gateway projection",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "agy-native-resume-test-"));
      const { binary, argvLog } = await createFakeAgy(root);
      const client = new AntigravityNativeAgentClient({
        logger: createTestLogger(),
        command: [binary],
        env: { PASEO_TEST_AGY_ARGV: argvLog },
        profileRoot: join(root, "profiles"),
        temporaryRoot: root,
        resolveExecutable: async () => binary,
      });
      const session = await client.resumeSession(
        {
          provider: "gemini-antigravity",
          sessionId: "existing-conversation",
          metadata: { config: { provider: "gemini-antigravity", cwd: root } },
        },
        { modeId: "full-access" },
        {
          agentId: "agent-native",
          roleBinding: { roleId: "peer", instructions: "Immutable Peer instructions" },
          paseoTools: catalog(),
        },
      );
      try {
        await session.run("resume");
        expect(await readFile(argvLog, "utf8")).toContain(
          "--conversation\nexisting-conversation\n",
        );
      } finally {
        await session.close();
      }
    },
  );

  test("fails closed without an immutable role or caller-scoped tool catalog", async () => {
    const client = new AntigravityNativeAgentClient({
      logger: createTestLogger(),
      command: ["agy"],
      resolveExecutable: async () => "/opt/agy",
    });
    await expect(
      client.createSession({ provider: "gemini-antigravity", cwd: "/tmp" }, {}),
    ).rejects.toThrow("requires role binding and caller-scoped Paseo tools");
  });
});
