import { describe, expect, test } from "vitest";
import {
  assignmentAuthorityLabel,
  defaultAssignmentEffectForRole,
  ordinaryAssignmentAuthorityOptionsForRole,
} from "./assignment-authority";

describe("ordinary assignment authority", () => {
  test("shows role-aware intents and keeps recovery flows contextual", () => {
    expect(ordinaryAssignmentAuthorityOptionsForRole("lead").map((option) => option.id)).toEqual([
      "mutating",
      "read-only",
      "delegation",
    ]);
    expect(ordinaryAssignmentAuthorityOptionsForRole("peer").map((option) => option.id)).toEqual([
      "mutating",
      "read-only",
    ]);
    expect(
      ordinaryAssignmentAuthorityOptionsForRole("supervisor").map((option) => option.id),
    ).toEqual(["read-only", "delegation"]);
  });

  test("uses task-oriented defaults and labels", () => {
    expect(defaultAssignmentEffectForRole("lead")).toBe("mutating");
    expect(defaultAssignmentEffectForRole("peer")).toBe("mutating");
    expect(defaultAssignmentEffectForRole("supervisor")).toBe("read-only");
    expect(assignmentAuthorityLabel("lead", "delegation")).toBe("Coordinate only");
    expect(assignmentAuthorityLabel("supervisor", "recovery")).toBe("recovery");
  });
});
