import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { PaseoDaemonIdentity } from "./inspection.js";
import { RoleBoundaryCanaryReceiptSchema, type RoleBoundaryCanaryReceipt } from "./schema.js";

export type QualificationStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface QualificationCheck {
  status: QualificationStatus;
  evidence: string[];
  route?: { provider: string; model: string; qualifiedAt: string };
}

const ProviderReceiptSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  qualifiedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative(),
});

const ProviderReceiptStoreSchema = z.object({
  schemaVersion: z.literal(1),
  receipts: z.record(z.string(), ProviderReceiptSchema),
});

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRegularJson(filePath: string): unknown {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${filePath}: expected a regular file`);
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function providerMap(config: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(config.providers)) return config.providers;
  if (!isRecord(config.agents) || !isRecord(config.agents.providers)) return {};
  return config.agents.providers;
}

function credentialMap(config: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(config.agents) || !isRecord(config.agents.credentials)) return {};
  return config.agents.credentials;
}

function configuredModels(provider: Record<string, unknown>): string[] {
  const replacement = Array.isArray(provider.models) ? provider.models : [];
  const additional = Array.isArray(provider.additionalModels) ? provider.additionalModels : [];
  return [...replacement, ...additional].flatMap((model) =>
    isRecord(model) && typeof model.id === "string" ? [model.id] : [],
  );
}

function normalizedBaseUrl(rawValue: string): string {
  const parsed = new URL(rawValue.trim());
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("custom Codex provider base URL is not a credential-free HTTPS URL");
  }
  const normalized = parsed.toString().replace(/\/+$/u, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function parseAuditRoute(raw: unknown): { provider: string; model: string } {
  if (!isRecord(raw) || !isRecord(raw.providers) || typeof raw.providers.audit !== "string") {
    throw new Error("orchestration preference providers.audit is missing");
  }
  const separator = raw.providers.audit.indexOf("/");
  if (separator <= 0 || separator === raw.providers.audit.length - 1) {
    throw new Error("orchestration preference providers.audit must be provider/model");
  }
  return {
    provider: raw.providers.audit.slice(0, separator),
    model: raw.providers.audit.slice(separator + 1),
  };
}

function currentProviderFingerprint(input: {
  config: Record<string, unknown>;
  provider: Record<string, unknown>;
  route: { provider: string; model: string };
  daemonVersion: string;
}): string {
  const credentialRef = input.provider.credentialRef;
  const environment = input.provider.env;
  if (typeof credentialRef !== "string" || !isRecord(environment)) {
    throw new Error("audit provider credentialRef or environment is missing");
  }
  const credential = credentialMap(input.config)[credentialRef];
  const apiKey = isRecord(credential) ? credential.OPENAI_API_KEY : null;
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("audit provider credential is not configured");
  }
  const rawBaseUrl = environment.OPENAI_BASE_URL;
  if (typeof rawBaseUrl !== "string") throw new Error("audit provider base URL is missing");
  return sha256(
    JSON.stringify({
      schemaVersion: 1,
      daemonVersion: input.daemonVersion,
      provider: input.route.provider,
      model: input.route.model,
      baseUrl: normalizedBaseUrl(rawBaseUrl),
      credentialRef,
      credentialDigest: sha256(apiKey.trim()),
    }),
  );
}

export function inspectAuditRoute(input: {
  home: string;
  daemonIdentity: PaseoDaemonIdentity | null;
}): QualificationCheck {
  if (!input.daemonIdentity) {
    return { status: "UNKNOWN", evidence: ["exact daemon identity is unavailable"] };
  }
  const paseoHome = path.join(path.resolve(input.home), ".paseo");
  const preferencePath = path.join(paseoHome, "orchestration-preferences.json");
  const configPath = path.join(paseoHome, "config.json");
  const receiptPath = path.join(paseoHome, "provider-connection-qualifications.json");
  try {
    if (!existsSync(preferencePath)) {
      return { status: "UNKNOWN", evidence: ["audit orchestration preference is absent"] };
    }
    const route = parseAuditRoute(readRegularJson(preferencePath));
    if (!input.daemonIdentity.availableProviders.includes(route.provider)) {
      return {
        status: "FAIL",
        evidence: [
          `audit route ${route.provider}/${route.model}: provider is absent from live catalog`,
        ],
      };
    }
    const configRaw = readRegularJson(configPath);
    if (!isRecord(configRaw)) throw new Error("Paseo config root is not an object");
    const providerRaw = providerMap(configRaw)[route.provider];
    if (!isRecord(providerRaw) || providerRaw.enabled === false) {
      return {
        status: "FAIL",
        evidence: [`audit route ${route.provider}/${route.model}: provider is not enabled`],
      };
    }
    if (providerRaw.extends !== "codex") {
      return {
        status: "FAIL",
        evidence: [
          `audit route ${route.provider}/${route.model}: provider is not a custom Codex route`,
        ],
      };
    }
    if (!configuredModels(providerRaw).includes(route.model)) {
      return {
        status: "FAIL",
        evidence: [`audit route ${route.provider}/${route.model}: model is not configured`],
      };
    }
    const fingerprint = currentProviderFingerprint({
      config: configRaw,
      provider: providerRaw,
      route,
      daemonVersion: input.daemonIdentity.version,
    });
    if (!existsSync(receiptPath)) {
      return {
        status: "UNKNOWN",
        evidence: [`audit route ${route.provider}/${route.model}: connection is unqualified`],
      };
    }
    const store = ProviderReceiptStoreSchema.parse(readRegularJson(receiptPath));
    const receipt = store.receipts[route.provider];
    if (!receipt || receipt.model !== route.model) {
      return {
        status: "UNKNOWN",
        evidence: [`audit route ${route.provider}/${route.model}: connection is unqualified`],
      };
    }
    if (receipt.fingerprint !== fingerprint) {
      return {
        status: "UNKNOWN",
        evidence: [
          `audit route ${route.provider}/${route.model}: verification stale since ${receipt.qualifiedAt}`,
        ],
      };
    }
    return {
      status: "PASS",
      evidence: [
        `audit route ${route.provider}/${route.model}: live and connection-qualified at ${receipt.qualifiedAt}`,
      ],
      route: { ...route, qualifiedAt: receipt.qualifiedAt },
    };
  } catch (error) {
    return {
      status: "FAIL",
      evidence: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function roleBoundaryReceiptPath(home: string): string {
  return path.join(path.resolve(home), ".paseo-foundation", "role-boundary-canary.json");
}

function canonicalRoleDefinitionDigests(releasePath: string): Record<string, string> {
  const raw = readRegularJson(
    path.join(releasePath, "profiles", "native", "role-definitions.json"),
  );
  if (!isRecord(raw) || !Array.isArray(raw.universalBlocks) || !isRecord(raw.roles)) {
    throw new Error("native role definitions are malformed");
  }
  const universal = raw.universalBlocks;
  const roles = raw.roles;
  if (!universal.every((block) => typeof block === "string")) {
    throw new Error("native universal role blocks are malformed");
  }
  return Object.fromEntries(
    ["lead", "peer", "supervisor"].map((roleId) => {
      const blocks = roles[roleId];
      if (!Array.isArray(blocks) || !blocks.every((block) => typeof block === "string")) {
        throw new Error(`native ${roleId} role blocks are malformed`);
      }
      return [roleId, sha256(`${universal.join("\n\n")}\n\n${blocks.join("\n\n")}`)];
    }),
  );
}

export function inspectRoleBoundaryReceipt(input: {
  home: string;
  receiptPath?: string;
  releasePath: string;
  distributionVersion: string;
  foundationCommit: string;
  daemonIdentity: PaseoDaemonIdentity | null;
  auditRoute: QualificationCheck;
}): QualificationCheck {
  const receiptPath = path.resolve(input.receiptPath ?? roleBoundaryReceiptPath(input.home));
  if (!existsSync(receiptPath)) {
    return {
      status: "UNKNOWN",
      evidence: ["fresh identity-bound role/tool canary receipt is absent"],
    };
  }
  if (!input.daemonIdentity) {
    return { status: "UNKNOWN", evidence: ["exact daemon identity is unavailable"] };
  }
  try {
    const receipt = RoleBoundaryCanaryReceiptSchema.parse(readRegularJson(receiptPath));
    const failures: string[] = [];
    const roleDefinitionsPath = path.join(
      input.releasePath,
      "profiles",
      "native",
      "role-definitions.json",
    );
    const roleBundlesPath = path.join(input.releasePath, "skills", "role-bundles.json");
    if (receipt.foundation.distributionVersion !== input.distributionVersion) {
      failures.push("canary Foundation distribution version is stale");
    }
    if (receipt.foundation.commit !== input.foundationCommit) {
      failures.push("canary Foundation commit is stale");
    }
    if (receipt.foundation.roleDefinitionsDigest !== sha256(readFileSync(roleDefinitionsPath))) {
      failures.push("canary native role definition bytes are stale");
    }
    if (receipt.foundation.roleBundlesDigest !== sha256(readFileSync(roleBundlesPath))) {
      failures.push("canary role bundle bytes are stale");
    }
    for (const [field, expected] of Object.entries({
      serverId: input.daemonIdentity.serverId,
      version: input.daemonIdentity.version,
      startedAt: input.daemonIdentity.startedAt,
      sourceCommit: input.daemonIdentity.sourceCommit,
      sourceFingerprint: input.daemonIdentity.sourceFingerprint,
    })) {
      if (receipt.daemon[field as keyof typeof receipt.daemon] !== expected) {
        failures.push(`canary daemon ${field} is stale`);
      }
    }
    if (input.auditRoute.status !== "PASS" || !input.auditRoute.route) {
      failures.push("current audit route is not connection-qualified");
    } else {
      if (
        receipt.route.provider !== input.auditRoute.route.provider ||
        receipt.route.model !== input.auditRoute.route.model
      ) {
        failures.push("canary provider/model does not match the current audit route");
      }
      if (receipt.route.providerConnectionQualifiedAt !== input.auditRoute.route.qualifiedAt) {
        failures.push("canary provider connection receipt is stale");
      }
    }
    const expectedDefinitionDigests = canonicalRoleDefinitionDigests(input.releasePath);
    for (const role of receipt.roles) {
      if (role.definitionDigest !== expectedDefinitionDigests[role.roleId]) {
        failures.push(`${role.roleId}: role definition digest is stale`);
      }
    }
    if (failures.length > 0) {
      return { status: "UNKNOWN", evidence: failures };
    }
    return {
      status: "PASS",
      evidence: [
        `identity-bound Lead/Peer/Supervisor canary qualified at ${receipt.qualifiedAt}`,
        `route ${receipt.route.provider}/${receipt.route.model}; daemon ${receipt.daemon.version} ${receipt.daemon.sourceCommit.slice(0, 12)}`,
      ],
    };
  } catch (error) {
    return {
      status: "UNKNOWN",
      evidence: [
        `role/tool canary receipt is invalid: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

export function installRoleBoundaryReceipt(input: { home: string; sourcePath: string }): {
  path: string;
  receipt: RoleBoundaryCanaryReceipt;
} {
  const receipt = RoleBoundaryCanaryReceiptSchema.parse(
    readRegularJson(path.resolve(input.sourcePath)),
  );
  const destination = roleBoundaryReceiptPath(input.home);
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  chmodSync(path.dirname(destination), 0o700);
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, destination);
  chmodSync(destination, 0o600);
  return { path: destination, receipt };
}
