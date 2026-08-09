import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  claudeProductSkillDenyRules,
  filterProductSkills,
  loadProductSkillPolicy,
  mergeClaudeProductPlugins,
  mergeCodexProductSkillConfig,
} from "./product-skill-policy.js";

const temporaryRoots: string[] = [];

function bundleRoot(manifestOverride?: unknown): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-product-skills-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "council"), { recursive: true });
  writeFileSync(path.join(root, "council", "SKILL.md"), "---\nname: council\n---\n");
  writeFileSync(
    path.join(root, "role-admission.json"),
    `${JSON.stringify(
      manifestOverride ?? {
        schemaVersion: 1,
        packages: { council: { provenance: "DEMONTHORN_EXACT" } },
        roles: {
          lead: { active: ["council"], explicitOnly: [], packagedDisabled: [] },
          peer: { active: [], explicitOnly: [], packagedDisabled: ["council"] },
          supervisor: { active: [], explicitOnly: [], packagedDisabled: ["council"] },
        },
      },
    )}\n`,
  );
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("product role skill policy", () => {
  test("admits Council only to Lead from one canonical manifest", () => {
    const root = bundleRoot();
    const lead = loadProductSkillPolicy("lead", root);
    const peer = loadProductSkillPolicy("peer", root);
    const supervisor = loadProductSkillPolicy("supervisor", root);

    expect(lead.status).toBe("bound");
    expect([...lead.enabledNames]).toEqual(["council"]);
    expect(peer.enabledNames.size).toBe(0);
    expect(supervisor.enabledNames.size).toBe(0);
    expect(lead.skillPaths.get("council")).toBe(path.join(root, "council", "SKILL.md"));
  });

  test("fails closed when a role does not classify every package exactly once", () => {
    const root = bundleRoot({
      schemaVersion: 1,
      packages: { council: {} },
      roles: {
        lead: { active: ["council"], explicitOnly: ["council"], packagedDisabled: [] },
        peer: { active: [], explicitOnly: [], packagedDisabled: ["council"] },
        supervisor: { active: [], explicitOnly: [], packagedDisabled: ["council"] },
      },
    });

    const policy = loadProductSkillPolicy("lead", root);
    expect(policy.status).toBe("missing-or-invalid");
    expect(policy.enabledNames.size).toBe(0);
    expect(policy.packageNames).toContain("council");
  });

  test("Codex disables stale Council copies and enables only the bundled Lead copy", () => {
    const root = bundleRoot();
    const policy = loadProductSkillPolicy("lead", root);
    const merged = mergeCodexProductSkillConfig(
      [
        { path: "/custom/skills/council/SKILL.md", enabled: true },
        { path: "/custom/skills/local-review/SKILL.md", enabled: true },
      ],
      policy,
      "/home/test/.codex",
    );

    expect(merged).toContainEqual({
      path: "/custom/skills/local-review/SKILL.md",
      enabled: true,
    });
    expect(merged).toContainEqual({
      path: "/custom/skills/council/SKILL.md",
      enabled: false,
    });
    expect(merged).toContainEqual({
      path: path.join(root, "council", "SKILL.md"),
      enabled: true,
    });
  });

  test("Codex keeps Council disabled for Peer even if a caller enabled it", () => {
    const root = bundleRoot();
    const policy = loadProductSkillPolicy("peer", root);
    const merged = mergeCodexProductSkillConfig(
      [{ path: "/home/test/.codex/skills/council/SKILL.md", enabled: true }],
      policy,
      "/home/test/.codex",
    );

    expect(merged.filter((entry) => typeof entry === "object" && entry !== null)).toEqual(
      expect.arrayContaining([
        { path: "/home/test/.codex/skills/council/SKILL.md", enabled: false },
        { path: path.join(root, "council", "SKILL.md"), enabled: false },
      ]),
    );
    expect(merged).not.toContainEqual(expect.objectContaining({ enabled: true }));
  });

  test("Claude projects a session-local Lead plugin and strips it from Peer", () => {
    const root = bundleRoot();
    const existing = [
      { type: "local" as const, path: "/custom/council" },
      { type: "local" as const, path: "/custom/other-plugin" },
    ];

    expect(mergeClaudeProductPlugins(existing, loadProductSkillPolicy("lead", root))).toEqual([
      { type: "local", path: "/custom/other-plugin" },
      { type: "local", path: path.join(root, "council"), skipMcpDiscovery: true },
    ]);
    const peer = loadProductSkillPolicy("peer", root);
    expect(mergeClaudeProductPlugins(existing, peer)).toEqual([
      { type: "local", path: "/custom/other-plugin" },
    ]);
    expect(claudeProductSkillDenyRules(peer)).toEqual(["Skill(council)", "Skill(council:council)"]);
  });

  test("filters plain and namespaced Council commands for non-owning roles", () => {
    const root = bundleRoot();
    const inventory = [{ name: "council" }, { name: "council:council" }, { name: "third-party" }];

    expect(filterProductSkills(inventory, loadProductSkillPolicy("lead", root))).toEqual(inventory);
    expect(filterProductSkills(inventory, loadProductSkillPolicy("peer", root))).toEqual([
      { name: "third-party" },
    ]);
  });
});
