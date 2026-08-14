import { describe, expect, test } from "vitest";
import type { AssignmentEnvelope } from "@getpaseo/protocol/assignment-contract";
import {
  ASSIGNMENT_CONTRACT_INVALID_ERROR,
  ASSIGNMENT_CONTRACT_REQUIRED_ERROR,
  buildAssignmentInstruction,
  materializeAssignmentContract,
} from "./assignment-contract.js";

const now = new Date("2026-08-08T00:00:00.000Z");

function envelope(overrides: Partial<AssignmentEnvelope> = {}): AssignmentEnvelope {
  return {
    version: 1,
    disposition: "lead-direct",
    objective: "Inspect the repository without mutation.",
    effectClass: "read-only",
    mutationBoundary: { mode: "no-write" },
    externalEffectBoundary: { mode: "denied" },
    evidence: "Return exact inspected paths.",
    handbackAndStop: "Stop after the evidence handback.",
    ...overrides,
  };
}

function materialize(input: {
  envelope?: AssignmentEnvelope;
  assigner?: { kind: "human-session" } | { kind: "agent"; agentId: string };
  roleId?: "lead" | "peer" | "supervisor";
}) {
  return materializeAssignmentContract({
    roleId: input.roleId ?? "lead",
    assigner: input.assigner ?? { kind: "human-session" },
    workspaceId: "workspace-1",
    cwd: "/repo",
    envelope: input.envelope,
    createdAt: now,
  });
}

describe("immutable assignment contract", () => {
  test("materializes a stable receipt and durable authority instruction", () => {
    const contract = materialize({
      envelope: envelope({ resourceGrants: { beadsIssueIds: ["ps123-abc"] } }),
    });

    expect(contract.receipt).toMatchObject({
      roleId: "lead",
      assigner: { kind: "human-session" },
      effectClass: "read-only",
      mutationBoundary: { mode: "no-write" },
      resourceGrants: { beadsIssueIds: ["ps123-abc"] },
      createdAt: now.toISOString(),
    });
    expect(contract.receipt.assignmentDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(buildAssignmentInstruction(contract)).toContain("Mutation boundary: no-write");
    expect(buildAssignmentInstruction(contract)).toContain("Beads issue grants: ps123-abc");
    expect(buildAssignmentInstruction(contract)).toContain(
      "Mandatory Beads Central checkpoint: call beads_status",
    );
  });

  test("accepts an RFC 3339 offset timestamp for assignment expiry", () => {
    const contract = materialize({
      envelope: envelope({ expiresAt: "2026-08-08T08:00:00+07:00" }),
    });

    expect(contract.receipt.expiresAt).toBe("2026-08-08T08:00:00+07:00");
  });

  test("injects role-specific mandatory tracker behavior", () => {
    const peer = materialize({
      roleId: "peer",
      envelope: envelope({
        disposition: "peer-execution",
        resourceGrants: { beadsIssueIds: ["ps123-abc"] },
      }),
    });
    const supervisor = materialize({
      roleId: "supervisor",
      envelope: envelope({ disposition: "supervision" }),
    });

    expect(buildAssignmentInstruction(peer)).toContain("Claim before owned mutation");
    expect(buildAssignmentInstruction(peer)).toContain("never close");
    expect(buildAssignmentInstruction(peer)).toContain("never guess or hard-code an MCP namespace");
    expect(buildAssignmentInstruction(peer)).toContain(
      "Only an authoritative Paseo tool receipt counts",
    );
    expect(buildAssignmentInstruction(supervisor)).toContain("Remain read-only");
    expect(buildAssignmentInstruction(supervisor)).toContain("material handoff");
  });

  test("requires an issue grant only for a mutating Peer", () => {
    expect(
      materialize({
        roleId: "peer",
        envelope: envelope({ disposition: "peer-execution" }),
      }).envelope.resourceGrants,
    ).toBeUndefined();
    expect(() =>
      materialize({
        roleId: "peer",
        envelope: envelope({
          disposition: "peer-execution",
          effectClass: "mutating",
          mutationBoundary: { mode: "bounded-write", scope: "/repo" },
          externalEffectBoundary: {
            mode: "bounded",
            scope:
              "Beads Central issue/work graph for this assignment only; no other external effects",
          },
        }),
      }),
    ).toThrow("mutating Peer requires an exact Beads issue grant");
  });

  test("fails closed when a role-bound create omits the assignment", () => {
    expect(() => materialize({})).toThrow(ASSIGNMENT_CONTRACT_REQUIRED_ERROR);
  });

  test("rejects contradictory effect boundaries", () => {
    expect(() =>
      materialize({
        envelope: envelope({
          effectClass: "read-only",
          mutationBoundary: { mode: "bounded-write", scope: "src/**" },
        }),
      }),
    ).toThrow(`${ASSIGNMENT_CONTRACT_INVALID_ERROR}: read-only requires no-write`);
    expect(() =>
      materialize({
        envelope: envelope({
          effectClass: "delegation",
          mutationBoundary: { mode: "bounded-write", scope: "src/**" },
        }),
      }),
    ).toThrow(`${ASSIGNMENT_CONTRACT_INVALID_ERROR}: delegation requires no-write`);
  });

  test("rejects an external-effect lease that contradicts the role and effect", () => {
    expect(() =>
      materialize({
        roleId: "peer",
        envelope: envelope({
          disposition: "independent-review",
          resourceGrants: { beadsIssueIds: ["ps123-abc"] },
          externalEffectBoundary: {
            mode: "bounded",
            scope: "Beads Central update to the granted issue only",
          },
        }),
      }),
    ).toThrow(
      `${ASSIGNMENT_CONTRACT_INVALID_ERROR}: peer read-only requires external effects denied`,
    );
  });

  test("permits an exact bounded bootstrap write", () => {
    expect(
      materialize({
        envelope: envelope({
          effectClass: "bootstrap",
          mutationBoundary: {
            mode: "bounded-write",
            scope: "/repo/WORKSPACE_PROTOCOL.md",
          },
        }),
      }).receipt.mutationBoundary,
    ).toEqual({ mode: "bounded-write", scope: "/repo/WORKSPACE_PROTOCOL.md" });
  });

  test("rejects effects that contradict standing role authority", () => {
    expect(() =>
      materialize({
        roleId: "peer",
        envelope: envelope({
          disposition: "peer-execution",
          effectClass: "delegation",
        }),
      }),
    ).toThrow("effect 'delegation' is not allowed for role 'peer'");
    expect(() =>
      materialize({
        roleId: "supervisor",
        envelope: envelope({
          disposition: "supervision",
          effectClass: "mutating",
          mutationBoundary: { mode: "bounded-write", scope: "/repo" },
        }),
      }),
    ).toThrow("effect 'mutating' is not allowed for role 'supervisor'");
  });

  test("rejects an agent-issued or expired protocol exception", () => {
    const withException = envelope({
      protocolException: {
        reason: "Bootstrap inspection",
        scope: "/repo",
        expiresAt: "2026-08-08T01:00:00.000Z",
      },
    });
    expect(() =>
      materialize({
        envelope: withException,
        assigner: { kind: "agent", agentId: "agent-1" },
      }),
    ).toThrow("protocol exception requires Human session issuer");
    expect(() =>
      materialize({
        envelope: envelope({
          protocolException: {
            reason: "Bootstrap inspection",
            scope: "/repo",
            expiresAt: "2026-08-07T23:59:59.000Z",
          },
        }),
      }),
    ).toThrow("protocolException.expiresAt must be in the future");
  });

  test("rejects a protocol exception for a different workspace scope", () => {
    expect(() =>
      materialize({
        envelope: envelope({
          protocolException: {
            reason: "Bootstrap inspection",
            scope: "/another-repo",
            expiresAt: "2026-08-08T01:00:00.000Z",
          },
        }),
      }),
    ).toThrow("protocol exception scope must equal assignment cwd");
  });
});
