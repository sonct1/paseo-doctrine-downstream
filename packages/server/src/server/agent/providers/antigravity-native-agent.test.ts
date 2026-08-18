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

function findTurnFailure(events: Array<{ type: string; diagnostic?: string }>) {
  for (const event of events) {
    if (event.type === "turn_failed") return event;
  }
  return undefined;
}

async function createFakeAgy(
  root: string,
  options: { includeStepUpdate?: boolean } = {},
): Promise<{ binary: string; argvLog: string }> {
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
${options.includeStepUpdate === false ? "" : `printf '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"AGY_OK"}}\\n'`}
printf '{"event":"result","result":{"conversation_id":"%s","status":"SUCCESS","response":"AGY_OK","usage":{"input_tokens":10,"output_tokens":2}}}\n' "$conversation"
`,
    { encoding: "utf8", mode: 0o700 },
  );
  return { binary, argvLog };
}

async function createFailingAgy(root: string): Promise<string> {
  const binary = join(root, "agy-failing");
  await writeFile(binary, "#!/bin/sh\nexit 1\n", { encoding: "utf8", mode: 0o700 });
  return binary;
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
        expect(argv).not.toContain("--effort\n");
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

  test("lists static draft features without opening a role-bound scratch session", async () => {
    const client = new AntigravityNativeAgentClient({
      logger: createTestLogger(),
      command: ["agy"],
      resolveExecutable: async () => "/opt/agy",
    });

    await expect(
      client.listFeatures?.({ provider: "gemini-antigravity", cwd: "/tmp" }),
    ).resolves.toEqual([]);
  });

  test.skipIf(process.platform === "win32")(
    "surfaces actionable diagnostics when AGY exits without stderr",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "agy-native-empty-stderr-test-"));
      const binary = await createFailingAgy(root);
      const client = new AntigravityNativeAgentClient({
        logger: createTestLogger(),
        command: ["agy"],
        profileRoot: join(root, "profiles"),
        temporaryRoot: root,
        resolveExecutable: async () => binary,
      });
      const session = await client.createSession(
        {
          provider: "gemini-antigravity",
          cwd: root,
          model: "gemini-test",
          modeId: "full-access",
        },
        {
          agentId: "agent-native-failing",
          roleBinding: { roleId: "peer", instructions: "Immutable Peer instructions" },
          paseoTools: catalog(),
        },
      );
      const events: Array<{ type: string; diagnostic?: string }> = [];
      const unsubscribe = session.subscribe((event) => events.push(event));
      try {
        await session.startTurn("fail without stderr");
        await vi.waitFor(() => {
          expect(findTurnFailure(events)).toBeDefined();
        });
        const failure = findTurnFailure(events);
        expect(failure?.diagnostic).toContain("Native AGY exited without writing stderr");
        expect(failure?.diagnostic).toContain(`Executable: ${binary}`);
        expect(failure?.diagnostic).toContain("Exit: code 1");
        expect(failure?.diagnostic).toContain("Model: gemini-test");
        expect(failure?.diagnostic).toContain("Mode: full-access");
      } finally {
        unsubscribe();
        await session.close();
      }
    },
  );

  test.skipIf(process.platform === "win32")(
    "uses AGY model routes without inventing a conflicting thinking selector",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "agy-native-models-test-"));
      const { binary, argvLog } = await createFakeAgy(root);
      const client = new AntigravityNativeAgentClient({
        logger: createTestLogger(),
        command: [binary],
        env: { PASEO_TEST_AGY_ARGV: argvLog },
        resolveExecutable: async () => binary,
      });

      const providerCatalog = await client.fetchCatalog({ cwd: root });
      expect(providerCatalog.models).toMatchObject([{ id: "gemini-test", label: "Gemini Test" }]);
      expect(providerCatalog.models[0]).not.toHaveProperty("thinkingOptions");
      expect(providerCatalog.models[0]).not.toHaveProperty("defaultThinkingOptionId");
    },
  );

  test.skipIf(process.platform === "win32")(
    "uses the final result response when AGY emits no assistant step updates",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "agy-native-result-response-test-"));
      const { binary, argvLog } = await createFakeAgy(root, { includeStepUpdate: false });
      const client = new AntigravityNativeAgentClient({
        logger: createTestLogger(),
        command: [binary],
        env: { PASEO_TEST_AGY_ARGV: argvLog },
        profileRoot: join(root, "profiles"),
        temporaryRoot: root,
        resolveExecutable: async () => binary,
      });
      const session = await client.createSession(
        { provider: "gemini-antigravity", cwd: root, modeId: "plan" },
        {
          agentId: "agent-result-response",
          roleBinding: { roleId: "peer", instructions: "Immutable Peer instructions" },
          paseoTools: catalog(),
        },
      );
      try {
        await expect(session.run("Return AGY_OK")).resolves.toMatchObject({ finalText: "AGY_OK" });
      } finally {
        await session.close();
      }
    },
  );
});
