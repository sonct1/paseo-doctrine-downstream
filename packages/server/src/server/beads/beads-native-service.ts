import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { Logger } from "pino";
import { z } from "zod";
import {
  BeadsIssueSchema,
  BeadsIssueStatusSchema,
  BeadsIssueTypeSchema,
  type BeadsIssue,
} from "@getpaseo/protocol/beads/rpc-schemas";

import { writeJsonFileAtomic } from "../atomic-file.js";

const execFileAsync = promisify(execFile);

export const PASEO_BEADS_VERSION = "1.1.2";
const COMMAND_TIMEOUT_MS = 30_000;
const COMMAND_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const IDEMPOTENCY_SCHEMA_VERSION = 1 as const;
const MAX_IDEMPOTENCY_ENTRIES = 2_000;

export { BeadsIssueSchema, BeadsIssueStatusSchema, BeadsIssueTypeSchema };
export const BeadsWritableIssueStatusSchema = BeadsIssueStatusSchema.exclude(["closed"]);
export const BeadsDependencyTypeSchema = z.enum([
  "blocks",
  "tracks",
  "related",
  "parent-child",
  "discovered-from",
  "until",
  "caused-by",
  "validates",
  "relates-to",
  "supersedes",
]);

export type { BeadsIssue };

export interface BeadsProjectContext {
  projectId: string;
  actor: string;
}

export interface BeadsMutationGuard {
  issueId: string;
  expectedAssignee: string;
  requireNotClosed: boolean;
  signal?: AbortSignal;
}

export interface BeadsCreateInput {
  title: string;
  description?: string;
  issueType: z.infer<typeof BeadsIssueTypeSchema>;
  priority: number;
  labels?: string[];
  acceptance?: string;
  discoveredFrom?: string;
  idempotencyKey: string;
}

export interface BeadsListInput {
  status?: z.infer<typeof BeadsIssueStatusSchema>[];
  issueType?: z.infer<typeof BeadsIssueTypeSchema>;
  priority?: number;
  assignee?: string;
  labels?: string[];
  limit?: number;
}

export interface BeadsUpdateInput {
  title?: string;
  description?: string;
  priority?: number;
  status?: z.infer<typeof BeadsWritableIssueStatusSchema>;
  appendNotes?: string;
  addLabels?: string[];
  removeLabels?: string[];
  idempotencyKey: string;
}

export interface BeadsCommandInput {
  binaryPath: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface BeadsCommandOutput {
  stdout: string;
  stderr: string;
}

export type BeadsCommandRunner = (input: BeadsCommandInput) => Promise<BeadsCommandOutput>;

interface PendingIdempotencyEntry {
  state: "pending";
  fingerprint: string;
  createdAt: string;
}

interface CompletedIdempotencyEntry {
  state: "completed";
  fingerprint: string;
  result: unknown;
  createdAt: string;
}

type IdempotencyEntry = PendingIdempotencyEntry | CompletedIdempotencyEntry;

interface IdempotencyStore {
  schemaVersion: typeof IDEMPOTENCY_SCHEMA_VERSION;
  entries: Record<string, IdempotencyEntry>;
}

interface ProjectPaths {
  root: string;
  home: string;
  beadsDir: string;
  idempotencyFile: string;
  prefix: string;
}

export interface BeadsNativeServiceOptions {
  paseoHome: string;
  logger: Logger;
  binaryPath?: string;
  commandRunner?: BeadsCommandRunner;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

function parseJsonOutput(stdout: string, command: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error(`Beads command '${command}' returned no JSON`);
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new Error(`Beads command '${command}' returned invalid JSON`, { cause: error });
  }
}

function parseOneIssue(value: unknown, command: string): BeadsIssue {
  const array = z.array(BeadsIssueSchema).safeParse(value);
  if (array.success && array.data.length === 1) return array.data[0];
  const issue = BeadsIssueSchema.safeParse(value);
  if (issue.success) return issue.data;
  throw new Error(`Beads command '${command}' did not return exactly one valid issue`);
}

interface BeadsBinaryResolution {
  binaryPath: string;
  configurationError?: string;
}

function defaultBinaryResolution(): BeadsBinaryResolution {
  const override = process.env.PASEO_BEADS_BINARY?.trim();
  if (override) return { binaryPath: path.resolve(override) };
  const binaryPath = path.join(
    path.dirname(process.execPath),
    process.platform === "win32" ? "bd.exe" : "bd",
  );
  const releaseMarker = path.join(path.dirname(path.dirname(binaryPath)), "BEADS-LICENSE");
  if (existsSync(releaseMarker)) return { binaryPath };
  return {
    binaryPath,
    configurationError:
      "Native Beads is unavailable in a source checkout; set PASEO_BEADS_BINARY to the pinned bd 1.1.2 binary",
  };
}

async function defaultCommandRunner(input: BeadsCommandInput): Promise<BeadsCommandOutput> {
  const { stdout, stderr } = await execFileAsync(input.binaryPath, input.args, {
    cwd: input.cwd,
    env: input.env,
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER_BYTES,
    windowsHide: true,
    signal: input.signal,
  });
  return { stdout, stderr };
}

function actorEnvironment(
  actor: string,
  project: ProjectPaths,
  binaryPath: string,
): NodeJS.ProcessEnv {
  const executableDirectory = path.dirname(binaryPath);
  const systemPath = process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin";
  return {
    HOME: project.home,
    USER: actor,
    LOGNAME: actor,
    PATH: `${executableDirectory}${path.delimiter}${systemPath}`,
    TMPDIR: os.tmpdir(),
    XDG_CONFIG_HOME: path.join(project.home, ".config"),
    BEADS_DIR: project.beadsDir,
    BEADS_ACTOR: actor,
    BEADS_NO_DAEMON: "1",
    BD_NON_INTERACTIVE: "1",
    DOLT_DISABLE_EVENT_FLUSH: "1",
    DO_NOT_TRACK: "1",
    NO_COLOR: "1",
    TERM: "dumb",
  };
}

function emptyIdempotencyStore(): IdempotencyStore {
  return { schemaVersion: IDEMPOTENCY_SCHEMA_VERSION, entries: {} };
}

export function beadsActorForAgent(agentId: string): string {
  const normalized = agentId
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  const readable = normalized || "agent";
  if (readable.length <= 64) return `paseo-agent-${readable}`;
  return `paseo-agent-${readable.slice(0, 48)}-${sha256(agentId).slice(0, 12)}`;
}

export class BeadsNativeService {
  private readonly paseoHome: string;
  private readonly logger: Logger;
  private readonly binaryPath: string;
  private readonly binaryConfigurationError: string | undefined;
  private readonly runCommand: BeadsCommandRunner;
  private readonly verifyBinaryAccess: boolean;
  private readonly initializedProjects = new Set<string>();
  private readonly projectQueues = new Map<string, Promise<void>>();
  private binaryVerification: Promise<void> | null = null;

  constructor(options: BeadsNativeServiceOptions) {
    this.paseoHome = options.paseoHome;
    this.logger = options.logger.child({ module: "beads", component: "native-service" });
    const binary = options.binaryPath
      ? { binaryPath: path.resolve(options.binaryPath) }
      : defaultBinaryResolution();
    this.binaryPath = binary.binaryPath;
    this.binaryConfigurationError = binary.configurationError;
    this.runCommand = options.commandRunner ?? defaultCommandRunner;
    this.verifyBinaryAccess = options.commandRunner === undefined;
  }

  async status(): Promise<{ available: boolean; version: string; reason?: string }> {
    try {
      await this.verifyBinary();
      return { available: true, version: PASEO_BEADS_VERSION };
    } catch (error) {
      return {
        available: false,
        version: PASEO_BEADS_VERSION,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async ready(
    context: BeadsProjectContext,
    limit = 20,
    signal?: AbortSignal,
  ): Promise<BeadsIssue[]> {
    return this.readIssues(context, ["ready", "--limit", String(limit)], "ready", signal);
  }

  async list(
    context: BeadsProjectContext,
    input: BeadsListInput,
    signal?: AbortSignal,
  ): Promise<BeadsIssue[]> {
    const args = ["list", "--all", "--flat", "--limit", String(input.limit ?? 50)];
    if (input.status?.length) args.push("--status", input.status.join(","));
    if (input.issueType) args.push("--type", input.issueType);
    if (input.priority !== undefined) args.push("--priority", String(input.priority));
    if (input.assignee) args.push("--assignee", input.assignee);
    for (const label of input.labels ?? []) args.push("--label", label);
    return this.readIssues(context, args, "list", signal);
  }

  async get(
    context: BeadsProjectContext,
    issueId: string,
    signal?: AbortSignal,
  ): Promise<BeadsIssue> {
    return this.withProject(context.projectId, async () => {
      if (!(await this.projectInitialized(context.projectId))) {
        throw new Error(`Beads project ${context.projectId} is not initialized`);
      }
      return this.getUnlocked(context, issueId, signal);
    });
  }

  async create(
    context: BeadsProjectContext,
    input: BeadsCreateInput,
    signal?: AbortSignal,
    guard?: BeadsMutationGuard,
  ): Promise<BeadsIssue> {
    return this.mutate(
      context,
      "create",
      input.idempotencyKey,
      input,
      async () => {
        const args = [
          "create",
          "--title",
          input.title,
          "--type",
          input.issueType,
          "--priority",
          String(input.priority),
        ];
        if (input.description !== undefined) args.push("--description", input.description);
        if (input.acceptance !== undefined) args.push("--acceptance", input.acceptance);
        if (input.labels?.length) args.push("--labels", input.labels.join(","));
        if (input.discoveredFrom) args.push("--deps", `discovered-from:${input.discoveredFrom}`);
        const result = await this.runJson(context, args, false, signal);
        return parseOneIssue(result, "create");
      },
      guard,
    );
  }

  async claim(
    context: BeadsProjectContext,
    issueId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<BeadsIssue> {
    return this.mutate(context, "claim", idempotencyKey, { issueId }, async () => {
      const result = await this.runJson(context, ["update", issueId, "--claim"], false, signal);
      return parseOneIssue(result, "update --claim");
    });
  }

  async update(
    context: BeadsProjectContext,
    issueId: string,
    input: BeadsUpdateInput,
    signal?: AbortSignal,
    guard?: BeadsMutationGuard,
  ): Promise<BeadsIssue> {
    return this.mutate(
      context,
      "update",
      input.idempotencyKey,
      { issueId, ...input },
      async () => {
        const args = ["update", issueId];
        if (input.title !== undefined) args.push("--title", input.title);
        if (input.description !== undefined) args.push("--description", input.description);
        if (input.priority !== undefined) args.push("--priority", String(input.priority));
        if (input.status !== undefined) args.push("--status", input.status);
        if (input.appendNotes !== undefined) args.push("--append-notes", input.appendNotes);
        for (const label of input.addLabels ?? []) args.push("--add-label", label);
        for (const label of input.removeLabels ?? []) args.push("--remove-label", label);
        const result = await this.runJson(context, args, false, signal);
        return parseOneIssue(result, "update");
      },
      guard,
    );
  }

  async close(
    context: BeadsProjectContext,
    issueId: string,
    reason: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<BeadsIssue> {
    return this.mutate(context, "close", idempotencyKey, { issueId, reason }, async () => {
      const result = await this.runJson(
        context,
        ["close", issueId, "--reason", reason],
        false,
        signal,
      );
      return parseOneIssue(result, "close");
    });
  }

  async addDependency(
    context: BeadsProjectContext,
    issueId: string,
    dependsOnId: string,
    dependencyType: z.infer<typeof BeadsDependencyTypeSchema>,
    idempotencyKey: string,
    signal?: AbortSignal,
    guard?: BeadsMutationGuard,
  ): Promise<BeadsIssue> {
    return this.mutate(
      context,
      "add-dependency",
      idempotencyKey,
      { issueId, dependsOnId, dependencyType },
      async () => {
        await this.runJson(
          context,
          ["dep", "add", issueId, dependsOnId, "--type", dependencyType],
          false,
          signal,
        );
        return this.getUnlocked(context, issueId, signal);
      },
      guard,
    );
  }

  async prime(context: BeadsProjectContext, signal?: AbortSignal): Promise<string> {
    return this.withProject(context.projectId, async () => {
      if (!(await this.projectInitialized(context.projectId))) {
        throw new Error(`Beads project ${context.projectId} is not initialized`);
      }
      const output = await this.run(context, ["--readonly", "prime", "--stealth"], signal, "prime");
      return output.stdout.trim();
    });
  }

  private async readIssues(
    context: BeadsProjectContext,
    args: string[],
    command: string,
    signal?: AbortSignal,
  ): Promise<BeadsIssue[]> {
    return this.withProject(context.projectId, async () => {
      if (!(await this.projectInitialized(context.projectId))) return [];
      const parsed = z
        .array(BeadsIssueSchema)
        .safeParse(await this.runJson(context, args, true, signal));
      if (!parsed.success) {
        throw new Error(`Beads command '${command}' returned an invalid issue list`, {
          cause: parsed.error,
        });
      }
      return parsed.data;
    });
  }

  private async getUnlocked(
    context: BeadsProjectContext,
    issueId: string,
    signal?: AbortSignal,
  ): Promise<BeadsIssue> {
    const result = await this.runJson(context, ["show", issueId], true, signal);
    return parseOneIssue(result, "show");
  }

  private async mutate<T>(
    context: BeadsProjectContext,
    operation: string,
    idempotencyKey: string,
    request: unknown,
    action: () => Promise<T>,
    guard?: BeadsMutationGuard,
  ): Promise<T> {
    return this.withProject(context.projectId, async () => {
      await this.ensureProject(context);
      const project = this.projectPaths(context.projectId);
      const store = await this.readIdempotencyStore(project.idempotencyFile);
      const receiptKey = sha256(`${context.actor}\u0000${operation}\u0000${idempotencyKey}`);
      const fingerprint = sha256(canonicalJson(request));
      const existing = store.entries[receiptKey];
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new Error(
            `Beads idempotency key '${idempotencyKey}' was already used with different input`,
          );
        }
        if (existing.state === "pending") {
          throw new Error(
            `Beads idempotency key '${idempotencyKey}' has an indeterminate prior attempt; inspect current state before issuing a new key`,
          );
        }
        return existing.result as T;
      }

      if (guard) await this.assertMutationGuard(context, guard);

      const createdAt = new Date().toISOString();
      this.pruneIdempotencyStore(store, MAX_IDEMPOTENCY_ENTRIES - 1);
      if (Object.keys(store.entries).length >= MAX_IDEMPOTENCY_ENTRIES) {
        throw new Error(
          "Beads idempotency capacity is exhausted by indeterminate attempts; reconcile them before issuing a new key",
        );
      }
      store.entries[receiptKey] = {
        state: "pending",
        fingerprint,
        createdAt,
      };
      await writeJsonFileAtomic(project.idempotencyFile, store);

      const result = await action();
      store.entries[receiptKey] = {
        state: "completed",
        fingerprint,
        result,
        createdAt,
      };
      await writeJsonFileAtomic(project.idempotencyFile, store);
      return result;
    });
  }

  private async assertMutationGuard(
    context: BeadsProjectContext,
    guard: BeadsMutationGuard,
  ): Promise<void> {
    const issue = await this.getUnlocked(context, guard.issueId, guard.signal);
    if (issue.assignee !== guard.expectedAssignee) {
      throw new Error(`Peer ${guard.expectedAssignee} may mutate only an issue assigned to itself`);
    }
    if (guard.requireNotClosed && issue.status === "closed") {
      throw new Error(`Peer ${guard.expectedAssignee} cannot mutate closed issue ${guard.issueId}`);
    }
  }

  private async runJson(
    context: BeadsProjectContext,
    args: string[],
    readOnly: boolean,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const flags = ["--json", "--actor", context.actor, "--sandbox", "--dolt-auto-commit", "off"];
    if (readOnly) flags.push("--readonly");
    const output = await this.run(context, [...flags, ...args], signal, args[0] ?? "unknown");
    return parseJsonOutput(output.stdout, args[0] ?? "unknown");
  }

  private async run(
    context: BeadsProjectContext,
    args: string[],
    signal?: AbortSignal,
    logicalCommand = args[0] ?? "unknown",
  ): Promise<BeadsCommandOutput> {
    await this.verifyBinary();
    const project = this.projectPaths(context.projectId);
    try {
      return await this.runCommand({
        binaryPath: this.binaryPath,
        args,
        cwd: project.root,
        env: actorEnvironment(context.actor, project, this.binaryPath),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      const stderr =
        error && typeof error === "object" && "stderr" in error
          ? String((error as { stderr?: unknown }).stderr ?? "").trim()
          : "";
      const detail = stderr ? `: ${stderr.slice(0, 2_000)}` : "";
      throw new Error(`Beads command '${logicalCommand}' failed${detail}`, { cause: error });
    }
  }

  private async ensureProject(context: BeadsProjectContext, signal?: AbortSignal): Promise<void> {
    if (this.initializedProjects.has(context.projectId)) return;
    const project = this.projectPaths(context.projectId);
    await fs.mkdir(project.home, { recursive: true, mode: 0o700 });
    await this.run(
      context,
      [
        "init",
        "--init-if-missing",
        "--quiet",
        "--non-interactive",
        "--prefix",
        project.prefix,
        "--role",
        "maintainer",
        "--skip-hooks",
        "--skip-agents",
      ],
      signal,
      "init",
    );
    await this.run(context, ["--quiet", "metrics", "off"], signal, "metrics");
    await this.run(context, ["--quiet", "config", "set", "no-git-ops", "true"], signal, "config");
    this.initializedProjects.add(context.projectId);
  }

  private async projectInitialized(projectId: string): Promise<boolean> {
    if (this.initializedProjects.has(projectId)) return true;
    try {
      await fs.access(this.projectPaths(projectId).beadsDir);
      this.initializedProjects.add(projectId);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private projectPaths(projectId: string): ProjectPaths {
    const digest = sha256(projectId);
    const root = path.join(this.paseoHome, "beads", "projects", digest);
    return {
      root,
      home: path.join(root, "home"),
      beadsDir: path.join(root, ".beads"),
      idempotencyFile: path.join(root, "idempotency.json"),
      prefix: `ps${digest.slice(0, 10)}`,
    };
  }

  private async verifyBinary(): Promise<void> {
    if (!this.binaryVerification) {
      this.binaryVerification = (async () => {
        if (this.binaryConfigurationError) throw new Error(this.binaryConfigurationError);
        if (this.verifyBinaryAccess) {
          await fs.access(this.binaryPath, fsConstants.X_OK);
        }
        const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-beads-runtime-"));
        try {
          const output = await this.runCommand({
            binaryPath: this.binaryPath,
            args: ["version"],
            cwd: scratch,
            env: {
              HOME: scratch,
              PATH: `${path.dirname(this.binaryPath)}${path.delimiter}${process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin"}`,
              DO_NOT_TRACK: "1",
              NO_COLOR: "1",
              TERM: "dumb",
            },
          });
          const versionPattern = new RegExp(
            `^bd version ${PASEO_BEADS_VERSION.replaceAll(".", "\\.")}(?:\\s|$)`,
          );
          if (!versionPattern.test(output.stdout.trim())) {
            throw new Error(
              `Paseo requires bd ${PASEO_BEADS_VERSION}; received '${output.stdout.trim() || "unknown"}'`,
            );
          }
        } finally {
          await fs.rm(scratch, { recursive: true, force: true });
        }
      })().catch((error) => {
        this.binaryVerification = null;
        throw error;
      });
    }
    return this.binaryVerification;
  }

  private async withProject<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.projectQueues.get(projectId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => turn);
    this.projectQueues.set(projectId, queued);
    await previous;
    try {
      return await action();
    } finally {
      release?.();
      if (this.projectQueues.get(projectId) === queued) this.projectQueues.delete(projectId);
    }
  }

  private async readIdempotencyStore(filePath: string): Promise<IdempotencyStore> {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
      const schema = z.object({
        schemaVersion: z.literal(IDEMPOTENCY_SCHEMA_VERSION),
        entries: z.record(
          z.string(),
          z.union([
            z.object({
              state: z.literal("pending"),
              fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
              createdAt: z.string().datetime(),
            }),
            z.object({
              state: z.literal("completed"),
              fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
              result: z.unknown(),
              createdAt: z.string().datetime(),
            }),
            z
              .object({
                fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
                result: z.unknown(),
                createdAt: z.string().datetime(),
              })
              .transform(
                (entry): CompletedIdempotencyEntry => ({
                  state: "completed",
                  ...entry,
                }),
              ),
          ]),
        ),
      });
      return schema.parse(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyIdempotencyStore();
      throw new Error(`Invalid Beads idempotency store at '${filePath}'`, { cause: error });
    }
  }

  private pruneIdempotencyStore(store: IdempotencyStore, targetSize: number): void {
    const entries = Object.entries(store.entries);
    if (entries.length <= targetSize) return;
    const completed = entries
      .filter(([, entry]) => entry.state === "completed")
      .sort(([, left], [, right]) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, Math.max(0, entries.length - targetSize));
    completed.forEach(([key]) => delete store.entries[key]);
    this.logger.debug({ retained: targetSize }, "pruned Beads idempotency receipts");
  }
}
