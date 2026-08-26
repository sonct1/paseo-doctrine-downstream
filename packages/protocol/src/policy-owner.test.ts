import { describe, expect, test } from "vitest";

import {
  LEGACY_CORE_POLICY_OWNER,
  PolicyGenerationDigestSchema,
  PolicyOwnerSchema,
} from "./policy-owner.js";

describe("policy owner", () => {
  test("accepts the explicit legacy owner", () => {
    expect(PolicyOwnerSchema.parse(LEGACY_CORE_POLICY_OWNER)).toEqual({ kind: "legacy-core" });
  });

  test("pins a plugin owner to one immutable generation", () => {
    const generationDigest = "a".repeat(64);
    expect(
      PolicyOwnerSchema.parse({
        kind: "plugin",
        pluginId: "slp",
        generationDigest,
        policyVersion: "1.0.0",
      }),
    ).toEqual({
      kind: "plugin",
      pluginId: "slp",
      generationDigest,
      policyVersion: "1.0.0",
    });
  });

  test("rejects ambiguous or mutable plugin ownership", () => {
    expect(() =>
      PolicyOwnerSchema.parse({
        kind: "plugin",
        pluginId: "SLP",
        generationDigest: "not-a-digest",
        policyVersion: "",
      }),
    ).toThrow();
    expect(() => PolicyGenerationDigestSchema.parse("A".repeat(64))).toThrow();
    expect(() => PolicyOwnerSchema.parse({ kind: "legacy-core", pluginId: "slp" })).toThrow();
  });
});
