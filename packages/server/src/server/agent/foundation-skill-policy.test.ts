import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  claudeMandatoryFoundationSkillDenyRules,
  filterFoundationSkills,
  loadFoundationSkillPolicy,
  mergeClaudeMandatoryFoundationPlugins,
  mergeCodexFoundationSkillConfig,
} from "./foundation-skill-policy.js";

const temporaryRoots: string[] = [];

function manifestPath(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-foundation-skills-"));
  temporaryRoots.push(root);
  const target = path.join(root, "skills", "role-bundles.json");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    `${JSON.stringify({
      schemaVersion: 1,
      packages: {
        "frontend-design": {},
        "paseo-supervisor": {},
        "repo-refresh": {},
      },
      roles: {
        lead: {
          active: [],
          explicitOnly: ["repo-refresh"],
          packagedDisabled: [],
        },
        peer: {
          active: ["frontend-design"],
          explicitOnly: [],
          packagedDisabled: [],
        },
        supervisor: {
          active: ["paseo-supervisor"],
          explicitOnly: [],
          packagedDisabled: [],
        },
      },
    })}\n`,
  );
  for (const name of ["frontend-design", "paseo-supervisor", "repo-refresh"]) {
    const skillDirectory = path.join(root, "skills", name);
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(path.join(skillDirectory, "SKILL.md"), `# ${name}\n`);
  }
  return target;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Foundation skill policy", () => {
  test("admits the imported mandatory Beads tracker to every Paseo role", () => {
    const importedManifest = path.resolve(
      import.meta.dirname,
      "../../../../../foundation/dist/skills/role-bundles.json",
    );
    for (const role of ["lead", "peer", "supervisor"] as const) {
      expect(loadFoundationSkillPolicy(role, importedManifest).enabledNames).toContain(
        "beads-issue-tracker",
      );
    }
  });

  test("loads exact active and explicit-only role admission", () => {
    const source = manifestPath();
    expect([...loadFoundationSkillPolicy("lead", source).enabledNames]).toEqual(["repo-refresh"]);
    expect([...loadFoundationSkillPolicy("peer", source).enabledNames]).toEqual([
      "frontend-design",
    ]);
    expect([...loadFoundationSkillPolicy("supervisor", source).enabledNames]).toEqual([
      "paseo-supervisor",
    ]);
  });

  test("fails closed when the manifest is missing", () => {
    const policy = loadFoundationSkillPolicy("peer", "/missing/role-bundles.json");
    expect(policy.status).toBe("missing-or-invalid");
    expect(policy.enabledNames.size).toBe(0);
    expect(policy.packageNames).toContain("beads-issue-tracker");
    expect(policy.packageNames).toContain("paseo-supervisor");
    expect(policy.packageNames).toContain("triple-review");
    expect(policy.packageNames).toContain("ultra-review");
  });

  test("replaces only Foundation entries in Codex skills.config", () => {
    const policy = loadFoundationSkillPolicy("peer", manifestPath());
    const merged = mergeCodexFoundationSkillConfig(
      [
        { path: "/home/test/.codex/skills/repo-refresh/SKILL.md", enabled: true },
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
      path: path.join("/home/test/.codex", "skills", "frontend-design", "SKILL.md"),
      enabled: false,
    });
    expect(merged).toContainEqual({
      path: path.join("/home/test/.codex", "skills", "repo-refresh", "SKILL.md"),
      enabled: false,
    });
    expect(merged).toContainEqual({
      path: policy.skillPaths.get("frontend-design"),
      enabled: true,
    });
  });

  test("filters only non-owning Foundation skills from UI inventory", () => {
    const policy = loadFoundationSkillPolicy("peer", manifestPath());
    expect(
      filterFoundationSkills(
        [{ name: "frontend-design" }, { name: "paseo-supervisor" }, { name: "third-party-skill" }],
        policy,
      ),
    ).toEqual([{ name: "frontend-design" }, { name: "third-party-skill" }]);
  });

  test("projects the canonical mandatory tracker into Claude and replaces stale copies", () => {
    const importedManifest = path.resolve(
      import.meta.dirname,
      "../../../../../foundation/dist/skills/role-bundles.json",
    );
    const policy = loadFoundationSkillPolicy("peer", importedManifest);
    const merged = mergeClaudeMandatoryFoundationPlugins(
      [
        {
          type: "local",
          path: "/stale/skills/beads-issue-tracker",
        },
        { type: "local", path: "/custom/plugins/local-review" },
      ],
      policy,
    );

    expect(merged).toEqual([
      { type: "local", path: "/custom/plugins/local-review" },
      {
        type: "local",
        path: path.dirname(policy.skillPaths.get("beads-issue-tracker")!),
        skipMcpDiscovery: true,
      },
    ]);
    expect(claudeMandatoryFoundationSkillDenyRules(policy)).toEqual([]);
  });

  test("fails closed for the mandatory Claude tracker when Foundation is invalid", () => {
    const policy = loadFoundationSkillPolicy("lead", "/missing/role-bundles.json");
    expect(mergeClaudeMandatoryFoundationPlugins(undefined, policy)).toEqual([]);
    expect(claudeMandatoryFoundationSkillDenyRules(policy)).toEqual([
      "Skill(beads-issue-tracker)",
      "Skill(beads-issue-tracker:beads-issue-tracker)",
    ]);
  });
});
