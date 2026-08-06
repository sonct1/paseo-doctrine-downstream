import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  applyRolePaseoToolPolicy,
  detectLegacyProviderRole,
  materializeRoleBinding,
  resolveProviderRoleBindingSupport,
  toRoleBindingReceipt,
} from "./role-binding.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "paseo-role-binding-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("native Foundation role materialization", () => {
  test("detects only exact legacy role transport commands", () => {
    expect(detectLegacyProviderRole(["/opt/paseo/codex-profile", "lead"])).toBe("lead");
    expect(detectLegacyProviderRole(["claude", "--agent", "paseo-supervisor"])).toBe("supervisor");
    expect(detectLegacyProviderRole(["custom-provider", "peer"])).toBeNull();
    expect(detectLegacyProviderRole(["claude", "--agent", "unrelated-peer"])).toBeNull();
  });

  test("binds Lead to Codex with protocol provenance and a redacted receipt", async () => {
    const cwd = await createWorkspace();
    await writeFile(join(cwd, "WORKSPACE_PROTOCOL.md"), "# Protocol\n\nOwner: Human\n", "utf8");

    const binding = await materializeRoleBinding({
      roleId: "lead",
      provider: "codex-custom",
      providerBaseId: "codex",
      cwd,
      createdAt: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(binding.injectionMethod).toBe("codex-developer-instructions");
    expect(binding.workspaceProtocol).toMatchObject({
      status: "bound",
      readership: "full",
      path: join(cwd, "WORKSPACE_PROTOCOL.md"),
    });
    expect(binding.workspaceProtocol.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(binding.instructions).toContain("Role: Lead");
    expect(binding.instructions).toContain("Demonthorn Agent Orchestration Deep Dive");
    expect(binding.instructions).toContain("Giáo Án Herdr");
    expect(binding.instructions).toContain("runtime-issued PASEO_AGENT_ID");
    expect(binding.instructions).toContain("Broad agent lists may omit internal loop workers");
    expect(binding.instructions).toContain(binding.workspaceProtocol.digest);
    expect(toRoleBindingReceipt(binding)).not.toHaveProperty("instructions");
  });

  test("keeps Peer protocol readership assignment-only", async () => {
    const cwd = await createWorkspace();
    const binding = await materializeRoleBinding({
      roleId: "peer",
      provider: "claude",
      cwd,
    });

    expect(binding.injectionMethod).toBe("claude-system-prompt");
    expect(binding.workspaceProtocol).toEqual({
      status: "missing",
      readership: "assignment-only",
      path: join(cwd, "WORKSPACE_PROTOCOL.md"),
    });
    expect(binding.instructions).toContain("Do not load");
  });

  test("fails closed for a provider without a native durable role channel", async () => {
    const cwd = await createWorkspace();

    expect(resolveProviderRoleBindingSupport("generic-acp")).toMatchObject({
      status: "unsupported",
    });
    await expect(
      materializeRoleBinding({ roleId: "lead", provider: "generic-acp", cwd }),
    ).rejects.toThrow("no qualified native durable role-instruction channel");
  });

  test("supports Pi and OMP through their native durable instruction channels", () => {
    expect(resolveProviderRoleBindingSupport("pi")).toEqual({
      status: "supported",
      injectionMethod: "pi-before-agent-start",
    });
    expect(resolveProviderRoleBindingSupport("custom-omp", "omp")).toEqual({
      status: "supported",
      injectionMethod: "omp-append-system-prompt",
    });
  });

  test("auto-detects qualified provider-native ACP drivers and retires plugin projection", () => {
    expect(
      resolveProviderRoleBindingSupport("cursor", null, null, undefined, ["cursor-agent", "acp"]),
    ).toMatchObject({
      status: "supported",
      injectionMethod: "cursor-project-rule-capsule",
    });
    expect(
      resolveProviderRoleBindingSupport("antigravity", null, null, undefined, [
        "agy-acp",
        "--agy-binary",
        "/opt/agy",
      ]),
    ).toMatchObject({
      status: process.platform === "win32" ? "unsupported" : "supported",
      injectionMethod: "antigravity-custom-agent",
    });
    expect(
      resolveProviderRoleBindingSupport(
        "antigravity",
        null,
        null,
        { driver: "antigravity-custom-agent" },
        ["agy-acp", "--agy-binary", "/opt/agy", "--agent", "default"],
      ),
    ).toMatchObject({ status: "unsupported" });
    expect(
      resolveProviderRoleBindingSupport("cursor", null, null, { driver: "cursor-plugin" }, [
        "cursor-agent",
        "acp",
      ]),
    ).toMatchObject({ status: "unsupported", reason: expect.stringContaining("retired") });
  });

  test("role-bound tool policy owns enablement while provider filters can narrow it", () => {
    expect(applyRolePaseoToolPolicy(undefined, { enabled: false })).toEqual({ enabled: false });
    expect(applyRolePaseoToolPolicy("lead", { enabled: false })).toEqual({ enabled: true });
    expect(
      applyRolePaseoToolPolicy("lead", {
        enabled: false,
        disabledTools: ["list_agents"],
      }),
    ).toEqual({ enabled: true, disabledTools: ["list_agents"] });
    expect(applyRolePaseoToolPolicy("peer", { enabled: true })).toEqual({ enabled: false });
    expect(applyRolePaseoToolPolicy("supervisor", { enabled: false })).toEqual({
      enabled: true,
      allowedTools: expect.arrayContaining(["get_agent_status", "list_agents"]),
    });
    expect(
      applyRolePaseoToolPolicy("supervisor", {
        enabled: true,
        allowedTools: ["list_agents", "create_agent"],
      }),
    ).toEqual({ enabled: true, allowedTools: ["list_agents"] });
  });
});
