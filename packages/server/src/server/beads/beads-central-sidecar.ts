import { randomBytes } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Logger } from "pino";

import type { FoundationCredentialStore } from "../foundation-credential-store.js";
import { spawnProcess } from "../../utils/spawn.js";
import {
  terminateWithTreeKill,
  type ProcessTerminator,
  type TreeKillTarget,
} from "../../utils/tree-kill.js";
import type { BeadsCentralConfig } from "./beads-central-service.js";
import { PASEO_BEADS_CENTRAL_VERSION } from "./beads-service.js";

const STARTUP_TIMEOUT_MS = 60_000;
const READINESS_INTERVAL_MS = 100;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000;
const FORCE_SHUTDOWN_TIMEOUT_MS = 2_000;
const BUNDLED_BD_VERSION_PREFIX = "bd version 1.1.2";

interface SidecarReadyResponse {
  status: "ready";
  central: string;
  bd: string;
}

export interface BeadsCentralSidecarRuntime {
  spawn(
    command: string,
    args: string[],
    options: {
      env: NodeJS.ProcessEnv;
      stdio: "inherit";
    },
  ): ChildProcess;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  terminate: ProcessTerminator;
  sleep(ms: number): Promise<void>;
  now(): number;
  randomToken(): string;
  resolveExecutable(env: NodeJS.ProcessEnv): string;
  resolveBdExecutable(sidecarExecutable: string, env: NodeJS.ProcessEnv): string;
}

export interface BeadsCentralSidecarOptions {
  paseoHome: string;
  config: BeadsCentralConfig;
  credentialStore: Pick<FoundationCredentialStore, "readApiKeyForInternalUse" | "set">;
  logger: Logger;
  onUnexpectedExit: (detail: { code: number | null; signal: NodeJS.Signals | null }) => void;
  env?: NodeJS.ProcessEnv;
  runtime?: BeadsCentralSidecarRuntime;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireExecutable(filePath: string, label: string): string {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`${label} is missing: ${resolved}`);
  }
  return resolved;
}

export function resolveBundledSidecarExecutable(env: NodeJS.ProcessEnv): string {
  const configured = env.PASEO_BEADS_CENTRAL_SIDECAR?.trim();
  if (!configured) {
    throw new Error(
      "Bundled Beads Central sidecar is not configured; PASEO_BEADS_CENTRAL_SIDECAR is missing",
    );
  }
  return requireExecutable(configured, "Bundled Beads Central sidecar");
}

export function resolveBundledBdExecutable(
  sidecarExecutable: string,
  env: NodeJS.ProcessEnv,
): string {
  const configured = env.PASEO_BEADS_CENTRAL_BD_BIN?.trim();
  const candidate =
    configured ||
    path.join(
      path.dirname(sidecarExecutable),
      "bin",
      process.platform === "win32" ? "bd.exe" : "bd",
    );
  return requireExecutable(candidate, "Bundled Beads binary");
}

const defaultRuntime: BeadsCentralSidecarRuntime = {
  spawn: (command, args, options) =>
    spawnProcess(command, args, {
      envMode: "internal",
      env: options.env,
      shell: false,
      stdio: options.stdio,
    }),
  fetch: (input, init) => fetch(input, init),
  terminate: terminateWithTreeKill,
  sleep,
  now: () => Date.now(),
  randomToken: () => randomBytes(48).toString("base64url"),
  resolveExecutable: resolveBundledSidecarExecutable,
  resolveBdExecutable: resolveBundledBdExecutable,
};

function parseLoopbackEndpoint(rawEndpoint: string): {
  endpoint: string;
  host: string;
  port: number;
} {
  const endpoint = new URL(rawEndpoint);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.pathname !== "/" && endpoint.pathname !== "")
  ) {
    throw new Error(
      "Bundled Beads Central requires a plain loopback HTTP endpoint without credentials, query, fragment, or path",
    );
  }
  const port = Number(endpoint.port || "80");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Bundled Beads Central endpoint has an invalid port: ${rawEndpoint}`);
  }
  return {
    endpoint: `http://127.0.0.1:${port}`,
    host: "127.0.0.1",
    port,
  };
}

function isChildExited(child: TreeKillTarget): boolean {
  return (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined)
  );
}

function sidecarProcessEnv(
  source: NodeJS.ProcessEnv,
  overlay: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const allowedKeys = [
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "WINDIR",
  ] as const;
  const minimal: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    if (source[key] !== undefined) minimal[key] = source[key];
  }
  return { ...minimal, ...overlay };
}

async function readReadyResponse(
  runtime: BeadsCentralSidecarRuntime,
  endpoint: string,
): Promise<{ responded: boolean; ready: SidecarReadyResponse | null }> {
  try {
    const response = await runtime.fetch(`${endpoint}/health/ready`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return { responded: true, ready: null };
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      (body as Record<string, unknown>).status !== "ready" ||
      typeof (body as Record<string, unknown>).central !== "string" ||
      typeof (body as Record<string, unknown>).bd !== "string"
    ) {
      return { responded: true, ready: null };
    }
    return { responded: true, ready: body as SidecarReadyResponse };
  } catch {
    return { responded: false, ready: null };
  }
}

export class BeadsCentralSidecar {
  private readonly runtime: BeadsCentralSidecarRuntime;
  private readonly env: NodeJS.ProcessEnv;
  private readonly endpoint: string;
  private readonly host: string;
  private readonly port: number;
  private child: ChildProcess | null = null;
  private stopping = false;
  private ready = false;

  public constructor(private readonly options: BeadsCentralSidecarOptions) {
    this.runtime = options.runtime ?? defaultRuntime;
    this.env = options.env ?? process.env;
    const target = parseLoopbackEndpoint(options.config.endpoint);
    this.endpoint = target.endpoint;
    this.host = target.host;
    this.port = target.port;
  }

  public async start(): Promise<void> {
    if (this.child) throw new Error("Bundled Beads Central sidecar is already started");

    const occupied = await readReadyResponse(this.runtime, this.endpoint);
    if (occupied.ready) {
      throw new Error(
        `Bundled Beads Central cannot start because ${this.endpoint} is already serving Central ${occupied.ready.central}; stop the legacy external service before starting Paseo`,
      );
    }
    if (occupied.responded) {
      throw new Error(
        `Bundled Beads Central cannot start because ${this.endpoint} is already occupied by another HTTP service`,
      );
    }

    const executable = this.runtime.resolveExecutable(this.env);
    const bdExecutable = this.runtime.resolveBdExecutable(executable, this.env);
    const dataDir = path.join(path.resolve(this.options.paseoHome), "beads-central");
    const configPath = path.join(dataDir, "projects.yaml");
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    if (!existsSync(configPath)) {
      writeFileSync(configPath, "projects: []\n", { encoding: "utf8", mode: 0o600 });
    } else if (process.platform !== "win32") {
      chmodSync(configPath, 0o600);
    }

    let token =
      this.env.PASEO_BEADS_CENTRAL_TOKEN?.trim() ||
      this.options.credentialStore.readApiKeyForInternalUse(this.options.config.credentialRef);
    if (!token) {
      token = this.runtime.randomToken();
      this.options.credentialStore.set(this.options.config.credentialRef, token);
    }
    if (token.length < 32) {
      throw new Error("Bundled Beads Central credential must contain at least 32 characters");
    }

    const childEnv = sidecarProcessEnv(this.env, {
      BEADS_CENTRAL_BD_BIN: bdExecutable,
      BEADS_CENTRAL_COMMAND_TIMEOUT: "30",
      BEADS_CENTRAL_CONFIG: configPath,
      BEADS_CENTRAL_DATA: dataDir,
      BEADS_CENTRAL_TOKENS_JSON: JSON.stringify({
        [token]: {
          subject: "paseo-daemon",
          projects: ["*"],
          permissions: ["admin"],
        },
      }),
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONUNBUFFERED: "1",
    });

    this.stopping = false;
    const child = this.runtime.spawn(
      executable,
      ["--host", this.host, "--port", String(this.port)],
      { env: childEnv, stdio: "inherit" },
    );
    this.child = child;
    child.once("exit", (code, signal) => {
      const wasReady = this.ready;
      this.ready = false;
      if (this.child === child) this.child = null;
      if (!this.stopping && wasReady) {
        this.options.logger.error(
          { code, signal },
          "Bundled Beads Central sidecar exited unexpectedly",
        );
        this.options.onUnexpectedExit({ code, signal });
      }
    });

    const deadline = this.runtime.now() + STARTUP_TIMEOUT_MS;
    while (this.runtime.now() < deadline) {
      if (isChildExited(child)) {
        throw new Error(
          `Bundled Beads Central sidecar exited before readiness (code=${String(child.exitCode)}, signal=${String(child.signalCode)})`,
        );
      }
      const { ready } = await readReadyResponse(this.runtime, this.endpoint);
      if (ready) {
        if (ready.central !== PASEO_BEADS_CENTRAL_VERSION) {
          await this.stop();
          throw new Error(
            `Bundled Beads Central version mismatch: expected ${PASEO_BEADS_CENTRAL_VERSION}, received ${ready.central}`,
          );
        }
        if (!ready.bd.startsWith(BUNDLED_BD_VERSION_PREFIX)) {
          await this.stop();
          throw new Error(`Bundled Beads Central returned an unsupported runtime: ${ready.bd}`);
        }
        this.ready = true;
        this.options.logger.info(
          { endpoint: this.endpoint, version: ready.central, bd: ready.bd, pid: child.pid },
          "Bundled Beads Central sidecar ready",
        );
        return;
      }
      await this.runtime.sleep(READINESS_INTERVAL_MS);
    }

    await this.stop();
    throw new Error(
      `Bundled Beads Central sidecar did not become ready within ${STARTUP_TIMEOUT_MS}ms`,
    );
  }

  public async stop(): Promise<void> {
    const child = this.child;
    this.stopping = true;
    this.ready = false;
    this.child = null;
    if (!child) return;
    const result = await this.runtime.terminate(child, {
      gracefulTimeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
      forceTimeoutMs: FORCE_SHUTDOWN_TIMEOUT_MS,
      onForceSignal: () => {
        this.options.logger.warn(
          { pid: child.pid },
          "Bundled Beads Central sidecar did not exit after SIGTERM; sending SIGKILL",
        );
      },
    });
    if (result === "kill-timeout") {
      throw new Error("Bundled Beads Central sidecar did not exit after SIGKILL");
    }
  }

  public isReady(): boolean {
    return this.ready;
  }
}
