import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";
import { inspectMachine } from "./inspection.js";
import { resolveInstallLayout, resolveProductLayout } from "./layout.js";
import { FoundationManifestSchema } from "./schema.js";

export type GateStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface DoctorGate {
  name: "DISTRIBUTION_VALID" | "RUNTIME_EFFECTIVE" | "ROLE_BOUNDARY_QUALIFIED" | "PROJECT_READY";
  status: GateStatus;
  evidence: string[];
}

export interface DoctorReport {
  distributionVersion: string;
  foundationCommit: string;
  gates: DoctorGate[];
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function resolvedLinkTarget(linkPath: string): string | null {
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return null;
    return path.resolve(path.dirname(linkPath), readlinkSync(linkPath));
  } catch {
    return null;
  }
}

function distributionGate(releasePath: string): DoctorGate {
  const manifestPath = path.join(releasePath, ".foundation-manifest.json");
  if (!existsSync(manifestPath)) {
    return {
      name: "DISTRIBUTION_VALID",
      status: "FAIL",
      evidence: ["release manifest is missing"],
    };
  }
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const manifest = FoundationManifestSchema.parse(parsed);
  const failures: string[] = [];
  for (const file of manifest.files) {
    const filePath = path.resolve(releasePath, file.path);
    const relative = path.relative(releasePath, filePath);
    const escapesRelease = relative.startsWith("..") || path.isAbsolute(relative);
    if (escapesRelease || !existsSync(filePath) || !statSync(filePath).isFile()) {
      failures.push(`${file.path}: missing`);
      continue;
    }
    if (sha256(filePath) !== file.sha256) failures.push(`${file.path}: checksum mismatch`);
  }
  return failures.length === 0
    ? {
        name: "DISTRIBUTION_VALID",
        status: "PASS",
        evidence: [`${manifest.files.length} files match ${manifest.distributionVersion}`],
      }
    : { name: "DISTRIBUTION_VALID", status: "FAIL", evidence: failures };
}

function runtimeGate(input: {
  currentLink: string;
  releasePath: string;
  links: Array<{ source: string; target: string }>;
  retiredLinks?: Array<{ target: string }>;
  daemonReachable: boolean;
  daemonEvidence: string[];
  interruptedTransactionPresent: boolean;
}): DoctorGate {
  const failures: string[] = [];
  if (resolvedLinkTarget(input.currentLink) !== input.releasePath) {
    failures.push("current release link is not effective");
  }
  for (const link of input.links) {
    if (resolvedLinkTarget(link.target) !== link.source)
      failures.push(`${link.target}: wrong target`);
  }
  for (const link of input.retiredLinks ?? []) {
    if (existsSync(link.target)) failures.push(`${link.target}: legacy runtime link still present`);
  }
  if (input.interruptedTransactionPresent) {
    failures.push("an interrupted Foundation install transaction requires recovery");
  }
  if (!input.daemonReachable) failures.push(...input.daemonEvidence);
  return failures.length === 0
    ? {
        name: "RUNTIME_EFFECTIVE",
        status: "PASS",
        evidence: ["native distribution, retired legacy links, and exact daemon readback pass"],
      }
    : { name: "RUNTIME_EFFECTIVE", status: "FAIL", evidence: failures };
}

function roleBoundaryGate(releasePath: string): DoctorGate {
  const failures: string[] = [];
  const definitions = JSON.parse(
    readFileSync(path.join(releasePath, "profiles", "native", "role-definitions.json"), "utf8"),
  ) as Record<string, unknown>;
  const bundles = JSON.parse(
    readFileSync(path.join(releasePath, "skills", "role-bundles.json"), "utf8"),
  ) as Record<string, unknown>;
  if (definitions.schemaVersion !== 1 || bundles.schemaVersion !== 1) {
    failures.push("native role definition or role-skill manifest has an unsupported schema");
  }
  const definitionRoles = definitions.roles as Record<string, unknown> | undefined;
  const bundleRoles = bundles.roles as
    | Record<string, { active?: unknown; explicitOnly?: unknown }>
    | undefined;
  for (const role of ["lead", "peer", "supervisor"]) {
    if (!Array.isArray(definitionRoles?.[role]) || definitionRoles[role].length === 0) {
      failures.push(`${role}: native role definition is missing`);
    }
    const active = bundleRoles?.[role]?.active;
    const explicitOnly = bundleRoles?.[role]?.explicitOnly;
    const admitted = [
      ...(Array.isArray(active) ? active : []),
      ...(Array.isArray(explicitOnly) ? explicitOnly : []),
    ];
    if (
      !Array.isArray(active) ||
      !Array.isArray(explicitOnly) ||
      !admitted.every((name) => typeof name === "string") ||
      admitted.length >= 10
    ) {
      failures.push(`${role}: native role skill admission must stay below 10 packages`);
    }
  }
  if (failures.length > 0) {
    return { name: "ROLE_BOUNDARY_QUALIFIED", status: "FAIL", evidence: failures };
  }
  return {
    name: "ROLE_BOUNDARY_QUALIFIED",
    status: "UNKNOWN",
    evidence: ["native role bytes and <10 skill admission pass; fresh role/tool canary is pending"],
  };
}

function workspaceProtocolContract(productRoot?: string): Record<string, unknown> {
  const product = resolveProductLayout(productRoot);
  return JSON.parse(
    readFileSync(
      path.join(product.distributionRoot, "templates", "workspace-protocol-contract.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function hasOneNonBlankField(protocol: string, field: string): boolean {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matches = protocol.match(new RegExp(`^- ${escaped}:[ \\t]*(.*)$`, "gmu"));
  if (matches?.length !== 1) return false;
  const value = matches[0]?.slice(matches[0].indexOf(":") + 1).trim() ?? "";
  return value.replace(/^`+|`+$/gu, "").trim().length > 0;
}

export function inspectProjectReadiness(projectRoot?: string, productRoot?: string): DoctorGate {
  if (!projectRoot) {
    return {
      name: "PROJECT_READY",
      status: "UNKNOWN",
      evidence: ["no target project was supplied"],
    };
  }
  const protocolPath = path.join(path.resolve(projectRoot), "WORKSPACE_PROTOCOL.md");
  try {
    lstatSync(protocolPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        name: "PROJECT_READY",
        status: "UNKNOWN",
        evidence: [
          "WORKSPACE_PROTOCOL.md is absent zero-delta; project activation and task evidence are not proven",
        ],
      };
    }
    return {
      name: "PROJECT_READY",
      status: "FAIL",
      evidence: ["WORKSPACE_PROTOCOL.md path cannot be inspected"],
    };
  }

  try {
    if (!statSync(protocolPath).isFile()) {
      return {
        name: "PROJECT_READY",
        status: "FAIL",
        evidence: ["WORKSPACE_PROTOCOL.md is not a regular file"],
      };
    }
  } catch {
    return {
      name: "PROJECT_READY",
      status: "FAIL",
      evidence: ["WORKSPACE_PROTOCOL.md is not a readable regular file"],
    };
  }

  const protocol = readFileSync(protocolPath, "utf8");
  const contract = workspaceProtocolContract(productRoot);
  const markerPattern = new RegExp(String(contract.markerMentionPattern), "gu");
  const wellFormedMarker = new RegExp(String(contract.wellFormedMarkerPattern), "u");
  const markers = protocol.match(markerPattern) ?? [];
  const requiredFields = contract.targetRequiredFields;
  const invalid =
    !protocol.trim() ||
    Buffer.byteLength(protocol, "utf8") > Number(contract.maxBytes) ||
    !new RegExp(String(contract.titlePattern), "mu").test(protocol) ||
    new RegExp(String(contract.placeholderPattern), "u").test(protocol) ||
    ["<<<<<<<", "=======", ">>>>>>>"].some((marker) => protocol.includes(marker)) ||
    markers.length !== 1 ||
    !wellFormedMarker.test(markers[0]?.trim() ?? "") ||
    !Array.isArray(requiredFields) ||
    !requiredFields.every(
      (field) => typeof field === "string" && hasOneNonBlankField(protocol, field),
    );
  return invalid
    ? { name: "PROJECT_READY", status: "FAIL", evidence: ["workspace protocol is invalid"] }
    : {
        name: "PROJECT_READY",
        status: "UNKNOWN",
        evidence: [
          "protocol bytes are resolved; project activation and task evidence are not proven",
        ],
      };
}

export function doctorFoundation(input: {
  home: string;
  productRoot?: string;
  projectRoot?: string;
}): DoctorReport {
  const inspection = inspectMachine({ home: input.home, productRoot: input.productRoot });
  const install = resolveInstallLayout({
    home: inspection.home,
    distributionVersion: inspection.distributionVersion,
  });
  const record = inspection.installRecord;
  if (!record || record.status !== "active") {
    return {
      distributionVersion: inspection.distributionVersion,
      foundationCommit: inspection.foundationCommit,
      gates: [
        {
          name: "DISTRIBUTION_VALID",
          status: "FAIL",
          evidence: ["active install record is absent"],
        },
        { name: "RUNTIME_EFFECTIVE", status: "FAIL", evidence: ["Foundation is not installed"] },
        {
          name: "ROLE_BOUNDARY_QUALIFIED",
          status: "UNKNOWN",
          evidence: ["Foundation is not installed"],
        },
        inspectProjectReadiness(input.projectRoot, input.productRoot),
      ],
    };
  }
  return {
    distributionVersion: record.distributionVersion,
    foundationCommit: record.foundationCommit,
    gates: [
      distributionGate(record.releasePath),
      runtimeGate({
        currentLink: install.currentLink,
        releasePath: record.releasePath,
        links: record.installedLinks,
        retiredLinks: record.previousLinks ?? [],
        daemonReachable: inspection.paseoDaemonReachable,
        daemonEvidence: inspection.paseoDaemonEvidence,
        interruptedTransactionPresent: inspection.interruptedTransactionPresent,
      }),
      roleBoundaryGate(record.releasePath),
      inspectProjectReadiness(input.projectRoot, input.productRoot),
    ],
  };
}
