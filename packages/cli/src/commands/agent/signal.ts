import type { Command } from "commander";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { CoordinationSignal } from "@getpaseo/protocol/coordination-signal";

import { connectToDaemon, getDaemonHost, resolveAgentId } from "../../utils/client.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

interface AgentSignalOptions extends CommandOptions {
  kind: string;
  reason: string;
  relatedAgent?: string;
  evidence?: string[];
}

interface AgentSignalResult {
  signalId: string;
  agentId: string;
  kind: CoordinationSignal["kind"];
  status: CoordinationSignal["status"];
  delivered: boolean;
}

const signalSchema: OutputSchema<AgentSignalResult> = {
  idField: "signalId",
  columns: [
    { header: "SIGNAL ID", field: "signalId" },
    { header: "AGENT ID", field: "agentId" },
    { header: "KIND", field: "kind" },
    { header: "STATUS", field: "status" },
    { header: "DELIVERED", field: "delivered" },
  ],
};

export async function runSignalCommand(
  agentIdArg: string,
  commandOptions: CommandOptions,
  _command: Command,
): Promise<SingleResult<AgentSignalResult>> {
  const options = commandOptions as AgentSignalOptions;
  const host = getDaemonHost({ host: options.host });
  let client: DaemonClient;
  try {
    client = await connectToDaemon({ host: options.host });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
    } satisfies CommandError;
  }

  try {
    if (options.kind !== "handoff" && options.kind !== "detach") {
      throw {
        code: "INVALID_SIGNAL_KIND",
        message: `Invalid signal kind: ${options.kind}. Use handoff or detach.`,
      } satisfies CommandError;
    }
    const payload = await client.fetchAgents({ filter: { includeArchived: true } });
    const agents = payload.entries.map((entry) => entry.agent);
    const agentId = resolveAgentId(agentIdArg, agents);
    if (!agentId) {
      throw {
        code: "AGENT_NOT_FOUND",
        message: `Agent not found: ${agentIdArg}`,
      } satisfies CommandError;
    }
    const relatedAgentId = options.relatedAgent
      ? resolveAgentId(options.relatedAgent, agents)
      : undefined;
    if (options.relatedAgent && !relatedAgentId) {
      throw {
        code: "RELATED_AGENT_NOT_FOUND",
        message: `Related agent not found: ${options.relatedAgent}`,
      } satisfies CommandError;
    }
    if (options.kind === "detach" && !relatedAgentId) {
      throw {
        code: "RELATED_AGENT_REQUIRED",
        message: "--related-agent is required for detach recommendations",
      } satisfies CommandError;
    }
    const signal = await client.signalAgent({
      agentId,
      kind: options.kind === "handoff" ? "handoff_recommended" : "detach_recommended",
      reason: options.reason,
      relatedAgentId: relatedAgentId ?? undefined,
      evidenceRefs: options.evidence,
    });
    return {
      type: "single",
      data: {
        signalId: signal.id,
        agentId,
        kind: signal.kind,
        status: signal.status,
        delivered: signal.deliveredAt !== null,
      },
      schema: signalSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
