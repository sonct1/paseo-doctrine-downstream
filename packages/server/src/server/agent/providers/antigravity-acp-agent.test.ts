import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

import type { SpawnedACPProcess, SessionStateResponse } from "./acp-agent.js";
import {
  AntigravityACPAgentClient,
  materializeAntigravityRoleLaunch,
  transformAntigravitySessionResponse,
} from "./antigravity-acp-agent.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

const execFile = promisify(execFileCallback);

describe("Antigravity model metadata", () => {
  class TestAntigravityACPAgentClient extends AntigravityACPAgentClient {
    constructor(private readonly response: SessionStateResponse) {
      super({ logger: createTestLogger(), command: ["agy-acp"] });
    }

    protected override async spawnProcess(): Promise<SpawnedACPProcess> {
      return {
        child: { kill: () => true, exitCode: 0, signalCode: null, once: () => undefined },
        connection: {
          newSession: async () => this.response,
        },
        initialize: { agentCapabilities: {} },
      } as SpawnedACPProcess;
    }

    protected override async closeProbe(): Promise<void> {}
  }

  test("normalizes bridge-delimited model ids for catalog and runtime selection", () => {
    expect(
      transformAntigravitySessionResponse({
        sessionId: "session-1",
        models: {
          currentModelId: "gemini-3.6-flash-low\tGemini 3.6 Flash (Low)",
          availableModels: [
            {
              modelId: "gemini-3.6-flash-low\tGemini 3.6 Flash (Low)",
              name: "gemini-3.6-flash-low\tGemini 3.6 Flash (Low)",
              description: null,
            },
          ],
        },
        configOptions: [],
      }),
    ).toMatchObject({
      models: {
        currentModelId: "gemini-3.6-flash-low",
        availableModels: [
          {
            modelId: "gemini-3.6-flash-low",
            name: "Gemini 3.6 Flash (Low)",
          },
        ],
      },
    });
  });

  test("preserves already-normal ACP model metadata", () => {
    const response = {
      sessionId: "session-1",
      models: {
        currentModelId: "gemini-3.6-pro",
        availableModels: [
          {
            modelId: "gemini-3.6-pro",
            name: "Gemini 3.6 Pro",
            description: null,
          },
        ],
      },
      configOptions: [],
    };

    expect(transformAntigravitySessionResponse(response)).toEqual(response);
  });

  test("applies normalization through the provider catalog", async () => {
    const client = new TestAntigravityACPAgentClient({
      sessionId: "session-1",
      models: {
        currentModelId: "gemini-3.6-flash-low\tGemini 3.6 Flash (Low)",
        availableModels: [
          {
            modelId: "gemini-3.6-flash-low\tGemini 3.6 Flash (Low)",
            name: "gemini-3.6-flash-low\tGemini 3.6 Flash (Low)",
            description: null,
          },
        ],
      },
      modes: null,
      configOptions: [],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/antigravity", force: false }),
    ).resolves.toMatchObject({
      models: [
        {
          id: "gemini-3.6-flash-low",
          label: "Gemini 3.6 Flash (Low)",
          isDefault: true,
        },
      ],
    });
  });
});

describe("Antigravity native role binding", () => {
  test.skipIf(process.platform === "win32")(
    "projects an immutable custom agent and pins it through the agy-acp binary slot",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "paseo-antigravity-role-test-"));
      const profileRoot = join(root, "agents");
      const temporaryRoot = join(root, "tmp");
      await Promise.all([
        mkdir(profileRoot, { recursive: true }),
        mkdir(temporaryRoot, { recursive: true }),
      ]);
      try {
        const prepared = await materializeAntigravityRoleLaunch({
          command: ["agy-acp", "--agy-binary", "agy"],
          profileRoot,
          temporaryRoot,
          resolveExecutable: async (name) => (name === "agy" ? "/opt/antigravity/agy" : null),
          launchContext: {
            agentId: "agent-123",
            roleBinding: {
              roleId: "supervisor",
              instructions: "Immutable Supervisor instructions",
            },
          },
        });

        expect(prepared.command?.slice(0, 2)).toEqual(["agy-acp", "--agy-binary"]);
        const wrapperPath = prepared.command?.[2];
        expect(wrapperPath).toContain("paseo-antigravity-role-");
        const [agentName] = await readdir(profileRoot);
        expect(agentName).toMatch(/^paseo-supervisor-[a-f0-9]{12}-[a-f0-9]{12}$/u);
        await expect(readFile(join(profileRoot, agentName, "agent.md"), "utf8")).resolves.toBe(
          `---\nname: ${agentName}\ndescription: Immutable Paseo supervisor role binding\nmainAgent: true\nsubagent: false\n---\n\nImmutable Supervisor instructions\n`,
        );
        await expect(readFile(wrapperPath!, "utf8")).resolves.toContain(
          `exec '/opt/antigravity/agy' --agent '${agentName}' "$@"`,
        );

        await prepared.cleanup?.();
        await expect(stat(join(profileRoot, agentName))).rejects.toMatchObject({ code: "ENOENT" });
        await expect(stat(wrapperPath!)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(process.platform === "win32")(
    "rejects caller-controlled agent selection before writing projections",
    async () => {
      await expect(
        materializeAntigravityRoleLaunch({
          command: ["agy-acp", "--agy-binary", "/opt/antigravity/agy", "--agent", "default"],
          resolveExecutable: async () => "/opt/antigravity/agy",
          launchContext: {
            agentId: "agent-123",
            roleBinding: { roleId: "peer", instructions: "Peer instructions" },
          },
        }),
      ).rejects.toThrow("caller-supplied --agent");
    },
  );

  test.skipIf(process.platform === "win32")(
    "pins the custom agent ahead of every bridge-supplied prompt and resume argument",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "paseo-antigravity-wrapper-test-"));
      const profileRoot = join(root, "agents");
      const temporaryRoot = join(root, "tmp");
      const fakeAgy = join(root, "fake-agy");
      const argvLog = join(root, "argv.log");
      await Promise.all([
        mkdir(profileRoot, { recursive: true }),
        mkdir(temporaryRoot, { recursive: true }),
        writeFile(fakeAgy, '#!/bin/sh\nset -eu\nprintf "%s\\n" "$@" > "$PASEO_AGY_ARGV_LOG"\n', {
          encoding: "utf8",
          mode: 0o700,
        }),
      ]);
      try {
        const prepared = await materializeAntigravityRoleLaunch({
          command: ["agy-acp", "--agy-binary", fakeAgy],
          profileRoot,
          temporaryRoot,
          resolveExecutable: async () => fakeAgy,
          launchContext: {
            agentId: "agent-bridge",
            roleBinding: { roleId: "lead", instructions: "Immutable Lead instructions" },
          },
        });
        const wrapperPath = prepared.command?.[2];
        const [agentName] = await readdir(profileRoot);

        await execFile(wrapperPath!, ["--conversation", "conv-1", "--model", "m-1", "-p", "hi"], {
          env: { ...process.env, PASEO_AGY_ARGV_LOG: argvLog },
        });
        await expect(readFile(argvLog, "utf8")).resolves.toBe(
          `--agent\n${agentName}\n--conversation\nconv-1\n--model\nm-1\n-p\nhi\n`,
        );

        await execFile(wrapperPath!, ["models"], {
          env: { ...process.env, PASEO_AGY_ARGV_LOG: argvLog },
        });
        await expect(readFile(argvLog, "utf8")).resolves.toBe("models\n");

        await expect(
          execFile(wrapperPath!, ["--agent", "attacker", "-p", "hi"], {
            env: { ...process.env, PASEO_AGY_ARGV_LOG: argvLog },
          }),
        ).rejects.toThrow();
        await prepared.cleanup?.();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
