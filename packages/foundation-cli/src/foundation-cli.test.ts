import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { doctorFoundation } from "./doctor.js";
import { inspectMachine } from "./inspection.js";
import { applyInstallPlan, uninstallFoundation } from "./install.js";
import { resolveInstallLayout, resolveProductLayout } from "./layout.js";
import { createInstallPlan } from "./plan.js";
import type { InstallPlan } from "./schema.js";

const temporaryHomes: string[] = [];

function temporaryHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "paseo-foundation-test-"));
  temporaryHomes.push(home);
  return home;
}

function productRoot(): string {
  return resolveProductLayout().productRoot;
}

function resignPlan(plan: Omit<InstallPlan, "planId">): InstallPlan {
  return {
    ...plan,
    planId: createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
  };
}

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("Foundation host inspection", () => {
  it("reports provider metadata without returning credential values", () => {
    const home = temporaryHome();
    const paseoHome = path.join(home, ".paseo");
    mkdirSync(paseoHome, { recursive: true });
    writeFileSync(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        agents: {
          providers: {
            "codex-proxy": {
              enabled: true,
              command: ["codex"],
              env: {
                OPENAI_API_KEY: "super-secret-value",
                OPENAI_BASE_URL: "https://proxy.invalid/v1",
              },
            },
          },
        },
      }),
    );

    const inspection = inspectMachine({
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });

    expect(inspection.providers).toEqual([
      {
        id: "codex-proxy",
        enabled: true,
        hasCustomCommand: true,
        envKeys: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
      },
    ]);
    expect(JSON.stringify(inspection)).not.toContain("super-secret-value");
  });

  it("classifies old Foundation symlinks as migratable", () => {
    const home = temporaryHome();
    const legacyTarget = path.join(home, "old", "paseo-foundation", "lead.config.toml");
    const linkPath = path.join(home, ".codex", "lead.config.toml");
    mkdirSync(path.dirname(linkPath), { recursive: true });
    symlinkSync(legacyTarget, linkPath);

    const plan = createInstallPlan({
      mode: "migration",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });

    expect(plan.links.find((link) => link.target === linkPath)?.state).toBe("legacy-owned");
    expect(plan.blockers).toEqual([]);
  });
});

describe.runIf(process.platform === "darwin")("Foundation install lifecycle", () => {
  it("installs atomically and uninstalls links while preserving user data", () => {
    const home = temporaryHome();
    const plan = createInstallPlan({
      mode: "clean-empty",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });
    expect(plan.blockers).toEqual([]);

    const applied = applyInstallPlan(plan);
    const layout = resolveInstallLayout({ home, distributionVersion: plan.distributionVersion });
    expect(applied.record.status).toBe("active");
    expect(lstatSync(layout.currentLink).isSymbolicLink()).toBe(true);
    expect(path.resolve(path.dirname(layout.currentLink), readlinkSync(layout.currentLink))).toBe(
      layout.releasePath,
    );
    expect(existsSync(path.join(layout.releasePath, ".foundation-manifest.json"))).toBe(true);
    expect(existsSync(path.join(layout.controlHome, "PROJECT_INDEX.yaml"))).toBe(true);
    expect(statSync(layout.installRecordPath).mode & 0o777).toBe(0o600);

    const doctor = doctorFoundation({ home, productRoot: productRoot() });
    expect(doctor.gates.find((gate) => gate.name === "DISTRIBUTION_VALID")?.status).toBe("PASS");
    expect(doctor.gates.find((gate) => gate.name === "RUNTIME_EFFECTIVE")?.status).toBe("FAIL");
    expect(doctor.gates.find((gate) => gate.name === "ROLE_BOUNDARY_QUALIFIED")?.status).toBe(
      "UNKNOWN",
    );

    const uninstalled = uninstallFoundation(home);
    expect(uninstalled.status).toBe("uninstalled");
    expect(existsSync(layout.currentLink)).toBe(false);
    expect(existsSync(layout.releasePath)).toBe(true);
    expect(existsSync(layout.controlHome)).toBe(true);
  });

  it("refuses a foreign target without partial mutation", () => {
    const home = temporaryHome();
    const foreignPath = path.join(home, ".codex", "lead.config.toml");
    mkdirSync(path.dirname(foreignPath), { recursive: true });
    writeFileSync(foreignPath, "user-owned\n");
    const plan = createInstallPlan({
      mode: "clean-empty",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });
    const layout = resolveInstallLayout({ home, distributionVersion: plan.distributionVersion });

    expect(plan.blockers).toContain(`${foreignPath} is foreign`);
    expect(() => applyInstallPlan(plan)).toThrow("install plan is blocked");
    expect(readFileSync(foreignPath, "utf8")).toBe("user-owned\n");
    expect(existsSync(layout.releasePath)).toBe(false);
    expect(existsSync(layout.controlHome)).toBe(false);
  });

  it("rejects a correctly signed plan with non-canonical link targets", () => {
    const home = temporaryHome();
    const original = createInstallPlan({
      mode: "clean-empty",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });
    const { planId: _planId, ...withoutPlanId } = original;
    const foreignTarget = path.join(home, "foreign", "lead.config.toml");
    const forgedLinks = [...original.links];
    Object.assign(forgedLinks[0]!, { target: foreignTarget });
    const forged = resignPlan({
      ...withoutPlanId,
      links: forgedLinks,
    });

    expect(() => applyInstallPlan(forged)).toThrow(
      "does not match current canonical machine targets",
    );
    expect(existsSync(foreignTarget)).toBe(false);
  });

  it("rejects a tampered install record before uninstalling links", () => {
    const home = temporaryHome();
    const plan = createInstallPlan({
      mode: "clean-empty",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });
    const applied = applyInstallPlan(plan);
    const layout = resolveInstallLayout({ home, distributionVersion: plan.distributionVersion });
    const foreignTarget = path.join(home, "foreign-owned-link");
    symlinkSync(applied.record.installedLinks[0]!.source, foreignTarget);
    const tamperedRecord = {
      ...applied.record,
      installedLinks: [
        { ...applied.record.installedLinks[0]!, target: foreignTarget },
        ...applied.record.installedLinks.slice(1),
      ],
    };
    writeFileSync(layout.installRecordPath, `${JSON.stringify(tamperedRecord, null, 2)}\n`);

    expect(() => uninstallFoundation(home)).toThrow("outside the canonical Foundation layout");
    expect(lstatSync(foreignTarget).isSymbolicLink()).toBe(true);
  });
});
