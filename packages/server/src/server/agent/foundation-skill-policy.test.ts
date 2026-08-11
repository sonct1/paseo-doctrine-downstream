import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  filterFoundationSkills,
  loadFoundationSkillPolicy,
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
  return target;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Foundation skill policy", () => {
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
      enabled: true,
    });
    expect(merged).toContainEqual({
      path: path.join("/home/test/.codex", "skills", "repo-refresh", "SKILL.md"),
      enabled: false,
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
});
