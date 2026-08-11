import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Logger } from "pino";

import { findExecutable } from "../../../executable-resolution/executable-resolution.js";
import type { AgentLaunchContext, AgentSessionConfig } from "../agent-sdk-types.js";
import type { ACPSessionLaunchPreparation, SessionStateResponse } from "./acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

interface AntigravityACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
  roleProfileRoot?: string;
  roleTemporaryRoot?: string;
  resolveExecutable?: (name: string) => Promise<string | null>;
}

function splitAntigravityModelValue(value: string): { value: string; label: string | null } {
  const separator = value.indexOf("\t");
  if (separator < 0) {
    return { value: value.trim(), label: null };
  }
  const id = value.slice(0, separator).trim();
  const label = value.slice(separator + 1).trim();
  return {
    value: id || value.trim(),
    label: label || null,
  };
}

export function transformAntigravitySessionResponse(
  response: SessionStateResponse,
): SessionStateResponse {
  if (!response.models) {
    return response;
  }

  return {
    ...response,
    models: {
      ...response.models,
      currentModelId: response.models.currentModelId
        ? splitAntigravityModelValue(response.models.currentModelId).value
        : response.models.currentModelId,
      availableModels: response.models.availableModels.map((model) => {
        const modelId = splitAntigravityModelValue(model.modelId);
        const modelName = splitAntigravityModelValue(model.name);
        return {
          ...model,
          modelId: modelId.value,
          name: modelName.label ?? modelId.label ?? modelName.value,
        };
      }),
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function roleAgentName(launchContext: AgentLaunchContext): string {
  const roleBinding = launchContext.roleBinding;
  if (!roleBinding) {
    throw new Error("Antigravity role materialization requires an immutable role binding");
  }
  const agentToken = sha256(launchContext.agentId ?? "missing-agent-id").slice(0, 12);
  const bindingToken = sha256(roleBinding.instructions).slice(0, 12);
  return `paseo-${roleBinding.roleId}-${agentToken}-${bindingToken}`;
}

function buildRoleProfile(agentName: string, launchContext: AgentLaunchContext): string {
  const roleBinding = launchContext.roleBinding;
  if (!roleBinding) {
    throw new Error("Antigravity role materialization requires an immutable role binding");
  }
  return `---\nname: ${agentName}\ndescription: Immutable Paseo ${roleBinding.roleId} role binding\nmainAgent: true\nsubagent: false\n---\n\n${roleBinding.instructions}\n`;
}

async function writeExclusiveOrVerify(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const existing = await readFile(path, "utf8");
    if (existing !== content) {
      throw new Error(`Antigravity role profile collision at '${path}'`, { cause: error });
    }
  }
}

async function removeProfileIfExact(input: {
  profilePath: string;
  profileDirectory: string;
  expectedContent: string;
}): Promise<void> {
  try {
    const current = await readFile(input.profilePath, "utf8");
    if (current === input.expectedContent) {
      await rm(input.profileDirectory, { recursive: true, force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function resolveAgyBinary(input: {
  command: readonly [string, ...string[]];
  resolveExecutable: (name: string) => Promise<string | null>;
}): Promise<{ binary: string; binaryValueIndex: number }> {
  const flagIndexes = input.command.flatMap((argument, index) =>
    argument === "--agy-binary" ? [index] : [],
  );
  if (flagIndexes.length !== 1) {
    throw new Error("Antigravity role binding requires exactly one --agy-binary argument");
  }
  const binaryValueIndex = flagIndexes[0] + 1;
  const configuredBinary = input.command[binaryValueIndex];
  if (!configuredBinary) {
    throw new Error("Antigravity role binding requires a value after --agy-binary");
  }
  let binary: string | null = null;
  if (isAbsolute(configuredBinary) || configuredBinary === "agy") {
    binary = await input.resolveExecutable(configuredBinary);
  }
  if (!binary || !isAbsolute(binary)) {
    throw new Error(
      "Antigravity role binding requires --agy-binary to resolve to an absolute executable",
    );
  }
  return { binary, binaryValueIndex };
}

export async function materializeAntigravityRoleLaunch(input: {
  command: readonly [string, ...string[]];
  launchContext: AgentLaunchContext;
  profileRoot?: string;
  temporaryRoot?: string;
  resolveExecutable?: (name: string) => Promise<string | null>;
}): Promise<ACPSessionLaunchPreparation> {
  if (process.platform === "win32") {
    throw new Error("Antigravity native role binding is not implemented on Windows");
  }
  if (!input.launchContext.roleBinding) {
    throw new Error("Antigravity role materialization requires an immutable role binding");
  }
  if (!input.launchContext.agentId) {
    throw new Error("Antigravity role materialization requires a stable Paseo agent ID");
  }
  if (input.command.some((argument) => argument === "--agent" || argument.startsWith("--agent="))) {
    throw new Error("Antigravity role binding rejects caller-supplied --agent arguments");
  }

  const { binary, binaryValueIndex } = await resolveAgyBinary({
    command: input.command,
    resolveExecutable: input.resolveExecutable ?? findExecutable,
  });
  const agentName = roleAgentName(input.launchContext);
  const profileContent = buildRoleProfile(agentName, input.launchContext);
  const profileRoot = input.profileRoot ?? join(homedir(), ".gemini", "config", "agents");
  const profileDirectory = join(profileRoot, agentName);
  const profilePath = join(profileDirectory, "agent.md");
  const wrapperDirectory = await mkdtemp(
    join(input.temporaryRoot ?? tmpdir(), "paseo-antigravity-role-"),
  );
  const wrapperPath = join(wrapperDirectory, "agy-role");

  try {
    await mkdir(profileDirectory, { recursive: true, mode: 0o700 });
    await writeExclusiveOrVerify(profilePath, profileContent);
    const wrapper = `#!/bin/sh\nset -eu\nfor argument do\n  case "$argument" in\n    --agent|--agent=*)\n      echo "paseo-antigravity-role: caller must not override --agent" >&2\n      exit 64\n      ;;\n  esac\ndone\nif [ "\${1-}" = "models" ]; then\n  exec ${shellQuote(binary)} "$@"\nfi\nexec ${shellQuote(binary)} --agent ${shellQuote(agentName)} "$@"\n`;
    await writeFile(wrapperPath, wrapper, { encoding: "utf8", mode: 0o700 });

    const command = [...input.command] as [string, ...string[]];
    command[binaryValueIndex] = wrapperPath;
    return {
      command,
      cleanup: async () => {
        try {
          await removeProfileIfExact({
            profilePath,
            profileDirectory,
            expectedContent: profileContent,
          });
        } finally {
          await rm(wrapperDirectory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await removeProfileIfExact({
      profilePath,
      profileDirectory,
      expectedContent: profileContent,
    });
    await rm(wrapperDirectory, { recursive: true, force: true });
    throw error;
  }
}

export class AntigravityACPAgentClient extends GenericACPAgentClient {
  private readonly roleCommand: [string, ...string[]];
  private readonly roleProfileRoot?: string;
  private readonly roleTemporaryRoot?: string;
  private readonly resolveRoleExecutable?: (name: string) => Promise<string | null>;

  constructor(options: AntigravityACPAgentClientOptions) {
    super({
      ...options,
      sessionResponseTransformer: transformAntigravitySessionResponse,
    });
    this.roleCommand = options.command;
    this.roleProfileRoot = options.roleProfileRoot;
    this.roleTemporaryRoot = options.roleTemporaryRoot;
    this.resolveRoleExecutable = options.resolveExecutable;
  }

  protected override async prepareSessionLaunch(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<ACPSessionLaunchPreparation | undefined> {
    if (!launchContext?.roleBinding) {
      return super.prepareSessionLaunch(config, launchContext);
    }
    return materializeAntigravityRoleLaunch({
      command: this.roleCommand,
      launchContext,
      profileRoot: this.roleProfileRoot,
      temporaryRoot: this.roleTemporaryRoot,
      resolveExecutable: this.resolveRoleExecutable,
    });
  }
}
