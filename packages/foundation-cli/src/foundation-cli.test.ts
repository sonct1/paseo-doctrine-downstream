import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { doctorFoundation, inspectProjectReadiness } from "./doctor.js";
import { inspectMachine } from "./inspection.js";
import {
  applyInstallPlan,
  recoverInterruptedInstall,
  rollbackInstall,
  uninstallFoundation,
} from "./install.js";
import {
  FOUNDATION_SKILL_NAMES,
  resolveInstallLayout,
  resolveProductLayout,
  legacyRoleLinks,
} from "./layout.js";
import { createInstallPlan, readInstallPlan } from "./plan.js";
import { inspectAuditRoute, inspectRoleBoundaryReceipt } from "./qualification.js";
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

function materializeLegacySupervisorSkill(releasePath: string): void {
  const skillRoot = path.join(releasePath, "skills", "paseo-supervisor");
  mkdirSync(skillRoot, { recursive: true });
  writeFileSync(path.join(skillRoot, "SKILL.md"), "---\nname: paseo-supervisor\n---\n");
}

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("Foundation role links", () => {
  it("projects every allowlisted skill package from the selected distribution", () => {
    const home = temporaryHome();
    const inventoryRoot = path.join(home, "inventory");
    const releasePath = path.join(home, "release");
    for (const name of FOUNDATION_SKILL_NAMES) {
      const skillRoot = path.join(inventoryRoot, "skills", name);
      mkdirSync(skillRoot, { recursive: true });
      writeFileSync(path.join(skillRoot, "SKILL.md"), `---\nname: ${name}\n---\n`);
    }

    const skillTargets = legacyRoleLinks({ home, releasePath, skillInventoryRoot: inventoryRoot })
      .map(({ target }) => target)
      .filter((target) => path.dirname(target) === path.join(home, ".codex", "skills"));

    expect(skillTargets.map((target) => path.basename(target))).toEqual(
      [...FOUNDATION_SKILL_NAMES].sort(),
    );
  });

  it("rejects an unowned skill package in the immutable distribution", () => {
    const home = temporaryHome();
    const inventoryRoot = path.join(home, "inventory");
    const skillRoot = path.join(inventoryRoot, "skills", "foreign-skill");
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(path.join(skillRoot, "SKILL.md"), "---\nname: foreign-skill\n---\n");

    expect(() =>
      legacyRoleLinks({
        home,
        releasePath: path.join(home, "release"),
        skillInventoryRoot: inventoryRoot,
      }),
    ).toThrow("unexpected Foundation skill package: foreign-skill");
  });
});

describe("Foundation host inspection", () => {
  it("does not invoke daemon status or create Paseo state in a clean home", () => {
    const home = temporaryHome();
    const fakeBin = path.join(home, "fake-bin");
    const marker = path.join(home, "status-was-called");
    const paseo = path.join(fakeBin, "paseo");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      paseo,
      `#!/bin/sh\nif [ "$1" = "daemon" ]; then touch '${marker}'; fi\necho 'paseo fake'\n`,
      { mode: 0o755 },
    );

    const inspection = inspectMachine({
      home,
      productRoot: productRoot(),
      environmentPath: fakeBin,
      platform: "darwin",
    });

    expect(inspection.paseoDaemonReachable).toBe(false);
    expect(inspection.paseoDaemonEvidence).toContain(
      `${path.join(home, ".paseo/config.json")}: missing`,
    );
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(path.join(home, ".paseo"))).toBe(false);
  });

  it("requires an exact local daemon identity readback", () => {
    const home = temporaryHome();
    const paseoHome = path.join(home, ".paseo");
    const fakeBin = path.join(home, "fake-bin");
    const paseo = path.join(fakeBin, "paseo");
    const listen = "127.0.0.1:19767";
    const serverId = "server-test-exact";
    const status = JSON.stringify({
      localDaemon: "running",
      connectedDaemon: "reachable",
      connectedServerId: serverId,
      connectedPid: process.pid,
      connectedListen: listen,
      serverId,
      pid: process.pid,
      home: paseoHome,
      listen,
      daemonVersion: "0.3.0-test",
      startedAt: "2026-08-16T00:00:00.000Z",
      sourceCommit: "1".repeat(40),
      sourceFingerprint: "2".repeat(64),
      providers: [{ label: "codex-test", path: "available" }],
    });
    mkdirSync(paseoHome, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(path.join(paseoHome, "config.json"), "{}\n");
    writeFileSync(path.join(paseoHome, "server-id"), `${serverId}\n`);
    writeFileSync(
      path.join(paseoHome, "paseo.pid"),
      `${JSON.stringify({ pid: process.pid, listen })}\n`,
    );
    writeFileSync(
      paseo,
      `#!/bin/sh\nif [ "$1" = "daemon" ]; then printf '%s\\n' '${status}'; else echo 'paseo fake'; fi\n`,
      { mode: 0o755 },
    );

    const inspection = inspectMachine({
      home,
      productRoot: productRoot(),
      environmentPath: fakeBin,
      platform: "darwin",
    });

    expect(inspection.paseoDaemonReachable).toBe(true);
    expect(inspection.paseoDaemonEvidence).toEqual([
      `serverId=${serverId}`,
      `pid=${process.pid}`,
      "version=0.3.0-test",
    ]);
    expect(inspection.paseoDaemonIdentity).toEqual({
      serverId,
      pid: process.pid,
      version: "0.3.0-test",
      startedAt: "2026-08-16T00:00:00.000Z",
      sourceCommit: "1".repeat(40),
      sourceFingerprint: "2".repeat(64),
      availableProviders: ["codex-test"],
    });

    const mismatchedStatus = JSON.stringify({
      ...(JSON.parse(status) as Record<string, unknown>),
      connectedServerId: "different-live-daemon",
    });
    writeFileSync(
      paseo,
      `#!/bin/sh\nif [ "$1" = "daemon" ]; then printf '%s\\n' '${mismatchedStatus}'; else echo 'paseo fake'; fi\n`,
      { mode: 0o755 },
    );
    const mismatch = inspectMachine({
      home,
      productRoot: productRoot(),
      environmentPath: fakeBin,
      platform: "darwin",
    });
    expect(mismatch.paseoDaemonReachable).toBe(false);
    expect(mismatch.paseoDaemonEvidence).toContain(
      "connected daemon server ID does not match the local server ID",
    );
  });

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

describe("Foundation project readiness", () => {
  it("treats an absent protocol as zero-delta and rejects present-invalid bytes", () => {
    const projectRoot = temporaryHome();

    expect(inspectProjectReadiness(projectRoot)).toEqual({
      name: "PROJECT_READY",
      status: "UNKNOWN",
      evidence: [
        "WORKSPACE_PROTOCOL.md is absent zero-delta; project activation and task evidence are not proven",
      ],
    });

    writeFileSync(path.join(projectRoot, "WORKSPACE_PROTOCOL.md"), "# Workspace Protocol\n");
    expect(inspectProjectReadiness(projectRoot).status).toBe("FAIL");

    writeFileSync(
      path.join(projectRoot, "WORKSPACE_PROTOCOL.md"),
      "# Workspace Protocol\n\n<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: 99 -->\n\n- identity: owner Human\n- issue tracker: opaque versioned contract\n",
    );
    expect(inspectProjectReadiness(projectRoot).status).toBe("UNKNOWN");
  });
});

describe("Foundation runtime qualification receipts", () => {
  const daemonIdentity = {
    serverId: "srv_test",
    pid: process.pid,
    version: "0.4.0-test",
    startedAt: "2026-08-16T00:00:00.000Z",
    sourceCommit: "1".repeat(40),
    sourceFingerprint: "2".repeat(64),
    availableProviders: ["codex-zetscan"],
  };

  it("distinguishes a current audit route from a stale daemon-version receipt", () => {
    const home = temporaryHome();
    const paseoHome = path.join(home, ".paseo");
    const apiKey = "test-api-key";
    const target = (daemonVersion: string) =>
      createHash("sha256")
        .update(
          JSON.stringify({
            schemaVersion: 1,
            daemonVersion,
            provider: "codex-zetscan",
            model: "gpt-5.6-sol",
            baseUrl: "https://example.invalid/v1",
            credentialRef: "codex-zetscan",
            credentialDigest: createHash("sha256").update(apiKey).digest("hex"),
          }),
        )
        .digest("hex");
    mkdirSync(paseoHome, { recursive: true });
    writeFileSync(
      path.join(paseoHome, "orchestration-preferences.json"),
      JSON.stringify({ providers: { audit: "codex-zetscan/gpt-5.6-sol" } }),
    );
    writeFileSync(
      path.join(paseoHome, "config.json"),
      JSON.stringify({
        agents: {
          providers: {
            "codex-zetscan": {
              enabled: true,
              extends: "codex",
              credentialRef: "codex-zetscan",
              env: { OPENAI_BASE_URL: "https://example.invalid/v1" },
              additionalModels: [{ id: "gpt-5.6-sol" }],
            },
          },
          credentials: { "codex-zetscan": { OPENAI_API_KEY: apiKey } },
        },
      }),
    );
    const receiptPath = path.join(paseoHome, "provider-connection-qualifications.json");
    const writeReceipt = (daemonVersion: string) =>
      writeFileSync(
        receiptPath,
        JSON.stringify({
          schemaVersion: 1,
          receipts: {
            "codex-zetscan": {
              provider: "codex-zetscan",
              model: "gpt-5.6-sol",
              fingerprint: target(daemonVersion),
              qualifiedAt: "2026-08-16T00:01:00.000Z",
              latencyMs: 12,
            },
          },
        }),
      );

    writeReceipt("0.3.1-old");
    expect(inspectAuditRoute({ home, daemonIdentity }).status).toBe("UNKNOWN");
    writeReceipt(daemonIdentity.version);
    expect(inspectAuditRoute({ home, daemonIdentity })).toMatchObject({
      status: "PASS",
      route: { provider: "codex-zetscan", model: "gpt-5.6-sol" },
    });
  });

  it("accepts only a complete canary receipt bound to current Foundation and daemon bytes", () => {
    const home = temporaryHome();
    const releasePath = path.join(productRoot(), "foundation", "dist");
    const manifest = JSON.parse(
      readFileSync(path.join(productRoot(), "foundation", "manifest.json"), "utf8"),
    ) as { distributionVersion: string; foundationSource: { commit: string } };
    const definitionsPath = path.join(releasePath, "profiles", "native", "role-definitions.json");
    const bundlesPath = path.join(releasePath, "skills", "role-bundles.json");
    const definitions = JSON.parse(readFileSync(definitionsPath, "utf8")) as {
      universalBlocks: string[];
      roles: Record<string, string[]>;
    };
    const definitionDigest = (roleId: string) =>
      createHash("sha256")
        .update(
          `${definitions.universalBlocks.join("\n\n")}\n\n${definitions.roles[roleId]!.join("\n\n")}`,
        )
        .digest("hex");
    const qualifiedAt = "2026-08-16T00:02:00.000Z";
    const receiptPath = path.join(home, "canary.json");
    const receipt = {
      schemaVersion: 1,
      qualifiedAt,
      foundation: {
        distributionVersion: manifest.distributionVersion,
        commit: manifest.foundationSource.commit,
        roleDefinitionsDigest: createHash("sha256")
          .update(readFileSync(definitionsPath))
          .digest("hex"),
        roleBundlesDigest: createHash("sha256").update(readFileSync(bundlesPath)).digest("hex"),
      },
      daemon: {
        serverId: daemonIdentity.serverId,
        version: daemonIdentity.version,
        startedAt: daemonIdentity.startedAt,
        sourceCommit: daemonIdentity.sourceCommit,
        sourceFingerprint: daemonIdentity.sourceFingerprint,
      },
      route: {
        provider: "codex-zetscan",
        model: "gpt-5.6-sol",
        providerConnectionQualifiedAt: "2026-08-16T00:01:00.000Z",
      },
      roles: ["lead", "peer", "supervisor"].map((roleId) => ({
        roleId,
        agentId: `agent-${roleId}`,
        workspaceId: "workspace-canary",
        provider: "codex-zetscan",
        model: "gpt-5.6-sol",
        assignmentEffect: "read-only",
        definitionDigest: definitionDigest(roleId),
        bindingDigest: createHash("sha256").update(roleId).digest("hex"),
        checks: {
          immutableRoleBinding: true,
          workspaceProtocolBound: true,
          technicalNoWrite: true,
          toolContractObserved: true,
        },
        evidence: [`${roleId} canary passed`],
      })),
    };
    writeFileSync(receiptPath, JSON.stringify(receipt));
    const auditRoute = {
      status: "PASS" as const,
      evidence: ["qualified"],
      route: {
        provider: "codex-zetscan",
        model: "gpt-5.6-sol",
        qualifiedAt: "2026-08-16T00:01:00.000Z",
      },
    };
    const inspect = (identity = daemonIdentity) =>
      inspectRoleBoundaryReceipt({
        home,
        receiptPath,
        releasePath,
        distributionVersion: manifest.distributionVersion,
        foundationCommit: manifest.foundationSource.commit,
        daemonIdentity: identity,
        auditRoute,
      });

    expect(inspect().status).toBe("PASS");
    expect(inspect({ ...daemonIdentity, sourceFingerprint: "3".repeat(64) }).status).toBe(
      "UNKNOWN",
    );
  });
});

describe("Foundation install planning", () => {
  it("does not couple the default plan to an existing Control Workspace", () => {
    const home = temporaryHome();
    const controlHome = path.join(home, ".paseo-control");
    mkdirSync(controlHome);
    writeFileSync(path.join(controlHome, "user-owned.txt"), "keep\n");

    const defaultPlan = createInstallPlan({
      mode: "clean-empty",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });
    const optInPlan = createInstallPlan({
      mode: "clean-empty",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
      includeControlWorkspace: true,
    });

    expect(defaultPlan.includeControlWorkspace).toBe(false);
    expect(defaultPlan.controlHome).toBeNull();
    expect(defaultPlan.controlHomePresent).toBeNull();
    expect(defaultPlan.blockers).not.toContain("the Control Workspace Home already exists");
    expect(optInPlan.controlHome).toBe(controlHome);
    expect(optInPlan.controlHomePresent).toBe(true);
    expect(optInPlan.blockers).toContain("the Control Workspace Home already exists");
  });

  it("rejects a version 1 plan instead of silently choosing Control Workspace semantics", () => {
    const home = temporaryHome();
    const planPath = path.join(home, "install-plan.json");
    const currentPlan = createInstallPlan({
      mode: "clean-empty",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });
    writeFileSync(planPath, `${JSON.stringify({ ...currentPlan, schemaVersion: 1 })}\n`);

    expect(() => readInstallPlan(planPath)).toThrow(
      "predates explicit Control Workspace selection",
    );
    expect(
      existsSync(
        resolveInstallLayout({ home, distributionVersion: currentPlan.distributionVersion })
          .releasePath,
      ),
    ).toBe(false);
  });
});

describe.runIf(process.platform === "darwin")("Foundation install lifecycle", () => {
  it("installs Foundation atomically without creating a Control Workspace by default", () => {
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
    expect(applied.record.controlHome).toBeNull();
    expect(applied.createdControlHome).toBe(false);
    expect(lstatSync(layout.currentLink).isSymbolicLink()).toBe(true);
    expect(path.resolve(path.dirname(layout.currentLink), readlinkSync(layout.currentLink))).toBe(
      layout.releasePath,
    );
    expect(existsSync(path.join(layout.releasePath, ".foundation-manifest.json"))).toBe(true);
    expect(existsSync(layout.controlHome)).toBe(false);
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
    for (const link of plan.links) expect(existsSync(link.target)).toBe(false);
    expect(existsSync(layout.releasePath)).toBe(true);
    expect(existsSync(layout.controlHome)).toBe(false);
  });

  it("creates and preserves a Control Workspace only after explicit opt-in", () => {
    const home = temporaryHome();
    const plan = createInstallPlan({
      mode: "clean-empty",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
      includeControlWorkspace: true,
    });

    const applied = applyInstallPlan(plan);
    const layout = resolveInstallLayout({ home, distributionVersion: plan.distributionVersion });
    expect(applied.createdControlHome).toBe(true);
    expect(applied.record.controlHome).toBe(layout.controlHome);
    expect(existsSync(path.join(layout.controlHome, "PROJECT_INDEX.yaml"))).toBe(true);

    const preservingUpdate = createInstallPlan({
      mode: "update",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });
    expect(preservingUpdate.includeControlWorkspace).toBe(true);
    expect(preservingUpdate.controlHome).toBe(layout.controlHome);
    expect(applyInstallPlan(preservingUpdate).record.controlHome).toBe(layout.controlHome);

    const explicitOptOut = createInstallPlan({
      mode: "update",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
      includeControlWorkspace: false,
    });
    expect(explicitOptOut.includeControlWorkspace).toBe(false);
    expect(applyInstallPlan(explicitOptOut).record.controlHome).toBeNull();
    expect(existsSync(path.join(layout.controlHome, "PROJECT_INDEX.yaml"))).toBe(true);

    uninstallFoundation(home);
    expect(existsSync(path.join(layout.controlHome, "PROJECT_INDEX.yaml"))).toBe(true);
  }, 15_000);

  it("refuses to uninstall a legacy migration record without its exact link snapshot", () => {
    const home = temporaryHome();
    const legacyRelease = path.join(home, "old", "paseo-foundation", "release");
    materializeLegacySupervisorSkill(legacyRelease);
    const legacyLinks = legacyRoleLinks({ home, releasePath: legacyRelease });
    const layout = resolveInstallLayout({ home, distributionVersion: "legacy" });
    mkdirSync(path.dirname(layout.currentLink), { recursive: true });
    symlinkSync(legacyRelease, layout.currentLink);
    for (const link of legacyLinks) {
      mkdirSync(path.dirname(link.target), { recursive: true });
      symlinkSync(link.source, link.target);
    }
    const plan = createInstallPlan({
      mode: "migration",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });
    const applied = applyInstallPlan(plan);
    const {
      previousCurrentTarget: _previousCurrentTarget,
      previousLinks: _previousLinks,
      ...legacy
    } = applied.record;
    writeFileSync(layout.installRecordPath, `${JSON.stringify(legacy, null, 2)}\n`, {
      mode: 0o600,
    });

    expect(() => uninstallFoundation(home)).toThrow(
      "migration install record lacks an exact previous-link snapshot",
    );
    expect(path.resolve(path.dirname(layout.currentLink), readlinkSync(layout.currentLink))).toBe(
      applied.record.releasePath,
    );
    for (const link of applied.record.installedLinks) {
      expect(path.resolve(path.dirname(link.target), readlinkSync(link.target))).toBe(link.source);
    }
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
    symlinkSync("/tmp/legacy-foundation-link", foreignTarget);
    const tamperedRecord = {
      ...applied.record,
      previousLinks: [
        { ...applied.record.previousLinks![0]!, target: foreignTarget },
        ...applied.record.previousLinks!.slice(1),
      ],
    };
    writeFileSync(layout.installRecordPath, `${JSON.stringify(tamperedRecord, null, 2)}\n`);

    expect(() => uninstallFoundation(home)).toThrow("outside the canonical Foundation layout");
    expect(lstatSync(foreignTarget).isSymbolicLink()).toBe(true);
  });

  it("recovers a recorded interrupted link activation", () => {
    const home = temporaryHome();
    const plan = createInstallPlan({
      mode: "clean-empty",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });
    const layout = resolveInstallLayout({ home, distributionVersion: plan.distributionVersion });
    mkdirSync(path.dirname(layout.transactionPath), { recursive: true });
    mkdirSync(path.dirname(plan.currentLink), { recursive: true });
    symlinkSync(plan.releasePath, plan.currentLink);
    for (const link of plan.links) {
      mkdirSync(path.dirname(link.target), { recursive: true });
      symlinkSync(link.source, link.target);
    }
    writeFileSync(
      layout.transactionPath,
      `${JSON.stringify({
        schemaVersion: 1,
        operation: "install",
        ownerPid: process.pid,
        planId: plan.planId,
        home,
        releasePath: plan.releasePath,
        releaseStagingPath: null,
        controlHome: layout.controlHome,
        controlStagingPath: null,
        controlTemplateFingerprint: null,
        currentLink: plan.currentLink,
        previousCurrentTarget: null,
        previousLinks: plan.links.map(({ target }) => ({ target, previousTarget: null })),
        installRecordPath: layout.installRecordPath,
        previousInstallRecordBase64: null,
        createdAt: new Date().toISOString(),
      })}\n`,
      { mode: 0o600 },
    );

    expect(recoverInterruptedInstall(home)).toBe(true);
    expect(existsSync(layout.transactionPath)).toBe(false);
    expect(existsSync(plan.currentLink)).toBe(false);
    for (const link of plan.links) expect(existsSync(link.target)).toBe(false);
  });

  it("fails recovery without mutation when a runtime target became foreign", () => {
    const home = temporaryHome();
    const plan = createInstallPlan({
      mode: "clean-empty",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });
    const layout = resolveInstallLayout({ home, distributionVersion: plan.distributionVersion });
    mkdirSync(path.dirname(layout.transactionPath), { recursive: true });
    mkdirSync(path.dirname(plan.currentLink), { recursive: true });
    symlinkSync(plan.releasePath, plan.currentLink);
    for (const link of plan.links) {
      mkdirSync(path.dirname(link.target), { recursive: true });
      symlinkSync(link.source, link.target);
    }
    writeFileSync(
      layout.transactionPath,
      `${JSON.stringify({
        schemaVersion: 1,
        operation: "install",
        ownerPid: process.pid,
        planId: plan.planId,
        home,
        releasePath: plan.releasePath,
        releaseStagingPath: null,
        controlHome: layout.controlHome,
        controlStagingPath: null,
        controlTemplateFingerprint: null,
        currentLink: plan.currentLink,
        previousCurrentTarget: null,
        previousLinks: plan.links.map(({ target }) => ({ target, previousTarget: null })),
        installRecordPath: layout.installRecordPath,
        previousInstallRecordBase64: null,
        createdAt: new Date().toISOString(),
      })}\n`,
      { mode: 0o600 },
    );
    const foreignTarget = plan.links[0]!.target;
    unlinkSync(foreignTarget);
    writeFileSync(foreignTarget, "user-owned\n");

    expect(() => recoverInterruptedInstall(home)).toThrow("runtime target changed");
    expect(readFileSync(foreignTarget, "utf8")).toBe("user-owned\n");
    expect(existsSync(layout.transactionPath)).toBe(true);
    expect(lstatSync(plan.currentLink).isSymbolicLink()).toBe(true);
  });

  it("cleans final paths and links after a late install failure", () => {
    const home = temporaryHome();
    const legacyRelease = path.join(home, "old", "paseo-foundation", "release");
    materializeLegacySupervisorSkill(legacyRelease);
    const legacyLinks = legacyRoleLinks({ home, releasePath: legacyRelease });
    for (const link of legacyLinks) {
      mkdirSync(path.dirname(link.target), { recursive: true });
      symlinkSync(link.source, link.target);
    }
    const plan = createInstallPlan({
      mode: "migration",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });
    const layout = resolveInstallLayout({ home, distributionVersion: plan.distributionVersion });
    const codexRoot = path.join(home, ".codex");
    chmodSync(codexRoot, 0o500);
    try {
      expect(() => applyInstallPlan(plan)).toThrow();
    } finally {
      chmodSync(codexRoot, 0o700);
    }
    expect(recoverInterruptedInstall(home)).toBe(true);

    expect(existsSync(layout.transactionPath)).toBe(false);
    expect(existsSync(layout.releasePath)).toBe(false);
    expect(existsSync(layout.controlHome)).toBe(false);
    expect(existsSync(layout.currentLink)).toBe(false);
    for (const link of plan.links) {
      if (link.previousTarget === null) {
        expect(existsSync(link.target)).toBe(false);
      } else {
        expect(path.resolve(path.dirname(link.target), readlinkSync(link.target))).toBe(
          link.previousTarget,
        );
      }
    }
  });

  it("restores every legacy target when a migration is rolled back", () => {
    const home = temporaryHome();
    const layout = resolveInstallLayout({ home, distributionVersion: "legacy" });
    const legacyRelease = path.join(home, "old", "paseo-foundation", "release");
    materializeLegacySupervisorSkill(legacyRelease);
    const legacyLinks = legacyRoleLinks({ home, releasePath: legacyRelease });
    mkdirSync(path.dirname(layout.currentLink), { recursive: true });
    symlinkSync(legacyRelease, layout.currentLink);
    for (const link of legacyLinks) {
      mkdirSync(path.dirname(link.target), { recursive: true });
      symlinkSync(link.source, link.target);
    }
    const plan = createInstallPlan({
      mode: "migration",
      home,
      productRoot: productRoot(),
      environmentPath: "",
      platform: "darwin",
    });

    const applied = applyInstallPlan(plan);
    const previousTargets = applied.record.previousLinks?.map(
      ({ previousTarget }) => previousTarget,
    );
    expect(previousTargets?.filter((target) => target !== null)).toEqual(
      legacyLinks.map(({ source }) => source),
    );
    expect(previousTargets?.filter((target) => target === null)).toHaveLength(
      plan.links.length - legacyLinks.length,
    );
    const rolledBack = rollbackInstall(home);

    expect(rolledBack.status).toBe("uninstalled");
    expect(rolledBack.rolledBackAt).toBeTruthy();
    expect(path.resolve(path.dirname(layout.currentLink), readlinkSync(layout.currentLink))).toBe(
      legacyRelease,
    );
    for (const link of legacyLinks) {
      expect(path.resolve(path.dirname(link.target), readlinkSync(link.target))).toBe(link.source);
    }
  });
});
