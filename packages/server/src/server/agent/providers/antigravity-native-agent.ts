import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import type { Logger } from "pino";

import { findExecutable } from "../../../executable-resolution/executable-resolution.js";
import type { ProviderRuntimeSettings } from "../provider-launch-config.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPromptInput,
  AgentProvider,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  FetchCatalogOptions,
  ProviderCatalog,
} from "../agent-sdk-types.js";
import { appendOrReplaceGrowingAssistantMessage, runProviderTurn } from "./provider-runner.js";
import {
  startAntigravityPaseoGateway,
  type AntigravityPaseoGateway,
} from "./antigravity-paseo-gateway.js";

const DEFAULT_PRINT_TIMEOUT = "30m";
const FULL_ACCESS_MODE = "full-access";
const PLAN_MODE = "plan";
const ACCEPT_EDITS_MODE = "accept-edits";

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsSessionListing: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsNativePaseoTools: true,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
};

const MODES: AgentMode[] = [
  { id: FULL_ACCESS_MODE, label: "Full Access", description: "Auto-approve native AGY tools" },
  { id: ACCEPT_EDITS_MODE, label: "Accept Edits", description: "Use AGY accept-edits mode" },
  { id: PLAN_MODE, label: "Plan", description: "Use AGY plan mode" },
];

interface AntigravityNativeAgentClientOptions {
  logger: Logger;
  command: readonly [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  profileRoot?: string;
  temporaryRoot?: string;
  resolveExecutable?: (name: string) => Promise<string | null>;
}

interface MaterializedAntigravityProfile {
  name: string;
  cleanup(): Promise<void>;
}

interface AntigravityStreamUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

interface AntigravityStreamEvent {
  event?: string;
  conversation_id?: string;
  init?: { conversation_id?: string };
  step_update?: {
    step_type?: string;
    text_delta?: string;
    usage?: AntigravityStreamUsage;
  };
  result?: {
    conversation_id?: string;
    status?: string;
    response?: string;
    usage?: AntigravityStreamUsage;
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveConfiguredAgyCommand(command: readonly [string, ...string[]]): string {
  const executable = command[0];
  const basename = executable.split(/[\\/]/u).at(-1);
  if (basename === "agy" || basename === "agy.exe") {
    if (command.length !== 1) {
      throw new Error("Native Antigravity command accepts only the agy executable");
    }
    return executable;
  }
  throw new Error("Native Antigravity requires the exact command ['agy']");
}

async function resolveAgyExecutable(
  command: readonly [string, ...string[]],
  resolver: (name: string) => Promise<string | null>,
): Promise<string> {
  const configured = resolveConfiguredAgyCommand(command);
  const resolved = await resolver(configured);
  if (!resolved || !isAbsolute(resolved)) {
    throw new Error(`Antigravity executable '${configured}' did not resolve to an absolute path`);
  }
  return resolved;
}

function promptToText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") return prompt;
  const unsupported = prompt.filter((block) => block.type !== "text");
  if (unsupported.length > 0) {
    throw new Error("Native Antigravity currently accepts text prompts only");
  }
  return prompt.map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

function roleProfileName(launchContext: AgentLaunchContext): string {
  const binding = launchContext.roleBinding;
  if (!binding || !launchContext.agentId) {
    throw new Error("Native Antigravity requires an immutable role binding and stable agent ID");
  }
  return `paseo-${binding.roleId}-${sha256(launchContext.agentId).slice(0, 12)}-${sha256(
    binding.instructions,
  ).slice(0, 12)}`;
}

function buildRoleProfile(
  name: string,
  launchContext: AgentLaunchContext,
  gatewayInstructions: string,
): string {
  const binding = launchContext.roleBinding;
  if (!binding) throw new Error("Native Antigravity requires an immutable role binding");
  return `---\nname: ${name}\ndescription: Immutable Paseo ${binding.roleId} role binding\nmainAgent: true\nsubagent: false\ninheritMcp: false\ntools:\n  - run_command\n---\n\n${binding.instructions}\n\n${gatewayInstructions}\n`;
}

async function writeExclusiveOrVerify(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(path, "utf8")) !== content) {
      throw new Error(`Antigravity role profile collision at '${path}'`, { cause: error });
    }
  }
}

async function materializeRoleProfile(input: {
  launchContext: AgentLaunchContext;
  gatewayInstructions: string;
  profileRoot?: string;
}): Promise<MaterializedAntigravityProfile> {
  const name = roleProfileName(input.launchContext);
  const content = buildRoleProfile(name, input.launchContext, input.gatewayInstructions);
  const directory = join(input.profileRoot ?? join(homedir(), ".gemini", "config", "agents"), name);
  const profilePath = join(directory, "agent.md");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeExclusiveOrVerify(profilePath, content);
  return {
    name,
    cleanup: async () => {
      try {
        if ((await readFile(profilePath, "utf8")) === content) {
          await rm(directory, { recursive: true, force: true });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}

function parseModels(stdout: string, provider: AgentProvider): AgentModelDefinition[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.includes("\t"))
    .map((line, index) => {
      const [id, label] = line.split("\t", 2);
      return {
        provider,
        id,
        label: label || id,
        isDefault: index === 0,
      } satisfies AgentModelDefinition;
    });
}

function toUsage(usage: AntigravityStreamUsage | undefined): AgentRunResult["usage"] {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cache_read_tokens,
    outputTokens: usage.output_tokens,
  };
}

class AntigravityNativeAgentSession implements AgentSession {
  readonly capabilities = CAPABILITIES;
  readonly features = [];
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private activeProcess: ChildProcess | null = null;
  private pendingOutcome:
    | { turnId: string; type: "completed"; usage: AgentRunResult["usage"] }
    | { turnId: string; type: "failed"; error: string }
    | null = null;
  private conversationId: string | null;
  private closed = false;
  private currentModeId: string;
  private assistantText = "";

  constructor(
    readonly provider: AgentProvider,
    private readonly executable: string,
    private readonly config: AgentSessionConfig,
    private readonly env: Record<string, string>,
    private readonly profile: MaterializedAntigravityProfile,
    private readonly gateway: AntigravityPaseoGateway,
    private readonly logger: Logger,
    conversationId?: string | null,
  ) {
    this.conversationId = conversationId ?? null;
    this.currentModeId = config.modeId ?? FULL_ACCESS_MODE;
  }

  get id(): string | null {
    return this.conversationId;
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    return await runProviderTurn({
      prompt,
      runOptions: options,
      startTurn: this.startTurn.bind(this),
      subscribe: this.subscribe.bind(this),
      getSessionId: () => this.conversationId ?? "pending-antigravity-conversation",
      reduceFinalText: appendOrReplaceGrowingAssistantMessage,
    });
  }

  async startTurn(
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.closed) throw new Error("Antigravity session is closed");
    if (this.activeProcess) throw new Error("Antigravity session already has an active turn");
    const turnId = randomUUID();
    this.pendingOutcome = null;
    this.assistantText = "";
    const args = [
      "--agent",
      this.profile.name,
      "--print",
      promptToText(prompt),
      "--output-format",
      "stream-json",
      "--print-timeout",
      DEFAULT_PRINT_TIMEOUT,
    ];
    if (this.conversationId) args.push("--conversation", this.conversationId);
    if (this.config.model) args.push("--model", this.config.model);
    if (this.currentModeId === FULL_ACCESS_MODE) {
      args.push("--dangerously-skip-permissions");
    } else {
      args.push("--mode", this.currentModeId);
    }
    if (options?.outputSchema) args.push("--json-schema", JSON.stringify(options.outputSchema));

    const child = spawn(this.executable, args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.activeProcess = child;
    let stderr = "";
    let spawnError: Error | null = null;
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleStreamLine(line, turnId));
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      lines.close();
      if (this.activeProcess === child) this.activeProcess = null;
      const pendingOutcome = this.pendingOutcome?.turnId === turnId ? this.pendingOutcome : null;
      this.pendingOutcome = null;
      if (spawnError || code !== 0) {
        const diagnostic =
          stderr.trim() ||
          [
            "Native AGY exited without writing stderr.",
            `Executable: ${this.executable}`,
            `Exit: ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}`,
            `Model: ${this.config.model ?? "provider default"}`,
            `Mode: ${this.currentModeId}`,
            "Check `agy models`, local authentication, and the selected model route.",
          ].join("\n");
        this.emit({
          type: "turn_failed",
          provider: this.provider,
          error:
            spawnError?.message ??
            `Antigravity exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
          diagnostic,
          turnId,
        });
      } else if (pendingOutcome?.type === "completed") {
        this.emit({
          type: "turn_completed",
          provider: this.provider,
          usage: pendingOutcome.usage,
          turnId,
        });
      } else {
        this.emit({
          type: "turn_failed",
          provider: this.provider,
          error: pendingOutcome?.error ?? "Antigravity stream ended without a result event",
          turnId,
        });
      }
    });
    this.emit({ type: "turn_started", provider: this.provider, turnId });
    return { turnId };
  }

  private handleStreamLine(line: string, turnId: string): void {
    let event: AntigravityStreamEvent;
    try {
      event = JSON.parse(line) as AntigravityStreamEvent;
    } catch (error) {
      this.logger.warn({ line, error }, "Dropped malformed Antigravity stream event");
      return;
    }
    const conversationId =
      event.conversation_id ?? event.init?.conversation_id ?? event.result?.conversation_id;
    if (conversationId && conversationId !== this.conversationId) {
      this.conversationId = conversationId;
      this.emit({ type: "thread_started", sessionId: conversationId, provider: this.provider });
    }
    if (event.event === "step_update" && event.step_update?.step_type === "agent_response") {
      const text = event.step_update.text_delta;
      if (text) {
        this.assistantText = text.startsWith(this.assistantText)
          ? text
          : `${this.assistantText}${text}`;
        this.emit({
          type: "timeline",
          provider: this.provider,
          turnId,
          item: { type: "assistant_message", text },
        });
      }
    }
    if (event.event === "result") {
      if (event.result?.status === "SUCCESS") {
        const response = event.result.response;
        if (response && response !== this.assistantText) {
          this.assistantText = response;
          this.emit({
            type: "timeline",
            provider: this.provider,
            turnId,
            item: { type: "assistant_message", text: response },
          });
        }
        this.pendingOutcome = {
          type: "completed",
          usage: toUsage(event.result.usage),
          turnId,
        };
      } else {
        this.pendingOutcome = {
          type: "failed",
          error: `Antigravity result status: ${event.result?.status ?? "UNKNOWN"}`,
          turnId,
        };
      }
    }
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private emit(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.conversationId,
      model: this.config.model ?? null,
      thinkingOptionId: null,
      modeId: this.currentModeId,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return MODES;
  }

  async getCurrentMode(): Promise<string | null> {
    return this.currentModeId;
  }

  async setMode(modeId: string): Promise<void> {
    if (!MODES.some((mode) => mode.id === modeId)) {
      throw new Error(`Unsupported Antigravity mode: ${modeId}`);
    }
    this.currentModeId = modeId;
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [];
  }

  async respondToPermission(_requestId: string, _response: AgentPermissionResponse): Promise<void> {
    throw new Error("Native Antigravity does not expose interactive permissions to Paseo");
  }

  describePersistence() {
    if (!this.conversationId) return null;
    return {
      provider: this.provider,
      sessionId: this.conversationId,
      nativeHandle: this.conversationId,
      metadata: { config: this.config },
    };
  }

  async interrupt(): Promise<void> {
    const child = this.activeProcess;
    if (!child) return;
    child.kill("SIGTERM");
    this.activeProcess = null;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.interrupt();
    await Promise.all([this.profile.cleanup(), this.gateway.close()]);
  }
}

export class AntigravityNativeAgentClient implements AgentClient {
  readonly capabilities = CAPABILITIES;
  private readonly providerId: string;
  private readonly label: string;
  private readonly command: readonly [string, ...string[]];
  private readonly env: Record<string, string>;
  private readonly profileRoot?: string;
  private readonly temporaryRoot?: string;
  private readonly resolveExecutable: (name: string) => Promise<string | null>;

  constructor(private readonly options: AntigravityNativeAgentClientOptions) {
    this.providerId = options.providerId ?? "gemini-antigravity";
    this.label = options.label ?? "Antigravity";
    this.command = options.command;
    this.env = options.env ?? {};
    this.profileRoot = options.profileRoot;
    this.temporaryRoot = options.temporaryRoot;
    this.resolveExecutable = options.resolveExecutable ?? findExecutable;
  }

  get provider(): AgentProvider {
    return this.providerId;
  }

  async listFeatures(): Promise<[]> {
    return [];
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return await this.createNativeSession(config, launchContext, null);
  }

  async resumeSession(
    handle: { sessionId: string; metadata?: Record<string, unknown> },
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const metadataConfig = handle.metadata?.config;
    const storedConfig =
      metadataConfig && typeof metadataConfig === "object" && !Array.isArray(metadataConfig)
        ? (metadataConfig as AgentSessionConfig)
        : ({ provider: this.provider, cwd: process.cwd() } satisfies AgentSessionConfig);
    return await this.createNativeSession(
      { ...storedConfig, ...overrides, provider: this.provider },
      launchContext,
      handle.sessionId,
    );
  }

  private async createNativeSession(
    config: AgentSessionConfig,
    launchContext: AgentLaunchContext | undefined,
    conversationId: string | null,
  ): Promise<AgentSession> {
    if (!launchContext?.roleBinding || !launchContext.paseoTools) {
      throw new Error("Native Antigravity requires role binding and caller-scoped Paseo tools");
    }
    const executable = await resolveAgyExecutable(this.command, this.resolveExecutable);
    const gateway = await startAntigravityPaseoGateway({
      catalog: launchContext.paseoTools,
      temporaryRoot: this.temporaryRoot,
      inheritedPath: this.env.PATH ?? launchContext.env?.PATH ?? process.env.PATH,
    });
    try {
      const profile = await materializeRoleProfile({
        launchContext,
        gatewayInstructions: gateway.instructions,
        profileRoot: this.profileRoot,
      });
      return new AntigravityNativeAgentSession(
        this.provider,
        executable,
        { ...config, provider: this.provider },
        { ...this.env, ...launchContext.env, ...gateway.env },
        profile,
        gateway,
        this.options.logger,
        conversationId,
      );
    } catch (error) {
      await gateway.close();
      throw error;
    }
  }

  async fetchCatalog(_options: FetchCatalogOptions): Promise<ProviderCatalog> {
    const executable = await resolveAgyExecutable(this.command, this.resolveExecutable);
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, ["models"], {
        env: { ...process.env, ...this.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let errorOutput = "";
      child.stdout.on("data", (chunk: Buffer | string) => (output += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer | string) => (errorOutput += chunk.toString()));
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve(output);
        else reject(new Error(errorOutput.trim() || `agy models exited with code ${code}`));
      });
    });
    return {
      models: parseModels(stdout, this.provider),
      modes: MODES,
      defaultModeId: FULL_ACCESS_MODE,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await resolveAgyExecutable(this.command, this.resolveExecutable);
      return true;
    } catch {
      return false;
    }
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    const executable = await resolveAgyExecutable(this.command, this.resolveExecutable);
    return { diagnostic: `${this.label}: native AGY executable ${executable}` };
  }
}

export function createAntigravityNativeClientFromRuntime(input: {
  logger: Logger;
  command: readonly [string, ...string[]];
  runtimeSettings?: ProviderRuntimeSettings;
  providerId?: string;
  label?: string;
}): AntigravityNativeAgentClient {
  return new AntigravityNativeAgentClient({
    logger: input.logger,
    command: input.command,
    env: input.runtimeSettings?.env,
    providerId: input.providerId,
    label: input.label,
  });
}
