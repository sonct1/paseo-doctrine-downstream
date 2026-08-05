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

function validateCredentialFile(filePath: string): boolean {
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) return false;
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

export class FoundationCredentialStore {
  private readonly paseoHome: string;

  constructor(paseoHome: string) {
    this.paseoHome = path.resolve(paseoHome);
  }

  public getStatus(credentialRef: string): FoundationCredentialStatus {
    validateCredentialDirectories(this.paseoHome);
    const filePath = resolveFoundationCredentialFile(this.paseoHome, credentialRef);
    return { credentialRef, configured: validateCredentialFile(filePath) };
  }

  public set(credentialRef: string, rawApiKey: string): FoundationCredentialStatus {
    const apiKey = rawApiKey.trim();
    if (!apiKey) throw new Error("API key must not be empty");
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
    return { credentialRef, configured: true };
  }

  public delete(credentialRef: string): FoundationCredentialStatus {
    validateCredentialDirectories(this.paseoHome);
    const filePath = resolveFoundationCredentialFile(this.paseoHome, credentialRef);
    if (pathNodeExists(filePath)) {
      if (!lstatSync(filePath).isFile()) {
        throw new Error(`credential target is not a regular file: ${credentialRef}`);
      }
      rmSync(filePath);
    }
    return { credentialRef, configured: false };
  }
}
