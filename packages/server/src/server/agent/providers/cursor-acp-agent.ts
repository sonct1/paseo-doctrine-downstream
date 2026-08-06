import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";

import type { AgentLaunchContext, AgentSessionConfig } from "../agent-sdk-types.js";
import type { ACPConfigFeatureOption, ACPSessionLaunchPreparation } from "./acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

interface CursorACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
  roleCapsuleRoot?: string;
}

const CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS = 10_000;
const CURSOR_CLIENT_CAPABILITY_META = {
  parameterizedModelPicker: true,
};

export const CURSOR_FAST_FEATURE_OPTION: ACPConfigFeatureOption = {
  id: "fast",
  configId: "fast",
  label: "Fast",
  description: "Cursor fast mode",
  tooltip: "Select Cursor fast mode",
  icon: "zap",
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function roleCapsuleCommand(
  command: readonly [string, ...string[]],
  capsuleDirectory: string,
  cwd: string,
): [string, ...string[]] {
  const acpIndexes = command.flatMap((argument, index) => (argument === "acp" ? [index] : []));
  const hasCallerWorkspace = command.some(
    (argument) => argument === "--workspace" || argument.startsWith("--workspace="),
  );
  if (acpIndexes.length !== 1 || hasCallerWorkspace) {
    throw new Error(
      "Cursor role binding requires exact 'cursor-agent ... acp' launch without a caller-supplied --workspace",
    );
  }
  const acpIndex = acpIndexes[0];
  return [
    command[0],
    ...command.slice(1, acpIndex),
    "--workspace",
    capsuleDirectory,
    "--add-dir",
    cwd,
    ...command.slice(acpIndex),
  ];
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
      throw new Error(`Cursor role capsule collision at '${path}'`, { cause: error });
    }
  }
}

export async function materializeCursorRoleCapsule(input: {
  command: readonly [string, ...string[]];
  cwd: string;
  launchContext: AgentLaunchContext;
  capsuleRoot?: string;
}): Promise<ACPSessionLaunchPreparation> {
  const roleBinding = input.launchContext.roleBinding;
  if (!roleBinding) {
    throw new Error("Cursor role capsule materialization requires an immutable role binding");
  }
  if (!input.launchContext.agentId) {
    throw new Error("Cursor role capsule materialization requires a stable Paseo agent ID");
  }

  const agentToken = sha256(input.launchContext.agentId).slice(0, 12);
  const bindingToken = sha256(roleBinding.instructions).slice(0, 12);
  const capsuleRoot = input.capsuleRoot ?? join(homedir(), ".paseo", "role-capsules", "cursor");
  const directory = join(capsuleRoot, `paseo-${roleBinding.roleId}-${agentToken}-${bindingToken}`);
  const rulesDirectory = join(directory, ".cursor", "rules");
  const rulePath = join(rulesDirectory, "paseo-role.mdc");
  const content = `---\ndescription: Bind the immutable Paseo ${roleBinding.roleId} contract\nalwaysApply: true\n---\n\n${roleBinding.instructions}\n`;

  await mkdir(rulesDirectory, { recursive: true, mode: 0o700 });
  await writeExclusiveOrVerify(rulePath, content);
  return {
    command: roleCapsuleCommand(input.command, directory, input.cwd),
  };
}

export class CursorACPAgentClient extends GenericACPAgentClient {
  private readonly roleCommand: [string, ...string[]];
  private readonly roleCapsuleRoot?: string;

  constructor(options: CursorACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      providerParams: options.providerParams,
      // cursor-agent publishes slash commands asynchronously via available_commands_update.
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS,
      clientCapabilityMeta: CURSOR_CLIENT_CAPABILITY_META,
      configFeatureOptions: [CURSOR_FAST_FEATURE_OPTION],
    });
    this.roleCommand = options.command;
    this.roleCapsuleRoot = options.roleCapsuleRoot;
  }

  protected override async prepareSessionLaunch(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<ACPSessionLaunchPreparation | undefined> {
    if (!launchContext?.roleBinding) {
      return super.prepareSessionLaunch(config, launchContext);
    }
    return materializeCursorRoleCapsule({
      command: this.roleCommand,
      cwd: config.cwd,
      launchContext,
      capsuleRoot: this.roleCapsuleRoot,
    });
  }
}
