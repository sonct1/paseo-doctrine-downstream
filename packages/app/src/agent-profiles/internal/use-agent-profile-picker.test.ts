import { describe, expect, test } from "vitest";
import { agentProfileTargetAllowsApply } from "./target-policy";

describe("agent profile apply target policy", () => {
  test("allows drafts and ordinary live agents but rejects live role-bound agents", () => {
    expect(agentProfileTargetAllowsApply({ kind: "draft" })).toBe(true);
    expect(
      agentProfileTargetAllowsApply({
        kind: "agent",
        roleBound: false,
      }),
    ).toBe(true);
    expect(
      agentProfileTargetAllowsApply({
        kind: "agent",
        roleBound: true,
      }),
    ).toBe(false);
  });
});
