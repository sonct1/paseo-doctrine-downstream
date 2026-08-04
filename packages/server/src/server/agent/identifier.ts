import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";

export interface ResolveAgentIdentifierInput {
  identifier: string;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
}

export type ResolveAgentIdentifierResult =
  | { ok: true; agentId: string }
  | { ok: false; error: string };

export async function resolveAgentIdentifier(
  input: ResolveAgentIdentifierInput,
): Promise<ResolveAgentIdentifierResult> {
  const trimmed = input.identifier.trim();
  if (!trimmed) {
    return { ok: false, error: "Agent identifier cannot be empty" };
  }

  const stored = await input.agentStorage.list();
  const storedRecords = stored.filter((record) => !record.internal);
  const knownIds = new Set(storedRecords.map((record) => record.id));
  for (const agent of input.agentManager.listAgents()) {
    knownIds.add(agent.id);
  }

  if (knownIds.has(trimmed)) {
    return { ok: true, agentId: trimmed };
  }

  const prefixMatches = Array.from(knownIds).filter((id) => id.startsWith(trimmed));
  if (prefixMatches.length === 1) {
    return { ok: true, agentId: prefixMatches[0] };
  }
  if (prefixMatches.length > 1) {
    return {
      ok: false,
      error: `Agent identifier "${trimmed}" is ambiguous (${formatAgentIds(prefixMatches)})`,
    };
  }

  const titleMatches = storedRecords.filter((record) => record.title === trimmed);
  if (titleMatches.length === 1) {
    return { ok: true, agentId: titleMatches[0].id };
  }
  if (titleMatches.length > 1) {
    return {
      ok: false,
      error: `Agent title "${trimmed}" is ambiguous (${formatAgentIds(
        titleMatches.map((record) => record.id),
      )})`,
    };
  }

  return { ok: false, error: `Agent not found: ${trimmed}` };
}

function formatAgentIds(agentIds: string[]): string {
  const displayedIds = agentIds.slice(0, 5).map((id) => id.slice(0, 8));
  return `${displayedIds.join(", ")}${agentIds.length > 5 ? ", …" : ""}`;
}
