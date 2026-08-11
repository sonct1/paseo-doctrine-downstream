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
  WORKSPACE_PROTOCOL_ADMISSION_ERROR,
} from "./role-binding.js";
import { buildWorkspaceProtocolTemplate } from "../../utils/workspace-protocol-file.js";
import type { AssignmentEnvelope } from "@getpaseo/protocol/assignment-contract";

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

function assignmentFor(
  roleId: "lead" | "peer" | "supervisor",
  effectClass: AssignmentEnvelope["effectClass"] = "read-only",
): AssignmentEnvelope {
  let disposition: AssignmentEnvelope["disposition"] = "supervision";
  if (roleId === "lead") disposition = "lead-direct";
  if (roleId === "peer") disposition = "peer-execution";
  return {
    version: 1,
    disposition,
    objective: "Inspect the bounded target and hand back evidence.",
    effectClass,
    mutationBoundary:
      effectClass === "mutating"
        ? { mode: "bounded-write", scope: "src/**" }
        : { mode: "no-write" },
    externalEffectBoundary: { mode: "denied" },
    evidence: "Report exact inspected paths and observed checks.",
    handbackAndStop: "Stop after evidence handback or a material blocker.",
  };
}

function assignmentBinding(roleId: "lead" | "peer" | "supervisor", cwd: string) {
  return {
    workspaceId: `workspace:${cwd}`,
    assignment: assignmentFor(roleId),
    assignmentAssigner: { kind: "human-session" as const },
  };
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
    await writeFile(
      join(cwd, "WORKSPACE_PROTOCOL.md"),
      buildWorkspaceProtocolTemplate(cwd),
      "utf8",
    );

    const binding = await materializeRoleBinding({
      roleId: "lead",
      provider: "codex-custom",
      providerBaseId: "codex",
      cwd,
      ...assignmentBinding("lead", cwd),
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
    expect(binding.instructions).not.toContain("Council compatibility marker");
    expect(binding.instructions).toContain("Demonthorn Agent Orchestration Deep Dive");
    expect(binding.instructions).toContain("Giáo Án Herdr");
    expect(binding.instructions).toContain("runtime-issued PASEO_AGENT_ID");
    expect(binding.instructions).toContain("Broad agent lists may omit internal loop workers");
    expect(binding.instructions).toContain(binding.workspaceProtocol.digest);
    expect(binding.instructions).toContain("Mutation boundary: no-write");
    expect(binding.assignment).toMatchObject({ effectClass: "read-only" });
    const receipt = toRoleBindingReceipt(binding);
    expect(receipt).not.toHaveProperty("instructions");
    expect(receipt).not.toHaveProperty("assignmentContract");
    expect(JSON.stringify(receipt)).not.toContain("Inspect the bounded target");
    expect(JSON.stringify(receipt)).not.toContain("Report exact inspected paths");
    expect(JSON.stringify(receipt)).not.toContain("Stop after evidence handback");
  });

  test("keeps Peer protocol readership assignment-only", async () => {
    const cwd = await createWorkspace();
    await writeFile(
      join(cwd, "WORKSPACE_PROTOCOL.md"),
      buildWorkspaceProtocolTemplate(cwd),
      "utf8",
    );
    const binding = await materializeRoleBinding({
      roleId: "peer",
      provider: "claude",
      cwd,
      ...assignmentBinding("peer", cwd),
    });

    expect(binding.injectionMethod).toBe("claude-system-prompt");
    expect(binding.workspaceProtocol).toMatchObject({
      status: "bound",
      readership: "assignment-only",
      path: join(cwd, "WORKSPACE_PROTOCOL.md"),
    });
    expect(binding.instructions).toContain("Do not load");
    expect(binding.instructions).not.toContain("Room role: Root");
  });

  test("rejects a missing or invalid mandatory protocol", async () => {
    const missing = await createWorkspace();
    const invalid = await createWorkspace();
    await writeFile(join(invalid, "WORKSPACE_PROTOCOL.md"), "# Workspace Protocol\n", "utf8");

    await expect(
      materializeRoleBinding({
        roleId: "lead",
        provider: "codex",
        cwd: missing,
        ...assignmentBinding("lead", missing),
        assignment: assignmentFor("lead", "mutating"),
      }),
    ).rejects.toThrow(`${WORKSPACE_PROTOCOL_ADMISSION_ERROR}: missing`);
    await expect(
      materializeRoleBinding({
        roleId: "peer",
        provider: "claude",
        cwd: invalid,
        ...assignmentBinding("peer", invalid),
      }),
    ).rejects.toThrow(`${WORKSPACE_PROTOCOL_ADMISSION_ERROR}: invalid`);
  });

  test("allows a Human-bound read-only exception for a missing protocol", async () => {
    const cwd = await createWorkspace();
    const binding = await materializeRoleBinding({
      roleId: "lead",
      provider: "codex",
      cwd,
      workspaceId: `workspace:${cwd}`,
      assignmentAssigner: { kind: "human-session" },
      assignment: {
        ...assignmentFor("lead"),
        protocolException: {
          reason: "Inspect repository facts needed for bootstrap.",
          scope: cwd,
          expiresAt: "2026-08-05T01:00:00.000Z",
        },
      },
      createdAt: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(binding.workspaceProtocol.status).toBe("missing");
    expect(binding.instructions).toContain(
      "temporarily missing under an exact Human bootstrap exception",
    );
    expect(binding.assignment?.protocolExceptionExpiresAt).toBe("2026-08-05T01:00:00.000Z");
    const receiptJson = JSON.stringify(toRoleBindingReceipt(binding));
    expect(receiptJson).not.toContain("Inspect repository facts needed for bootstrap");
    expect(receiptJson).not.toContain("assignmentContract");
  });
  test("fails closed for a provider without a native durable role channel", async () => {
    const cwd = await createWorkspace();
    await writeFile(
      join(cwd, "WORKSPACE_PROTOCOL.md"),
      buildWorkspaceProtocolTemplate(cwd),
      "utf8",
    );

    expect(resolveProviderRoleBindingSupport("generic-acp")).toMatchObject({
      status: "unsupported",
    });
    await expect(
      materializeRoleBinding({
        roleId: "lead",
        provider: "generic-acp",
        cwd,
        ...assignmentBinding("lead", cwd),
      }),
    ).rejects.toThrow("no qualified native durable role-instruction channel");
  });

  test("supports Pi and OMP through their native durable instruction channels", () => {
    expect(resolveProviderRoleBindingSupport("mock")).toEqual({
      status: "supported",
      injectionMethod: "mock-launch-context",
      notice: "Development-only synthetic provider; role instructions are bound at session launch.",
    });
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
    ).toMatchObject(
      process.platform === "win32"
        ? { status: "unsupported" }
        : { status: "supported", injectionMethod: "antigravity-custom-agent" },
    );
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
    expect(applyRolePaseoToolPolicy("peer", { enabled: false })).toEqual({
      enabled: true,
      allowedTools: expect.arrayContaining([
        "beads_get",
        "beads_claim",
        "beads_update",
        "beads_add_dependency",
      ]),
    });
    expect(
      applyRolePaseoToolPolicy("peer", {
        enabled: true,
        allowedTools: ["beads_get", "beads_close", "create_agent"],
      }),
    ).toEqual({ enabled: true, allowedTools: ["beads_get"] });
    expect(applyRolePaseoToolPolicy("supervisor", { enabled: false })).toEqual({
      enabled: true,
      allowedTools: expect.arrayContaining(["get_agent_status", "list_agents", "beads_get"]),
    });
    expect(
      applyRolePaseoToolPolicy("supervisor", {
        enabled: true,
        allowedTools: ["list_agents", "create_agent"],
      }),
    ).toEqual({ enabled: true, allowedTools: ["list_agents"] });
    expect(
      applyRolePaseoToolPolicy("supervisor", {
        enabled: true,
        allowedTools: ["list_agents", "get_agent_status"],
        disabledTools: ["list_agents"],
      }),
    ).toEqual({ enabled: true, allowedTools: ["get_agent_status"] });
  });
});
