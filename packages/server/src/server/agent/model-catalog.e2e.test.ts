import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";

import type { AgentModelDefinition } from "./agent-sdk-types.js";
import { createDaemonTestContext } from "../test-utils/index.js";

function isBinaryInstalled(binary: string): boolean {
  try {
    const out = execFileSync("which", [binary], { encoding: "utf8" }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

const hasCodex = isBinaryInstalled("codex");

function modelMatchesFamily(model: AgentModelDefinition, family: "sonnet" | "haiku"): boolean {
  const haystacks = [model.id, model.label, model.description ?? ""].map((value) =>
    value.toLowerCase(),
  );
  return haystacks.some((text) => text.includes(family));
}

describe("provider model catalogs (e2e)", () => {
  test("Claude catalog exposes Sonnet and Haiku variants", async () => {
    const ctx = await createDaemonTestContext();
    try {
      const result = await ctx.client.listProviderModels("claude");

      expect(result.error).toBeNull();
      expect(result.models.length).toBeGreaterThan(0);

      expect(result.models.some((model) => modelMatchesFamily(model, "sonnet"))).toBe(true);
      expect(result.models.some((model) => modelMatchesFamily(model, "haiku"))).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  }, 180_000);

  test.runIf(hasCodex)(
    "Codex catalog exposes normalized models",
    async () => {
      const ctx = await createDaemonTestContext();
      try {
        const result = await ctx.client.listProviderModels("codex");

        expect(result.error).toBeNull();
        expect(result.models.length).toBeGreaterThan(0);
        expect(result.models).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              provider: "codex",
              id: expect.any(String),
              label: expect.any(String),
            }),
          ]),
        );
      } finally {
        await ctx.cleanup();
      }
    },
    180_000,
  );

  test("OpenCode catalog stays disabled by the Product support policy", async () => {
    const ctx = await createDaemonTestContext();
    try {
      const result = await ctx.client.listProviderModels("opencode");

      expect(result.error).toBe("Provider opencode is disabled");
      expect(result.models).toBeUndefined();
    } finally {
      await ctx.cleanup();
    }
  });
});
