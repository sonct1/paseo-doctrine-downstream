import { describe, expect, test, vi } from "vitest";

import { runSignalCommand } from "./signal.js";

const lead = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Lead",
  status: "idle",
};
const signalAgent = vi.fn(async () => ({
  id: "signal-1",
  targetAgentId: lead.id,
  requestedByAgentId: null,
  kind: "handoff_recommended" as const,
  reason: "Context dilution",
  evidenceRefs: [],
  status: "pending" as const,
  createdAt: "2026-08-07T00:00:00.000Z",
  deliveredAt: null,
  resolvedAt: null,
}));

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(async () => ({
    fetchAgents: vi.fn(async () => ({ entries: [{ agent: lead }] })),
    signalAgent,
    close: vi.fn(async () => undefined),
  })),
  getDaemonHost: vi.fn(() => "ws://127.0.0.1:6767"),
  resolveAgentId: vi.fn((input: string) =>
    input === "Lead" || input === lead.id ? lead.id : null,
  ),
}));

describe("runSignalCommand", () => {
  test("sends a handoff recommendation without claiming delivery", async () => {
    const result = await runSignalCommand(
      "Lead",
      { kind: "handoff", reason: "Context dilution", evidence: ["room-message-1"] },
      {} as never,
    );

    expect(signalAgent).toHaveBeenCalledWith({
      agentId: lead.id,
      kind: "handoff_recommended",
      reason: "Context dilution",
      relatedAgentId: undefined,
      evidenceRefs: ["room-message-1"],
    });
    expect(result.data).toMatchObject({
      signalId: "signal-1",
      agentId: lead.id,
      status: "pending",
      delivered: false,
    });
  });
});
