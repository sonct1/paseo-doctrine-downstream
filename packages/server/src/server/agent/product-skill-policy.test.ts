import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const manifest =
    manifestOverride ??
    ({
      schemaVersion: 1,
      packages: { council: { provenance: "DEMONTHORN_EXACT" } },
      roles: {
        lead: { active: ["council"], explicitOnly: [], packagedDisabled: [] },
        peer: { active: [], explicitOnly: [], packagedDisabled: ["council"] },
        supervisor: { active: [], explicitOnly: [], packagedDisabled: ["council"] },
      },
    } as const);
  const packageNames =
    manifest && typeof manifest === "object" && "packages" in manifest
      ? Object.keys((manifest as { packages: Record<string, unknown> }).packages)
      : ["council"];
  for (const name of packageNames) {
    mkdirSync(path.join(root, name), { recursive: true });
    writeFileSync(path.join(root, name, "SKILL.md"), `---\nname: ${name}\n---\n`);
  }
  writeFileSync(path.join(root, "role-admission.json"), `${JSON.stringify(manifest)}\n`);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("product role skill policy", () => {
  test("pins every Council seat to a fresh read-only Peer assignment", () => {
    const councilSkill = readFileSync(
      path.resolve(import.meta.dirname, "../../../../../skills/council/SKILL.md"),
      "utf8",
    );
    const admission = JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, "../../../../../skills/role-admission.json"),
        "utf8",
      ),
    ) as { packages: { council: { provenance: string } } };

    expect(admission.packages.council.provenance).toBe("PASEO_DERIVATIVE");
    expect(councilSkill).toContain("disposition: independent-review");
    expect(councilSkill).toContain("effectClass: read-only");
    expect(councilSkill).toContain("mutationBoundary:\n    mode: no-write");
    expect(councilSkill).toContain("externalEffectBoundary:\n    mode: denied");
    expect(councilSkill).toContain("council.integrity: pending-lead-audit");
    expect(councilSkill).toContain("council.integrity=valid-audited-report");
    expect(councilSkill).toContain(
      "terminal status or a plausible-looking report alone is\n   never enough to set `valid`",
    );
    expect(councilSkill).toContain(
      "Never omit it, copy the Lead assignment, or reuse the Lead's `delegation` effect",
    );
  });

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

  test("admits the native Beads skill to every role while Council stays Lead-only", () => {
    const root = bundleRoot({
      schemaVersion: 1,
      packages: { council: {}, "beads-issue-tracker": {} },
      roles: {
        lead: {
          active: ["council", "beads-issue-tracker"],
          explicitOnly: [],
          packagedDisabled: [],
        },
        peer: {
          active: ["beads-issue-tracker"],
          explicitOnly: [],
          packagedDisabled: ["council"],
        },
        supervisor: {
          active: ["beads-issue-tracker"],
          explicitOnly: [],
          packagedDisabled: ["council"],
        },
      },
    });

    expect([...loadProductSkillPolicy("lead", root).enabledNames]).toEqual([
      "council",
      "beads-issue-tracker",
    ]);
    for (const role of ["peer", "supervisor"] as const) {
      const policy = loadProductSkillPolicy(role, root);
      expect([...policy.enabledNames]).toEqual(["beads-issue-tracker"]);
      expect(claudeProductSkillDenyRules(policy)).toEqual([
        "Skill(council)",
        "Skill(council:council)",
      ]);
    }
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
