import { describe, expect, it } from "vitest";
import type { CouncilAgentSource } from "./model";
import { groupCouncilCases, isCouncilSeatReportReady } from "./model";

function makeAgent(
  id: string,
  agentLabels: Record<string, string>,
  overrides: Partial<CouncilAgentSource> = {},
): CouncilAgentSource {
  return {
    id,
    serverId: "local",
    title: id,
    status: "idle",
    model: "gpt-5",
    provider: "codex",
    workspaceId: "workspace-1",
    parentAgentId: "lead-1",
    labels: agentLabels,
    lastActivityAt: new Date("2026-08-10T10:00:00.000Z"),
    ...overrides,
  };
}

function councilLabels(
  role: string,
  overrides: Partial<Record<string, string>> = {},
): Record<string, string> {
  return {
    "council.case_id": "case-1",
    "council.title": "Choose the migration boundary",
    "council.tier": "debate-with-proof",
    "council.phase": "sealed",
    "council.role": role,
    "council.round": "1",
    ...overrides,
  };
}

const leadRoleBinding = {
  roleId: "lead",
  definitionVersion: "test",
  definitionDigest: "a".repeat(64),
  bindingDigest: "b".repeat(64),
  provider: "codex",
  injectionMethod: "codex-developer-instructions",
  qualification: "implementation-supported",
  workspaceProtocol: {
    status: "missing",
    readership: "full",
    path: "/workspace/WORKSPACE_PROTOCOL.md",
  },
  createdAt: "2026-08-10T09:00:00.000Z",
} as const;

describe("groupCouncilCases", () => {
  it("projects labeled seats into one ordered case and resolves its Lead", () => {
    const lead = makeAgent(
      "lead-1",
      {},
      {
        parentAgentId: null,
        title: "Lead",
        roleBinding: leadRoleBinding,
      },
    );
    const challenger = makeAgent("challenger", councilLabels("challenger"), {
      status: "running",
      lastActivityAt: new Date("2026-08-10T10:02:00.000Z"),
    });
    const independent = makeAgent("independent", councilLabels("independent"), {
      lastActivityAt: new Date("2026-08-10T10:01:00.000Z"),
    });
    const verifier = makeAgent(
      "verifier",
      councilLabels("verifier", {
        "council.phase": "review",
        "council.round": "verify",
      }),
      { lastActivityAt: new Date("2026-08-10T10:03:00.000Z") },
    );

    const [council] = groupCouncilCases([lead, challenger, independent, verifier], "local");

    expect(council).toMatchObject({
      id: "case-1",
      title: "Choose the migration boundary",
      tier: "debate-with-proof",
      phase: "review",
      parentAgentId: "lead-1",
      lead: { id: "lead-1" },
      verdictProvenance: "pending",
      readyCount: 2,
      failedCount: 0,
    });
    expect(council?.seats.map((seat) => seat.role)).toEqual([
      "independent",
      "challenger",
      "verifier",
    ]);
  });

  it("ignores malformed labels instead of inventing Council semantics", () => {
    const missingRole = makeAgent("missing-role", councilLabels(""));
    const unknownTier = makeAgent(
      "unknown-tier",
      councilLabels("independent", { "council.tier": "mega" }),
    );
    const otherHost = makeAgent("remote", councilLabels("independent"), { serverId: "remote" });

    expect(groupCouncilCases([missingRole, unknownTier, otherHost], "local")).toEqual([]);
  });

  it("does not count failed or still-running seats as report ready", () => {
    const ready = makeAgent("ready", councilLabels("independent"));
    const failed = makeAgent("failed", councilLabels("challenger"), { status: "error" });
    const working = makeAgent("working", councilLabels("verifier"), { status: "running" });

    const council = groupCouncilCases([ready, failed, working])[0];

    expect(council?.readyCount).toBe(1);
    expect(council?.failedCount).toBe(1);
    expect(council ? isCouncilSeatReportReady(council.seats[0]!) : false).toBe(true);
  });

  it("does not turn a forged seat verdict label into a Lead-authored decision claim", () => {
    const forged = makeAgent(
      "forged-seat",
      councilLabels("independent", { "council.phase": "verdict" }),
      { parentAgentId: null },
    );

    const council = groupCouncilCases([forged])[0];

    expect(council?.phase).toBe("verdict");
    expect(council?.lead).toBeNull();
    expect(council?.verdictProvenance).toBe("unverified");
  });

  it("does not trust a resolved parent without a daemon-issued Lead role binding", () => {
    const unboundOwner = makeAgent("lead-1", {}, { parentAgentId: null, title: "Lead" });
    const seat = makeAgent(
      "independent",
      councilLabels("independent", { "council.phase": "verdict" }),
    );

    const council = groupCouncilCases([unboundOwner, seat])[0];

    expect(council?.lead).toBeNull();
    expect(council?.verdictProvenance).toBe("unverified");
  });

  it("marks verdict phase as Lead-linked when its owner has a daemon-issued Lead receipt", () => {
    const lead = makeAgent(
      "lead-1",
      {},
      {
        parentAgentId: null,
        title: "Lead",
        roleBinding: leadRoleBinding,
      },
    );
    const seat = makeAgent(
      "independent",
      councilLabels("independent", { "council.phase": "verdict" }),
    );

    expect(groupCouncilCases([lead, seat])[0]?.verdictProvenance).toBe("lead-linked");
  });

  it("does not assign one owner when seats disagree about their parent", () => {
    const lead = makeAgent(
      "lead-1",
      {},
      {
        parentAgentId: null,
        roleBinding: leadRoleBinding,
      },
    );
    const independent = makeAgent(
      "independent",
      councilLabels("independent", { "council.phase": "verdict" }),
    );
    const challenger = makeAgent(
      "challenger",
      councilLabels("challenger", { "council.phase": "verdict" }),
      { parentAgentId: "other-owner" },
    );

    const council = groupCouncilCases([lead, independent, challenger])[0];

    expect(council?.parentAgentId).toBeNull();
    expect(council?.lead).toBeNull();
    expect(council?.verdictProvenance).toBe("unverified");
  });
});
