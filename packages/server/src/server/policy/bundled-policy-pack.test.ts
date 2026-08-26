import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  assertLocalPluginIdAvailable,
  BUNDLED_POLICY_PACK_MISSING_ERROR,
  BUNDLED_POLICY_PACK_RESERVED_ID_ERROR,
  BUNDLED_POLICY_PACK_UNAVAILABLE_ERROR,
  BundledPolicyPackRegistry,
} from "./bundled-policy-pack.js";
import { createDefaultSlpBundledPolicyRegistry } from "./bundled/slp.js";

function manifest(policyVersion: string) {
  return { id: "slp" as const, abiVersion: 1 as const, policyVersion };
}

describe("bundled policy pack registry", () => {
  test("loads the default SLP generation independently of local plugin configuration", () => {
    const first = createDefaultSlpBundledPolicyRegistry().resolveActive("slp");
    const second = createDefaultSlpBundledPolicyRegistry().resolveActive("slp");

    expect(first.owner).toEqual(second.owner);
    expect(first.owner).toEqual({
      kind: "plugin",
      pluginId: "slp",
      policyVersion: "1.0.0",
      generationDigest: "569c7f4633b7ffacb2e63c0ee3dda1ea882bc050bc456fdc8ac0c466f4f483f0",
    });
  });

  test("derives immutable ownership from exact artifact bytes", () => {
    const registry = new BundledPolicyPackRegistry<{ marker: string }>();
    const generation = registry.registerGeneration({
      manifest: manifest("1.0.0"),
      artifactBytes: "exact bundled SLP bytes",
      contribution: { marker: "v1" },
    });

    expect(generation.owner).toEqual({
      kind: "plugin",
      pluginId: "slp",
      generationDigest: createHash("sha256").update("exact bundled SLP bytes").digest("hex"),
      policyVersion: "1.0.0",
    });
  });

  test("pins old agents while a newer generation becomes active", async () => {
    const registry = new BundledPolicyPackRegistry<{ marker: string }>();
    const first = await registry.installAndActivateCandidate(async () => ({
      manifest: manifest("1.0.0"),
      artifactBytes: "generation one",
      contribution: { marker: "v1" },
    }));
    const second = await registry.installAndActivateCandidate(async () => ({
      manifest: manifest("2.0.0"),
      artifactBytes: "generation two",
      contribution: { marker: "v2" },
    }));

    expect(registry.resolveActive("slp").owner).toEqual(second.owner);
    expect(registry.resolvePinned(first.owner).contribution.marker).toBe("v1");
    expect(registry.resolvePinned(second.owner).contribution.marker).toBe("v2");
  });

  test("keeps the active generation when a candidate fails to load", async () => {
    const registry = new BundledPolicyPackRegistry<{ marker: string }>();
    const first = await registry.installAndActivateCandidate(async () => ({
      manifest: manifest("1.0.0"),
      artifactBytes: "stable generation",
      contribution: { marker: "stable" },
    }));

    await expect(
      registry.installAndActivateCandidate(async () => {
        throw new Error("candidate failed validation");
      }),
    ).rejects.toThrow("candidate failed validation");
    expect(registry.resolveActive("slp").owner).toEqual(first.owner);
  });

  test("fails closed for missing generations and reserves the SLP local-plugin ID", () => {
    const registry = new BundledPolicyPackRegistry<unknown>();
    expect(() => registry.resolveActive("slp")).toThrow(BUNDLED_POLICY_PACK_MISSING_ERROR);
    expect(() =>
      registry.resolvePinned({
        kind: "plugin",
        pluginId: "slp",
        generationDigest: "a".repeat(64),
        policyVersion: "1.0.0",
      }),
    ).toThrow(BUNDLED_POLICY_PACK_MISSING_ERROR);
    expect(() => assertLocalPluginIdAvailable("slp")).toThrow(
      BUNDLED_POLICY_PACK_RESERVED_ID_ERROR,
    );
    expect(() => assertLocalPluginIdAvailable("my-local-plugin")).not.toThrow();
  });

  test("preserves a bundled load failure without falling back to legacy core", () => {
    const registry = new BundledPolicyPackRegistry<unknown>();
    registry.recordLoadFailure("slp", new Error("invalid bundled artifact"));

    expect(() => registry.resolveActive("slp")).toThrow(BUNDLED_POLICY_PACK_UNAVAILABLE_ERROR);
    expect(() => registry.resolveActive("slp")).toThrow("invalid bundled artifact");
  });
});
