import { describe, expect, it } from "vitest";
import { CouncilCaseRecordSchema } from "./types.js";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "../messages.js";

const NOW = "2026-08-10T10:00:00.000Z";

function councilRecord() {
  return {
    schemaVersion: 1,
    id: "case-1",
    title: "Boundary review",
    question: "Where should the boundary live?",
    tier: "debate-with-proof",
    phase: "review",
    roomId: "room-1",
    kickoffMessageId: "kickoff-1",
    scopeId: "workspace:workspace-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    parentAgentId: "lead-1",
    seats: [
      {
        role: "scout",
        round: "1",
        agentId: "scout-1",
        phase: "review",
        integrity: "valid",
        disposition: null,
        reportReceipt: {
          roomId: "room-1",
          kickoffMessageId: "kickoff-1",
          reportMessageId: "report-1",
          reportDigest: "a".repeat(64),
          authorAgentId: "scout-1",
          startSentinel: "SCOUT_COUNCIL_REPORT_V1",
          endSentinel: "SCOUT_COUNCIL_REPORT_END",
          createdAt: NOW,
        },
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("canonical Council contracts", () => {
  it("accepts the daemon-owned three-seat vocabulary", () => {
    expect(CouncilCaseRecordSchema.parse(councilRecord())).toMatchObject({
      id: "case-1",
      seats: [{ role: "scout", integrity: "valid" }],
    });
  });

  it("rejects a second role registry and malformed report digests", () => {
    expect(
      CouncilCaseRecordSchema.safeParse({
        ...councilRecord(),
        seats: [{ ...councilRecord().seats[0], role: "auditor" }],
      }).success,
    ).toBe(false);
    expect(
      CouncilCaseRecordSchema.safeParse({
        ...councilRecord(),
        seats: [
          {
            ...councilRecord().seats[0],
            reportReceipt: { ...councilRecord().seats[0].reportReceipt, reportDigest: "forged" },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CouncilCaseRecordSchema.safeParse({
        ...councilRecord(),
        seats: [councilRecord().seats[0], councilRecord().seats[0]],
      }).success,
    ).toBe(false);
    expect(
      CouncilCaseRecordSchema.safeParse({
        ...councilRecord(),
        seats: [
          {
            ...councilRecord().seats[0],
            reportReceipt: {
              ...councilRecord().seats[0].reportReceipt,
              authorAgentId: "different-agent",
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CouncilCaseRecordSchema.safeParse({
        ...councilRecord(),
        seats: [{ ...councilRecord().seats[0], reportReceipt: null }],
      }).success,
    ).toBe(false);
    expect(
      CouncilCaseRecordSchema.safeParse({
        ...councilRecord(),
        phase: "verdict",
      }).success,
    ).toBe(false);
  });

  it("carries canonical case lists through the correlated session protocol", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "council.case.list.request",
        requestId: "request-1",
      }),
    ).toMatchObject({ requestId: "request-1" });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "council.case.list.response",
        payload: { requestId: "request-1", cases: [councilRecord()], error: null },
      }),
    ).toMatchObject({ payload: { cases: [{ id: "case-1" }] } });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "council.case.updated",
        payload: { case: councilRecord() },
      }),
    ).toMatchObject({ payload: { case: { id: "case-1" } } });
  });
});
