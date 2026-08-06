import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import type { SpawnedACPProcess, SessionStateResponse } from "./acp-agent.js";
import {
  CURSOR_FAST_FEATURE_OPTION,
  CursorACPAgentClient,
  materializeCursorRoleCapsule,
} from "./cursor-acp-agent.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

describe("CursorACPAgentClient model discovery", () => {
  function fastConfigOption(currentValue: "false" | "true") {
    return {
      id: "fast",
      name: "Fast",
      type: "select" as const,
      currentValue,
      options: [
        { value: "false", name: "Off" },
        { value: "true", name: "Fast" },
      ],
    };
  }
  class TestCursorACPAgentClient extends CursorACPAgentClient {
    constructor(response: SessionStateResponse) {
      super({
        logger: createTestLogger(),
        command: ["cursor-agent", "acp"],
      });
      this.response = response;
    }

    private readonly response: SessionStateResponse;

    protected override async spawnProcess(): Promise<SpawnedACPProcess> {
      return {
        child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
        connection: {
          newSession: vi.fn().mockResolvedValue(this.response),
        },
        initialize: { agentCapabilities: {} },
      } as SpawnedACPProcess;
    }

    protected override async closeProbe(): Promise<void> {}
  }

  test("returns only ACP model ids because Cursor CLI ids cannot select ACP models", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: {
        currentModelId: "gpt-5.4[context=272k,reasoning=medium,fast=false]",
        availableModels: [
          {
            modelId: "gpt-5.4[context=272k,reasoning=medium,fast=false]",
            name: "gpt-5.4",
            description: null,
          },
        ],
      },
      configOptions: [],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toEqual({
      models: [
        {
          provider: "acp",
          id: "gpt-5.4[context=272k,reasoning=medium,fast=false]",
          label: "gpt-5.4",
          description: undefined,
          isDefault: true,
          thinkingOptions: undefined,
          defaultThinkingOptionId: undefined,
        },
      ],
      modes: [],
    });
  });

  test("does not fall back to cursor-agent models when ACP reports zero models", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: null,
      configOptions: [],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toEqual({
      models: [],
      modes: [],
    });
  });

  test("keeps modern Cursor models as plain ACP ids", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: {
        currentModelId: "composer-2.5",
        availableModels: [
          {
            modelId: "composer-2.5",
            name: "Composer 2.5",
            description: null,
          },
        ],
      },
      configOptions: [fastConfigOption("false")],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toEqual({
      models: [
        {
          provider: "acp",
          id: "composer-2.5",
          label: "Composer 2.5",
          description: undefined,
          isDefault: true,
          thinkingOptions: undefined,
          defaultThinkingOptionId: undefined,
        },
      ],
      modes: [],
    });
  });

  test("exposes Cursor fast mode through provider features", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: null,
      configOptions: [fastConfigOption("false")],
    });

    await expect(
      client.listFeatures({
        provider: "acp",
        cwd: "/tmp/cursor",
      }),
    ).resolves.toEqual([
      {
        type: "toggle",
        id: "auto_accept",
        label: "Auto Accept",
        description: "Automatically approves ACP permission prompts.",
        tooltip: "Auto accept permission prompts",
        icon: "shield-check",
        value: false,
      },
      {
        type: "select",
        id: CURSOR_FAST_FEATURE_OPTION.id,
        label: "Fast",
        description: "Cursor fast mode",
        tooltip: "Select Cursor fast mode",
        icon: "zap",
        value: "false",
        options: [
          {
            id: "false",
            label: "Off",
            isDefault: true,
            description: undefined,
            metadata: undefined,
          },
          {
            id: "true",
            label: "Fast",
            isDefault: false,
            description: undefined,
            metadata: undefined,
          },
        ],
      },
    ]);
  });
});

describe("Cursor native role binding", () => {
  test("projects exact role bytes into a stable isolated workspace-rule capsule", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "paseo-cursor-role-test-"));
    try {
      const prepared = await materializeCursorRoleCapsule({
        command: ["cursor-agent", "acp"],
        cwd: "/workspace/repo",
        capsuleRoot: temporaryRoot,
        launchContext: {
          agentId: "agent-1",
          roleBinding: {
            roleId: "peer",
            instructions: "Immutable Peer instructions",
          },
        },
      });
      const capsuleDirectory = prepared.command?.[2];
      expect(prepared.command).toEqual([
        "cursor-agent",
        "--workspace",
        capsuleDirectory,
        "--add-dir",
        "/workspace/repo",
        "acp",
      ]);
      expect(capsuleDirectory).toMatch(/paseo-peer-[a-f0-9]{12}-[a-f0-9]{12}$/u);
      await expect(
        readFile(join(capsuleDirectory!, ".cursor", "rules", "paseo-role.mdc"), "utf8"),
      ).resolves.toContain("alwaysApply: true\n---\n\nImmutable Peer instructions");

      expect(prepared.cleanup).toBeUndefined();
      await expect(stat(capsuleDirectory!)).resolves.toBeDefined();

      const rematerialized = await materializeCursorRoleCapsule({
        command: ["cursor-agent", "acp"],
        cwd: "/workspace/repo",
        capsuleRoot: temporaryRoot,
        launchContext: {
          agentId: "agent-1",
          roleBinding: {
            roleId: "peer",
            instructions: "Immutable Peer instructions",
          },
        },
      });
      expect(rematerialized.command).toEqual(prepared.command);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("rejects a caller-supplied Cursor workspace", async () => {
    await expect(
      materializeCursorRoleCapsule({
        command: ["cursor-agent", "--workspace", "/tmp/caller", "acp"],
        cwd: "/workspace/repo",
        launchContext: {
          agentId: "agent-1",
          roleBinding: { roleId: "lead", instructions: "Lead instructions" },
        },
      }),
    ).rejects.toThrow("caller-supplied --workspace");
  });
});
