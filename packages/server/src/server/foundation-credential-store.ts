import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { FoundationCredentialRefSchema } from "@getpaseo/protocol/messages";
import {
  loadPersistedConfig,
  savePersistedConfig,
  type PersistedConfig,
} from "./persisted-config.js";

export interface FoundationCredentialStatus {
  credentialRef: string;
  configured: boolean;
}

function credentialsRoot(paseoHome: string): string {
  return path.join(path.resolve(paseoHome), "credentials", "providers");
}

function validateCredentialDirectories(paseoHome: string): void {
  for (const directory of [
    path.join(path.resolve(paseoHome), "credentials"),
    credentialsRoot(paseoHome),
  ]) {
    if (!pathNodeExists(directory)) continue;
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`credential directory is not a regular directory: ${directory}`);
    }
  }
}

function ensureCredentialDirectories(paseoHome: string): string {
  validateCredentialDirectories(paseoHome);
  const root = credentialsRoot(paseoHome);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  validateCredentialDirectories(paseoHome);
  chmodSync(path.dirname(root), 0o700);
  chmodSync(root, 0o700);
  return root;
}

export function resolveFoundationCredentialFile(paseoHome: string, credentialRef: string): string {
  const validRef = FoundationCredentialRefSchema.parse(credentialRef);
  return path.join(credentialsRoot(paseoHome), `${validRef}.json`);
}

export function isFoundationCredentialFileConfigured(filePath: string): boolean {
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) return false;
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const apiKey = (parsed as Record<string, unknown>).OPENAI_API_KEY;
    return typeof apiKey === "string" && apiKey.trim().length > 0;
  } catch {
    return false;
  }
}

function pathNodeExists(filePath: string): boolean {
  try {
    lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function readConfiguredApiKey(config: PersistedConfig, credentialRef: string): string | null {
  const apiKey = config.agents?.credentials?.[credentialRef]?.OPENAI_API_KEY;
  return typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : null;
}

function withConfiguredApiKey(
  config: PersistedConfig,
  credentialRef: string,
  apiKey: string | null,
): PersistedConfig {
  const credentials = { ...config.agents?.credentials };
  if (apiKey === null) {
    delete credentials[credentialRef];
  } else {
    credentials[credentialRef] = { OPENAI_API_KEY: apiKey };
  }
  const agents = {
    ...config.agents,
    ...(Object.keys(credentials).length > 0 ? { credentials } : {}),
  };
  if (Object.keys(credentials).length === 0) {
    delete agents.credentials;
  }
  return { ...config, agents };
}

export class FoundationCredentialStore {
  private readonly paseoHome: string;

  constructor(paseoHome: string) {
    this.paseoHome = path.resolve(paseoHome);
    this.syncConfiguredCredentialFiles();
  }

  public getStatus(credentialRef: string): FoundationCredentialStatus {
    const validRef = FoundationCredentialRefSchema.parse(credentialRef);
    validateCredentialDirectories(this.paseoHome);
    const configuredApiKey = readConfiguredApiKey(loadPersistedConfig(this.paseoHome), validRef);
    if (configuredApiKey) {
      this.writeCredentialFile(validRef, configuredApiKey);
    }
    const filePath = resolveFoundationCredentialFile(this.paseoHome, validRef);
    return { credentialRef: validRef, configured: isFoundationCredentialFileConfigured(filePath) };
  }

  /** Server-internal credential access. Never expose this value through RPC or diagnostics. */
  public readApiKeyForInternalUse(credentialRef: string): string | null {
    const validRef = FoundationCredentialRefSchema.parse(credentialRef);
    return readConfiguredApiKey(loadPersistedConfig(this.paseoHome), validRef);
  }

  public set(credentialRef: string, rawApiKey: string): FoundationCredentialStatus {
    const validRef = FoundationCredentialRefSchema.parse(credentialRef);
    const apiKey = rawApiKey.trim();
    if (!apiKey) throw new Error("API key must not be empty");
    const filePath = resolveFoundationCredentialFile(this.paseoHome, validRef);
    ensureCredentialDirectories(this.paseoHome);
    if (pathNodeExists(filePath) && !lstatSync(filePath).isFile()) {
      throw new Error(`credential target is not a regular file: ${validRef}`);
    }

    const previousConfig = loadPersistedConfig(this.paseoHome);
    savePersistedConfig(this.paseoHome, withConfiguredApiKey(previousConfig, validRef, apiKey));
    try {
      this.writeCredentialFile(validRef, apiKey);
    } catch (error) {
      savePersistedConfig(this.paseoHome, previousConfig);
      throw error;
    }
    return { credentialRef: validRef, configured: true };
  }

  public delete(credentialRef: string): FoundationCredentialStatus {
    const validRef = FoundationCredentialRefSchema.parse(credentialRef);
    validateCredentialDirectories(this.paseoHome);
    const filePath = resolveFoundationCredentialFile(this.paseoHome, validRef);
    if (pathNodeExists(filePath)) {
      if (!lstatSync(filePath).isFile()) {
        throw new Error(`credential target is not a regular file: ${validRef}`);
      }
    }
    const previousConfig = loadPersistedConfig(this.paseoHome);
    savePersistedConfig(this.paseoHome, withConfiguredApiKey(previousConfig, validRef, null));
    try {
      rmSync(filePath, { force: true });
    } catch (error) {
      savePersistedConfig(this.paseoHome, previousConfig);
      throw error;
    }
    return { credentialRef: validRef, configured: false };
  }

  private syncConfiguredCredentialFiles(): void {
    const credentials = loadPersistedConfig(this.paseoHome).agents?.credentials ?? {};
    for (const [credentialRef, credential] of Object.entries(credentials)) {
      this.writeCredentialFile(credentialRef, credential.OPENAI_API_KEY);
    }
  }

  private writeCredentialFile(credentialRef: string, apiKey: string): void {
    const root = ensureCredentialDirectories(this.paseoHome);
    const filePath = resolveFoundationCredentialFile(this.paseoHome, credentialRef);
    if (pathNodeExists(filePath) && !lstatSync(filePath).isFile()) {
      throw new Error(`credential target is not a regular file: ${credentialRef}`);
    }
    const temporary = path.join(root, `.${credentialRef}.${randomUUID()}.tmp`);
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(
        descriptor,
        `${JSON.stringify({ schemaVersion: 1, OPENAI_API_KEY: apiKey })}\n`,
      );
    } finally {
      closeSync(descriptor);
    }
    try {
      renameSync(temporary, filePath);
      chmodSync(filePath, 0o600);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}
