import { describe, expect, test } from "vitest";

import { LeadHandoffPacketSchema, PrepareLeadHandoffInputSchema } from "./lead-handoff.js";

const input = {
  predecessorAgentId: "lead-old",
  currentWriteOwnerAgentId: "lead-old",
  objective: "Continue a bounded objective",
  scope: ["packages/server"],
  currentState: "P1 produced a successor rejection",
  decisions: ["Use explicit transition receipts"],
  failedApproaches: ["Narrative packet omitted evidence"],
  successfulPatterns: ["Independent successor review"],
  evidenceIndex: [{ ref: "agent:successor", claim: "Rejected incomplete packet" }],
  activeRisksAndBlockers: ["Lease is recorded, not runtime-enforced"],
  exactResumePoint: "Start from the validated packet",
  stopCondition: "Stop before lifecycle mutation",
};

describe("LeadHandoffPacketSchema", () => {
  test("requires the P1 falsification fields", () => {
    expect(PrepareLeadHandoffInputSchema.parse(input)).toEqual(input);
    for (const field of [
      "currentWriteOwnerAgentId",
      "failedApproaches",
      "successfulPatterns",
      "evidenceIndex",
      "activeRisksAndBlockers",
      "exactResumePoint",
    ] as const) {
      const incomplete = { ...input };
      delete incomplete[field];
      expect(() => PrepareLeadHandoffInputSchema.parse(incomplete)).toThrow();
    }
  });

  test("parses an ordered receipt-bearing packet", () => {
    expect(
      LeadHandoffPacketSchema.parse({
        id: "handoff-1",
        workspaceId: "workspace-1",
        ...input,
        successorAgentId: "lead-new",
        status: "successor_authorized",
        createdAt: "2026-08-08T00:00:00.000Z",
        receipts: [
          {
            transition: "successor_authorized",
            actorAgentId: null,
            note: "Human authorization",
            at: "2026-08-08T00:01:00.000Z",
          },
        ],
      }),
    ).toMatchObject({ status: "successor_authorized" });
  });
});
