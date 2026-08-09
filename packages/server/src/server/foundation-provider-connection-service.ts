import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { MutableDaemonConfig } from "./daemon-config-store.js";
import type { FoundationCredentialStore } from "./foundation-credential-store.js";
import { writePrivateFileAtomicSync } from "./private-files.js";

const QUALIFICATION_FILE = "provider-connection-qualifications.json";
const REQUEST_TIMEOUT_MS = 30_000;

const StoredReceiptSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  fingerprint: z.string().length(64),
  qualifiedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative(),
});

const StoreSchema = z.object({
  schemaVersion: z.literal(1),
  receipts: z.record(z.string(), StoredReceiptSchema),
});

type StoredReceipt = z.infer<typeof StoredReceiptSchema>;

export interface FoundationProviderConnectionStatus {
  provider: string;
  model: string;
  status: "unqualified" | "qualified" | "stale";
  qualifiedAt?: string;
  latencyMs?: number;
}

interface ConnectionTarget {
  provider: string;
  model: string;
  baseUrl: string;
  credentialRef: string;
  apiKey: string;
  fingerprint: string;
}

interface FoundationProviderConnectionServiceOptions {
  paseoHome: string;
  daemonVersion: string;
  getConfig: () => MutableDaemonConfig;
  credentialStore: FoundationCredentialStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeBaseUrl(rawValue: string): string {
  const parsed = new URL(rawValue.trim());
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "Custom Codex provider requires an HTTPS base URL without credentials, query, or fragment",
    );
  }
  const normalized = parsed.toString().replace(/\/+$/u, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function configuredModels(provider: MutableDaemonConfig["providers"][string]): string[] {
  const replacementModels = (provider as { models?: unknown }).models;
  const replacementIds = Array.isArray(replacementModels)
    ? replacementModels.flatMap((model) =>
        model && typeof model === "object" && typeof (model as { id?: unknown }).id === "string"
          ? [(model as { id: string }).id]
          : [],
      )
    : [];
  return [...replacementIds, ...(provider.additionalModels ?? []).map((model) => model.id)];
}

function publicStatus(
  receipt: StoredReceipt,
  status: "qualified" | "stale",
  target = { provider: receipt.provider, model: receipt.model },
) {
  return {
    provider: target.provider,
    model: target.model,
    status,
    qualifiedAt: receipt.qualifiedAt,
    latencyMs: receipt.latencyMs,
  } satisfies FoundationProviderConnectionStatus;
}

export class FoundationProviderConnectionService {
  private readonly storePath: string;
  private readonly daemonVersion: string;
  private readonly getConfig: () => MutableDaemonConfig;
  private readonly credentialStore: FoundationCredentialStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: FoundationProviderConnectionServiceOptions) {
    this.storePath = path.join(path.resolve(options.paseoHome), QUALIFICATION_FILE);
    this.daemonVersion = options.daemonVersion;
    this.getConfig = options.getConfig;
    this.credentialStore = options.credentialStore;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  public getStatus(provider: string, model: string): FoundationProviderConnectionStatus {
    const receipt = this.readStore().receipts[provider];
    if (!receipt) return { provider, model, status: "unqualified" };
    try {
      const target = this.resolveTarget(provider, model);
      return publicStatus(
        receipt,
        receipt.fingerprint === target.fingerprint ? "qualified" : "stale",
        { provider, model },
      );
    } catch {
      return publicStatus(receipt, "stale", { provider, model });
    }
  }

  public async test(provider: string, model: string): Promise<FoundationProviderConnectionStatus> {
    const target = this.resolveTarget(provider, model);
    const startedAt = Date.now();
    const response = await this.fetchImpl(`${target.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: target.model,
        input: "Reply with OK.",
        max_output_tokens: 16,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Connection test failed with HTTP ${response.status}`);
    }
    const raw: unknown = await response.json();
    const parsed = z
      .object({ id: z.string().min(1), object: z.literal("response") })
      .passthrough()
      .safeParse(raw);
    if (!parsed.success) {
      throw new Error("Connection test did not return an OpenAI Responses API object");
    }

    const receipt: StoredReceipt = {
      provider: target.provider,
      model: target.model,
      fingerprint: target.fingerprint,
      qualifiedAt: this.now().toISOString(),
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
    const store = this.readStore();
    this.writeStore({ ...store, receipts: { ...store.receipts, [provider]: receipt } });
    return publicStatus(receipt, "qualified");
  }

  private resolveTarget(providerId: string, model: string): ConnectionTarget {
    const provider = this.getConfig().providers[providerId];
    if (!provider || provider.extends !== "codex") {
      throw new Error(`Provider '${providerId}' is not a custom Codex provider`);
    }
    if (!configuredModels(provider).includes(model)) {
      throw new Error(`Model '${model}' is not configured for provider '${providerId}'`);
    }
    const credentialRef = provider.credentialRef;
    if (!credentialRef) throw new Error(`Provider '${providerId}' requires a credentialRef`);
    const apiKey = this.credentialStore.readApiKeyForInternalUse(credentialRef);
    if (!apiKey) throw new Error(`Provider '${providerId}' credential is not configured`);
    const rawBaseUrl = provider.env?.OPENAI_BASE_URL;
    if (!rawBaseUrl) throw new Error(`Provider '${providerId}' requires a base URL`);
    const baseUrl = normalizeBaseUrl(rawBaseUrl);
    const fingerprint = sha256(
      JSON.stringify({
        schemaVersion: 1,
        daemonVersion: this.daemonVersion,
        provider: providerId,
        model,
        baseUrl,
        credentialRef,
        credentialDigest: sha256(apiKey),
      }),
    );
    return { provider: providerId, model, baseUrl, credentialRef, apiKey, fingerprint };
  }

  private readStore(): z.infer<typeof StoreSchema> {
    if (!existsSync(this.storePath)) return { schemaVersion: 1, receipts: {} };
    const stat = lstatSync(this.storePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Provider qualification store is not a regular file");
    }
    return StoreSchema.parse(JSON.parse(readFileSync(this.storePath, "utf8")));
  }

  private writeStore(store: z.infer<typeof StoreSchema>): void {
    writePrivateFileAtomicSync(
      this.storePath,
      `${JSON.stringify(StoreSchema.parse(store), null, 2)}\n`,
    );
  }
}
