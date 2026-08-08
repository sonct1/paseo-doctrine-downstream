import { randomUUID } from "node:crypto";
import type {
  LeadHandoffPacket,
  LeadHandoffTransition,
  PrepareLeadHandoffInput,
} from "@getpaseo/protocol/lead-handoff";

import type { AgentStorage, StoredAgentRecord } from "./agent-storage.js";
import { withAgentAuthorityLocks } from "./agent-authority-lock.js";

export interface LeadHandoffDependencies {
  agentStorage: Pick<AgentStorage, "get" | "upsert">;
  hasInFlightRun?: (agentId: string) => boolean;
  closePredecessorRuntime?: (agentId: string, signal: AbortSignal) => Promise<void>;
  predecessorRuntimeCloseTimeoutMs?: number;
}

const recordUpdates = new Map<string, Promise<unknown>>();
const DEFAULT_PREDECESSOR_RUNTIME_CLOSE_TIMEOUT_MS = 10_000;

async function closePredecessorWithinBoundary(
  close: (signal: AbortSignal) => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      close(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort("predecessor_runtime_close_timeout");
          reject(new Error("predecessor_runtime_close_timeout"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function updatePredecessorRecord<T>(
  dependencies: LeadHandoffDependencies,
  predecessorAgentId: string,
  update: (record: StoredAgentRecord) => { record: StoredAgentRecord; result: T },
): Promise<T> {
  const previous = recordUpdates.get(predecessorAgentId) ?? Promise.resolve();
  const current = previous.then(async () => {
    const record = await dependencies.agentStorage.get(predecessorAgentId);
    if (!record || record.internal || record.archivedAt) {
      throw new Error("Predecessor Lead " + predecessorAgentId + " is not available");
    }
    const next = update(record);
    await dependencies.agentStorage.upsert(next.record);
    return next.result;
  });
  recordUpdates.set(predecessorAgentId, current);
  try {
    return await current;
  } finally {
    if (recordUpdates.get(predecessorAgentId) === current) {
      recordUpdates.delete(predecessorAgentId);
    }
  }
}

async function requireAdjacentLeads(
  dependencies: LeadHandoffDependencies,
  predecessorAgentId: string,
  successorAgentId: string,
): Promise<{ workspaceId: string }> {
  if (predecessorAgentId === successorAgentId) {
    throw new Error("Adjacent-Lead handoff requires distinct predecessor and successor agents");
  }
  const [predecessor, successor] = await Promise.all([
    dependencies.agentStorage.get(predecessorAgentId),
    dependencies.agentStorage.get(successorAgentId),
  ]);
  if (!predecessor || predecessor.internal || predecessor.archivedAt) {
    throw new Error("Predecessor Lead " + predecessorAgentId + " is not available");
  }
  if (!successor || successor.internal || successor.archivedAt) {
    throw new Error("Successor Lead " + successorAgentId + " is not available");
  }
  if (predecessor.roleBinding?.roleId !== "lead" || successor.roleBinding?.roleId !== "lead") {
    throw new Error("Adjacent-Lead handoff requires two role-bound Leads");
  }
  if (successor.leadHandoffs?.some((packet) => packet.status === "predecessor_released")) {
    throw new Error(
      "A released predecessor identity cannot become a successor; create a fresh role-bound Lead",
    );
  }
  if (!predecessor.workspaceId || predecessor.workspaceId !== successor.workspaceId) {
    throw new Error("Adjacent-Lead handoff requires both Leads in the same workspace");
  }
  return { workspaceId: predecessor.workspaceId };
}

async function requirePredecessorLead(
  dependencies: LeadHandoffDependencies,
  predecessorAgentId: string,
): Promise<StoredAgentRecord> {
  const predecessor = await dependencies.agentStorage.get(predecessorAgentId);
  if (
    !predecessor ||
    predecessor.internal ||
    predecessor.archivedAt ||
    predecessor.roleBinding?.roleId !== "lead" ||
    !predecessor.workspaceId
  ) {
    throw new Error("Predecessor " + predecessorAgentId + " is not an available role-bound Lead");
  }
  return predecessor;
}

export async function prepareLeadHandoff(
  dependencies: LeadHandoffDependencies,
  input: PrepareLeadHandoffInput,
): Promise<LeadHandoffPacket> {
  const predecessor = await requirePredecessorLead(dependencies, input.predecessorAgentId);
  if (input.proposedSuccessorAgentId) {
    await requireAdjacentLeads(
      dependencies,
      input.predecessorAgentId,
      input.proposedSuccessorAgentId,
    );
  }
  if (input.currentWriteOwnerAgentId !== input.predecessorAgentId) {
    throw new Error(
      "Packet preparation requires the predecessor to remain the current write Owner",
    );
  }
  return updatePredecessorRecord(dependencies, input.predecessorAgentId, (record) => {
    const active = (record.leadHandoffs ?? []).find(
      (packet) => packet.status !== "predecessor_released" && packet.status !== "rejected",
    );
    if (active) {
      throw new Error("Active Lead handoff " + active.id + " already exists for this predecessor");
    }
    const packet: LeadHandoffPacket = {
      id: randomUUID(),
      workspaceId: predecessor.workspaceId as string,
      predecessorAgentId: input.predecessorAgentId,
      successorAgentId: input.proposedSuccessorAgentId ?? null,
      currentWriteOwnerAgentId: input.currentWriteOwnerAgentId,
      objective: input.objective,
      scope: input.scope,
      currentState: input.currentState,
      decisions: input.decisions,
      failedApproaches: input.failedApproaches,
      successfulPatterns: input.successfulPatterns,
      evidenceIndex: input.evidenceIndex,
      activeRisksAndBlockers: input.activeRisksAndBlockers,
      exactResumePoint: input.exactResumePoint,
      stopCondition: input.stopCondition,
      status: "packet_ready",
      createdAt: new Date().toISOString(),
      receipts: [],
    };
    return {
      record: { ...record, leadHandoffs: [...(record.leadHandoffs ?? []), packet] },
      result: packet,
    };
  });
}

const EXPECTED_STATUS: Record<LeadHandoffTransition, LeadHandoffPacket["status"]> = {
  successor_authorized: "packet_ready",
  successor_acknowledged: "successor_authorized",
  predecessor_released: "successor_acknowledged",
  rejected: "packet_ready",
};

export async function transitionLeadHandoff(
  dependencies: LeadHandoffDependencies,
  input: {
    predecessorAgentId: string;
    handoffId: string;
    transition: LeadHandoffTransition;
    actorAgentId: string | null;
    successorAgentId?: string;
    note: string;
  },
): Promise<LeadHandoffPacket> {
  if (input.transition === "successor_authorized") {
    if (!input.successorAgentId) {
      throw new Error("successor_authorized requires successorAgentId");
    }
    await requireAdjacentLeads(dependencies, input.predecessorAgentId, input.successorAgentId);
  }
  const transition = () =>
    updatePredecessorRecord(dependencies, input.predecessorAgentId, (record) => {
      const packets = record.leadHandoffs ?? [];
      const index = packets.findIndex((packet) => packet.id === input.handoffId);
      if (index < 0) {
        throw new Error("Lead handoff " + input.handoffId + " not found");
      }
      const packet = packets[index];
      const repeated = packet.receipts.find(
        (receipt) =>
          receipt.transition === input.transition &&
          receipt.actorAgentId === input.actorAgentId &&
          receipt.note === input.note,
      );
      if (repeated && packet.status === input.transition) {
        return { record, result: packet };
      }
      const expected = EXPECTED_STATUS[input.transition];
      if (packet.status !== expected) {
        throw new Error(
          "Lead handoff " +
            packet.id +
            " is " +
            packet.status +
            "; " +
            input.transition +
            " requires " +
            expected,
        );
      }
      if (
        input.transition === "successor_acknowledged" &&
        input.actorAgentId !== packet.successorAgentId
      ) {
        throw new Error("Only the designated successor Lead can acknowledge this handoff");
      }
      if (
        (input.transition === "successor_authorized" ||
          input.transition === "predecessor_released") &&
        input.actorAgentId !== null
      ) {
        throw new Error(input.transition + " requires an explicit Human-facing action");
      }
      if (
        input.transition === "rejected" &&
        input.actorAgentId !== null &&
        input.actorAgentId !== packet.successorAgentId
      ) {
        throw new Error("Only Human or the designated successor Lead can reject this handoff");
      }
      const transitioned: LeadHandoffPacket = {
        ...packet,
        ...(input.transition === "successor_authorized"
          ? { successorAgentId: input.successorAgentId as string }
          : {}),
        ...(input.transition === "predecessor_released"
          ? { currentWriteOwnerAgentId: packet.successorAgentId as string }
          : {}),
        status: input.transition,
        receipts: [
          ...packet.receipts,
          {
            transition: input.transition,
            actorAgentId: input.actorAgentId,
            note: input.note,
            at: new Date().toISOString(),
          },
        ],
      };
      const nextPackets = [...packets];
      nextPackets[index] = transitioned;
      return { record: { ...record, leadHandoffs: nextPackets }, result: transitioned };
    });

  if (input.transition !== "predecessor_released") {
    return transition();
  }
  if (!dependencies.hasInFlightRun) {
    throw new Error("predecessor_released requires runtime safe-boundary enforcement");
  }
  if (!dependencies.closePredecessorRuntime) {
    throw new Error("predecessor_released requires predecessor runtime closure");
  }
  const closePredecessorRuntime = dependencies.closePredecessorRuntime;
  const predecessor = await requirePredecessorLead(dependencies, input.predecessorAgentId);
  const packet = predecessor.leadHandoffs?.find((candidate) => candidate.id === input.handoffId);
  const successorAgentId = packet?.successorAgentId;
  if (!successorAgentId) {
    throw new Error("predecessor_released requires a designated successor Lead");
  }
  return withAgentAuthorityLocks([input.predecessorAgentId, successorAgentId], async () => {
    if (dependencies.hasInFlightRun?.(input.predecessorAgentId)) {
      throw new Error("Cannot release predecessor while it has an in-flight run");
    }
    await requireAdjacentLeads(dependencies, input.predecessorAgentId, successorAgentId);
    await closePredecessorWithinBoundary(
      (signal) => closePredecessorRuntime(input.predecessorAgentId, signal),
      dependencies.predecessorRuntimeCloseTimeoutMs ?? DEFAULT_PREDECESSOR_RUNTIME_CLOSE_TIMEOUT_MS,
    );
    return transition();
  });
}

export function hasReleasedAgentWriteLease(record: StoredAgentRecord | null): boolean {
  if (!record) return false;
  return Boolean(
    record.leadHandoffs?.some(
      (packet) =>
        packet.status === "predecessor_released" && packet.currentWriteOwnerAgentId !== record.id,
    ),
  );
}

export function assertAgentPromptLease(record: StoredAgentRecord | null): void {
  if (!record) return;
  const released = record.leadHandoffs?.find(
    (packet) =>
      packet.status === "predecessor_released" && packet.currentWriteOwnerAgentId !== record.id,
  );
  if (!released) return;
  throw new Error(
    `agent_write_lease_released: ${record.id}; successor=${released.currentWriteOwnerAgentId}; handoff=${released.id}`,
  );
}
