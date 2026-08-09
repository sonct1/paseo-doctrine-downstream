import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  assertFoundationExecutionProfileAuthority,
  getFoundationExecutionProfileDefinition,
} from "./foundation-execution-profiles.js";

describe("private Foundation execution profiles", () => {
  test("defines a provider-neutral review specialization under Peer authority", () => {
    const profile = getFoundationExecutionProfileDefinition("review");

    expect(profile).toMatchObject({
      id: "review",
      version: "1.0.0-foundation",
      authorityRoleId: "peer",
      foundationSkills: "none",
    });
    expect(profile).not.toHaveProperty("providerId");
    expect(profile).not.toHaveProperty("providerFamily");
    expect(profile).not.toHaveProperty("model");
    expect(profile).not.toHaveProperty("thinkingOptionId");
    expect(profile).not.toHaveProperty("modeId");
    expect(profile.instructions).toContain("OCR-delegated exhaustive review");
    expect(profile.instructions).toContain("ocr delegate preview");
    expect(profile.instructions).toContain("ocr delegate rule");
    expect(profile.instructions).toContain("Never run `ocr review`");
    expect(profile.instructions).toContain("does not create a new authority tier");
    expect(profile.instructions).toContain("STALE_CANDIDATE");
    expect(profile.instructions).toContain("Keep OpenCodeReview, OCR, the `ocr` executable");
    expect(profile.instructions).toContain(
      "do not name or expose them in the ordinary Lead handback",
    );
    expect(profile.instructions).toContain("Lead alone owns convergence");
    expect(createHash("sha256").update(profile.instructions).digest("hex")).toBe(
      "cdcb7523d28963b38cc32631ddd60fa436ad81f553765e638ace767418bf7717",
    );
  });

  test("constrains authority without constraining the provider route", () => {
    expect(() =>
      assertFoundationExecutionProfileAuthority({ profileId: "review", roleId: "peer" }),
    ).not.toThrow();
    expect(() =>
      assertFoundationExecutionProfileAuthority({ profileId: "review", roleId: "lead" }),
    ).toThrow("requires role 'peer'");
  });
});
