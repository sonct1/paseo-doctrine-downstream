import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";
import { inspectMachine } from "./inspection.js";
import { resolveInstallLayout } from "./layout.js";
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
  if (input.interruptedTransactionPresent) {
    failures.push("an interrupted Foundation install transaction requires recovery");
  }
  if (!input.daemonReachable) failures.push(...input.daemonEvidence);
  return failures.length === 0
    ? {
        name: "RUNTIME_EFFECTIVE",
        status: "PASS",
        evidence: ["owned links and exact local daemon identity readback pass"],
      }
    : { name: "RUNTIME_EFFECTIVE", status: "FAIL", evidence: failures };
}

function roleBoundaryGate(releasePath: string): DoctorGate {
  const failures: string[] = [];
  for (const role of ["lead", "peer", "supervisor"]) {
    const profilePath = path.join(releasePath, "profiles", "codex", `${role}.config.toml`);
    const profile = readFileSync(profilePath, "utf8");
    for (const required of ["multi_agent = false", "multi_agent_v2 = false", "enabled = false"]) {
      if (!profile.includes(required)) failures.push(`${role}: missing ${required}`);
    }
  }
  if (failures.length > 0) {
    return { name: "ROLE_BOUNDARY_QUALIFIED", status: "FAIL", evidence: failures };
  }
  return {
    name: "ROLE_BOUNDARY_QUALIFIED",
    status: "UNKNOWN",
    evidence: ["static role guards pass; no fresh role/tool canary evidence was supplied"],
  };
}

export function inspectProjectReadiness(projectRoot?: string): DoctorGate {
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
  const markers = protocol.match(/<!--[^>]*PASEO_WORKSPACE_PROTOCOL_VERSION[^>]*-->/gu) ?? [];
  const supportedMarkers = new Set([
    "<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: 1 -->",
    "<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: 2 -->",
  ]);
  const normalized = protocol.toLocaleLowerCase("en-US");
  const identityCategories = [
    [/\bowner\b/u, /chủ sở hữu/u, /\bauthority\b/u, /thẩm quyền/u],
    [/\bapplies_to\b/u, /áp dụng/u, /phạm vi/u, /\brepository\b/u, /\bproject\b/u],
    [/\bversion\b/u, /\blast_reviewed\b/u, /trạng thái/u, /\bstatus\b/u, /\breview/u, /hiệu lực/u],
  ];
  const matchedCategories = identityCategories.filter((category) =>
    category.some((pattern) => pattern.test(normalized)),
  ).length;
  const invalid =
    !protocol.trim() ||
    /\{\{REQUIRED:[^{}]+\}\}/u.test(protocol) ||
    ["<<<<<<<", "=======", ">>>>>>>"].some((marker) => protocol.includes(marker)) ||
    markers.length > 1 ||
    (markers.length === 1 && !supportedMarkers.has(markers[0]?.trim() ?? "")) ||
    matchedCategories < 2;
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
        inspectProjectReadiness(input.projectRoot),
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
        daemonReachable: inspection.paseoDaemonReachable,
        daemonEvidence: inspection.paseoDaemonEvidence,
        interruptedTransactionPresent: inspection.interruptedTransactionPresent,
      }),
      roleBoundaryGate(record.releasePath),
      inspectProjectReadiness(input.projectRoot),
    ],
  };
}
