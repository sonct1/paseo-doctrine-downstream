import { describe, expect, test } from "vitest";
import { agentProfileTargetAllowsApply, isHumanSelectableAgentProfile } from "./target-policy";

describe("agent profile apply target policy", () => {
  test("allows ordinary drafts and live agents but rejects every role-bound surface", () => {
    expect(agentProfileTargetAllowsApply({ kind: "draft", roleBound: false })).toBe(true);
    expect(agentProfileTargetAllowsApply({ kind: "draft", roleBound: true })).toBe(false);
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

  test("keeps Peer routing profiles out of Human-facing pickers", () => {
    expect(isHumanSelectableAgentProfile({})).toBe(true);
    expect(isHumanSelectableAgentProfile({ peerSubrole: "engineer" })).toBe(false);
  });
});
