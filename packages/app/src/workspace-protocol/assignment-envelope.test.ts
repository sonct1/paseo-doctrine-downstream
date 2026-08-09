import { describe, expect, test } from "vitest";
import { buildAssignmentEnvelope } from "./assignment-envelope";

describe("assignment envelope", () => {
  test("keeps read-only as no-write and bounds mutation to the exact workspace", () => {
    expect(
      buildAssignmentEnvelope({
        roleId: "lead",
        effectClass: "read-only",
        objective: "Inspect current state",
        cwd: "/repo",
      }).mutationBoundary,
    ).toEqual({ mode: "no-write" });
    expect(
      buildAssignmentEnvelope({
        roleId: "peer",
        effectClass: "mutating",
        objective: "Implement the bounded fix",
        cwd: "/repo/worktree",
      }),
    ).toMatchObject({
      disposition: "peer-execution",
      mutationBoundary: { mode: "bounded-write", scope: "/repo/worktree" },
      externalEffectBoundary: { mode: "denied" },
    });
  });

  test("rejects a role launch without an objective", () => {
    expect(() =>
      buildAssignmentEnvelope({
        roleId: "lead",
        effectClass: "read-only",
        objective: "   ",
        cwd: "/repo",
      }),
    ).toThrow("assignment_contract_required: objective");
  });

  test("bounds bootstrap to the root protocol artifact", () => {
    expect(
      buildAssignmentEnvelope({
        roleId: "lead",
        effectClass: "bootstrap",
        objective: "Create the baseline protocol",
        cwd: "/repo",
      }).mutationBoundary,
    ).toEqual({ mode: "bounded-write", scope: "/repo/WORKSPACE_PROTOCOL.md" });
    expect(
      buildAssignmentEnvelope({
        roleId: "lead",
        effectClass: "bootstrap",
        objective: "Create the baseline protocol",
        cwd: "C:\\repo\\",
      }).mutationBoundary,
    ).toEqual({ mode: "bounded-write", scope: "C:\\repo\\WORKSPACE_PROTOCOL.md" });
  });
});
