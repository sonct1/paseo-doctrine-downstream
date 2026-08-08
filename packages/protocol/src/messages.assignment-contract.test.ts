import { describe, expect, test } from "vitest";
import { SessionInboundMessageSchema } from "./messages.js";

describe("create_agent_request assignment contract", () => {
  const baseRequest = {
    type: "create_agent_request" as const,
    requestId: "request-1",
    config: { provider: "codex" as const, cwd: "/repo" },
  };

  test("accepts an explicit role assignment envelope", () => {
    const parsed = SessionInboundMessageSchema.parse({
      ...baseRequest,
      roleId: "lead",
      assignment: {
        version: 1,
        disposition: "lead-direct",
        objective: "Inspect current bytes.",
        effectClass: "read-only",
        mutationBoundary: { mode: "no-write" },
        externalEffectBoundary: { mode: "denied" },
        evidence: "Return exact inspected paths.",
        handbackAndStop: "Stop after evidence handback.",
      },
    });

    expect(parsed).toMatchObject({
      type: "create_agent_request",
      assignment: { effectClass: "read-only" },
    });
  });

  test("keeps the assignment field optional for legacy non-role creates", () => {
    expect(SessionInboundMessageSchema.parse(baseRequest)).not.toHaveProperty("assignment");
  });
});
