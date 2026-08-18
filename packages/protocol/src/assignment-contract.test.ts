import { describe, expect, test } from "vitest";

import {
  assignmentExternalEffectBoundaryFor,
  isAssignmentEffectAllowedForRole,
  PASEO_BEADS_EXTERNAL_EFFECT_SCOPE,
} from "./assignment-contract.js";

describe("assignment external-effect defaults", () => {
  test("leases only the mandatory Beads graph to mutating Lead and Peer work", () => {
    expect(assignmentExternalEffectBoundaryFor("lead", "delegation")).toEqual({
      mode: "bounded",
      scope: PASEO_BEADS_EXTERNAL_EFFECT_SCOPE,
    });
    expect(assignmentExternalEffectBoundaryFor("lead", "mutating")).toEqual({
      mode: "bounded",
      scope: PASEO_BEADS_EXTERNAL_EFFECT_SCOPE,
    });
    expect(assignmentExternalEffectBoundaryFor("peer", "mutating")).toEqual({
      mode: "bounded",
      scope: PASEO_BEADS_EXTERNAL_EFFECT_SCOPE,
    });
  });

  test("keeps read-only and Supervisor assignments externally denied", () => {
    expect(assignmentExternalEffectBoundaryFor("lead", "read-only")).toEqual({ mode: "denied" });
    expect(assignmentExternalEffectBoundaryFor("peer", "read-only")).toEqual({ mode: "denied" });
    expect(assignmentExternalEffectBoundaryFor("supervisor", "recovery")).toEqual({
      mode: "denied",
    });
    expect(assignmentExternalEffectBoundaryFor("supervisor", "delegation")).toEqual({
      mode: "denied",
    });
    expect(isAssignmentEffectAllowedForRole("supervisor", "delegation")).toBe(true);
  });
});
