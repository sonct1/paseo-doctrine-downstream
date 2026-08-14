import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";
import type { AgentUsage } from "@getpaseo/protocol/agent-types";
import type { Logger } from "pino";

import type { AgentManager, AgentManagerEvent, ManagedAgent } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import {
  requestCoordinationSignal,
  updateCoordinationPolicyState,
  type CoordinationSignalDependencies,
} from "./coordination-signals.js";

const NATIVE_POLICY_VERSION = 1;
const CONTEXT_PRESSURE_RATIO = 0.85;
const FAILURE_ATTENTION_THRESHOLD = 3;
export const NATIVE_COORDINATION_POLICY_FLAG = "PASEO_ENABLE_NATIVE_COORDINATION_POLICY";

export function nativeCoordinationPolicyEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment[NATIVE_COORDINATION_POLICY_FLAG] === "1";
}

type NativeCoordinationAgentManager = Pick<
  AgentManager,
  "getAgent" | "hasInFlightRun" | "listAgents" | "notifyAgentState" | "subscribe"
>;

export interface NativeCoordinationPolicyDependencies extends CoordinationSignalDependencies {
  agentManager: NativeCoordinationAgentManager;
  agentStorage: Pick<AgentStorage, "get" | "upsert" | "list">;
  logger: Logger;
}

function findUniqueRoleAgent(
  agentManager: NativeCoordinationAgentManager,
  workspaceId: string | undefined,
  roleId: "lead" | "supervisor",
): ManagedAgent | null {
  if (!workspaceId) return null;
  const matches = agentManager
    .listAgents()
    .filter(
      (agent) =>
        agent.workspaceId === workspaceId &&
        agent.roleBinding?.roleId === roleId &&
        agent.lifecycle !== "closed",
    );
  return matches.length === 1 ? matches[0] : null;
}

function findLeadForPeer(
  agentManager: NativeCoordinationAgentManager,
  peer: ManagedAgent,
): ManagedAgent | null {
  const parentId = getParentAgentIdFromLabels(peer.labels);
  if (parentId) {
    const parent = agentManager.getAgent(parentId);
    if (
      parent?.roleBinding?.roleId === "lead" &&
      parent.lifecycle !== "closed" &&
      parent.workspaceId === peer.workspaceId
    ) {
      return parent;
    }
  }
  return findUniqueRoleAgent(agentManager, peer.workspaceId, "lead");
}

interface FailureRoute {
  target: ManagedAgent | null;
  recipientRole: "lead" | "supervisor";
  severity: "warning" | "critical";
  ruleId: "peer_repeated_failure" | "lead_repeated_failure";
  reason: string;
}

function resolveFailureRoute(
  agentManager: NativeCoordinationAgentManager,
  agent: ManagedAgent,
): FailureRoute | null {
  if (agent.roleBinding?.roleId === "peer") {
    return {
      target: findLeadForPeer(agentManager, agent),
      recipientRole: "lead",
      severity: "warning",
      ruleId: "peer_repeated_failure",
      reason:
        "A Peer reached the repeated runtime-failure threshold; Lead retains routing authority.",
    };
  }
  if (agent.roleBinding?.roleId === "lead") {
    return {
      target: findUniqueRoleAgent(agentManager, agent.workspaceId, "supervisor"),
      recipientRole: "supervisor",
      severity: "critical",
      ruleId: "lead_repeated_failure",
      reason:
        "Lead reached the repeated runtime-failure threshold and may be unable to self-recover.",
    };
  }
  return null;
}

function contextRatio(usage: AgentUsage): number | null {
  const used = usage.contextWindowUsedTokens;
  const maximum = usage.contextWindowMaxTokens;
  if (
    typeof used !== "number" ||
    !Number.isFinite(used) ||
    used < 0 ||
    typeof maximum !== "number" ||
    !Number.isFinite(maximum) ||
    maximum <= 0
  ) {
    return null;
  }
  return used / maximum;
}

async function handleContextUsage(
  dependencies: NativeCoordinationPolicyDependencies,
  agent: ManagedAgent,
  usage: AgentUsage,
): Promise<void> {
  if (agent.roleBinding?.roleId !== "lead") return;
  const ratio = contextRatio(usage);
  if (ratio === null) return;
  const shouldNotify = await updateCoordinationPolicyState(dependencies, agent.id, (state) => ({
    state: {
      ...state,
      lastContextRatio: ratio,
      contextPressureAttentionSent:
        state.contextPressureAttentionSent || ratio >= CONTEXT_PRESSURE_RATIO,
    },
    result: ratio >= CONTEXT_PRESSURE_RATIO && !state.contextPressureAttentionSent,
  }));
  if (!shouldNotify) return;
  await requestCoordinationSignal(dependencies, {
    targetAgentId: agent.id,
    requestedByAgentId: null,
    kind: "continuity_attention",
    trigger: "context_pressure",
    severity: "warning",
    recipientRole: "lead",
    source: { kind: "paseo", ruleId: "lead_context_pressure", version: NATIVE_POLICY_VERSION },
    reason: "Lead context crossed the native continuity-review threshold.",
    evidence: {
      provider: agent.provider,
      contextWindowUsedTokens: usage.contextWindowUsedTokens ?? null,
      contextWindowMaxTokens: usage.contextWindowMaxTokens ?? null,
      contextRatio: Number(ratio.toFixed(4)),
      threshold: CONTEXT_PRESSURE_RATIO,
    },
  });
}

async function handleAutomaticCompaction(
  dependencies: NativeCoordinationPolicyDependencies,
  agent: ManagedAgent,
  event: Extract<AgentManagerEvent, { type: "agent_stream" }>,
): Promise<void> {
  if (
    agent.roleBinding?.roleId !== "lead" ||
    event.event.type !== "timeline" ||
    event.event.item.type !== "compaction" ||
    event.event.item.status !== "completed" ||
    event.event.item.trigger === "manual"
  ) {
    return;
  }
  const shouldNotify = await updateCoordinationPolicyState(dependencies, agent.id, (state) => ({
    state: {
      ...state,
      automaticCompactionCount: state.automaticCompactionCount + 1,
      automaticCompactionAttentionSent: true,
    },
    result: !state.automaticCompactionAttentionSent,
  }));
  if (!shouldNotify) return;
  await requestCoordinationSignal(dependencies, {
    targetAgentId: agent.id,
    requestedByAgentId: null,
    kind: "continuity_attention",
    trigger: "automatic_compaction",
    severity: "warning",
    recipientRole: "lead",
    source: {
      kind: "paseo",
      ruleId: "lead_automatic_compaction",
      version: NATIVE_POLICY_VERSION,
    },
    reason: "The provider compacted Lead context; review continuity at this safe boundary.",
    evidence: {
      provider: agent.provider,
      trigger: event.event.item.trigger ?? "provider_unspecified",
      preTokens: event.event.item.preTokens ?? null,
    },
  });
}

async function handleTerminalEvent(
  dependencies: NativeCoordinationPolicyDependencies,
  agent: ManagedAgent,
  event: Extract<AgentManagerEvent, { type: "agent_stream" }>,
): Promise<void> {
  const roleId = agent.roleBinding?.roleId;
  if (roleId !== "lead" && roleId !== "peer") return;
  if (event.event.type === "turn_completed" || event.event.type === "turn_canceled") {
    await updateCoordinationPolicyState(dependencies, agent.id, (state) => ({
      state: { ...state, consecutiveTurnFailures: 0, failureAttentionSent: false },
      result: undefined,
    }));
    return;
  }
  if (event.event.type !== "turn_failed") return;
  const route = resolveFailureRoute(dependencies.agentManager, agent);
  if (!route) return;

  const outcome = await updateCoordinationPolicyState(dependencies, agent.id, (state) => {
    const consecutiveTurnFailures = state.consecutiveTurnFailures + 1;
    const notify =
      consecutiveTurnFailures >= FAILURE_ATTENTION_THRESHOLD &&
      !state.failureAttentionSent &&
      route.target !== null;
    return {
      state: {
        ...state,
        consecutiveTurnFailures,
        failureAttentionSent: state.failureAttentionSent || notify,
      },
      result: {
        notify,
        crossedThreshold: consecutiveTurnFailures === FAILURE_ATTENTION_THRESHOLD,
      },
    };
  });
  if (!outcome.notify || !route.target) {
    if (!route.target && outcome.crossedThreshold && route.recipientRole === "supervisor") {
      dependencies.logger.warn(
        { agentId: agent.id, workspaceId: agent.workspaceId },
        "Lead failure attention has no unique Supervisor target",
      );
    }
    return;
  }
  await requestCoordinationSignal(dependencies, {
    targetAgentId: route.target.id,
    requestedByAgentId: null,
    kind: "continuity_attention",
    trigger: "repeated_failure",
    severity: route.severity,
    recipientRole: route.recipientRole,
    source: {
      kind: "paseo",
      ruleId: route.ruleId,
      version: NATIVE_POLICY_VERSION,
    },
    reason: route.reason,
    relatedAgentId: agent.id,
    evidence: {
      provider: agent.provider,
      consecutiveTurnFailures: FAILURE_ATTENTION_THRESHOLD,
      lastError: event.event.error,
    },
  });
}

async function handleEvent(
  dependencies: NativeCoordinationPolicyDependencies,
  event: AgentManagerEvent,
): Promise<void> {
  if (event.type !== "agent_stream") return;
  const agent = dependencies.agentManager.getAgent(event.agentId);
  if (!agent?.roleBinding || agent.internal) return;

  if (event.event.type === "usage_updated") {
    await handleContextUsage(dependencies, agent, event.event.usage);
  } else if (event.event.type === "turn_completed" && event.event.usage) {
    await handleContextUsage(dependencies, agent, event.event.usage);
  }
  await handleAutomaticCompaction(dependencies, agent, event);
  await handleTerminalEvent(dependencies, agent, event);
}

export function startNativeCoordinationPolicy(
  dependencies: NativeCoordinationPolicyDependencies,
): () => void {
  const queues = new Map<string, Promise<void>>();
  const unsubscribe = dependencies.agentManager.subscribe(
    (event) => {
      if (event.type !== "agent_stream") return;
      const previous = queues.get(event.agentId) ?? Promise.resolve();
      const current = previous
        .then(() => handleEvent(dependencies, event))
        .catch((error) => {
          dependencies.logger.warn(
            { err: error, agentId: event.agentId },
            "Native coordination policy failed to process telemetry",
          );
        })
        .finally(() => {
          if (queues.get(event.agentId) === current) queues.delete(event.agentId);
        });
      queues.set(event.agentId, current);
    },
    { replayState: false },
  );
  return () => {
    unsubscribe();
    queues.clear();
  };
}
