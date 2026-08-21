import { describe, expect, it } from "vitest";
import type { CouncilAgentSource, CouncilCase } from "./model";
import {
  councilCaseScopeIdentity,
  councilRoleLabel,
  groupCouncilCases,
  isCouncilSeatReportReady,
} from "./model";

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

function summarizeCouncilWorkspace(council: CouncilCase) {
  return {
    workspaceId: council.workspaceId,
    seats: council.seats.map((seat) => seat.agent.id),
  };
}

function councilSeatAgentIds(council: CouncilCase): string[] {
  return council.seats.map((seat) => seat.agent.id);
}

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
    const independent = makeAgent(
      "independent",
      councilLabels("independent", { "council.integrity": "valid-round-1" }),
      {
        lastActivityAt: new Date("2026-08-10T10:01:00.000Z"),
      },
    );
    const verifier = makeAgent(
      "verifier",
      councilLabels("verifier", {
        "council.phase": "review",
        "council.round": "verify",
        "council.integrity": "valid-verification",
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
      reportSeatCount: 3,
      readyCount: 2,
      unavailableCount: 0,
      redundantCount: 0,
    });
    expect(council?.seats.map((seat) => seat.role)).toEqual([
      "independent",
      "challenger",
      "verifier",
    ]);
  });

  it("recognizes the native Scout, Solution Architect, and Reviewer Council seats", () => {
    const scout = makeAgent("scout", councilLabels("scout"));
    const reviewer = makeAgent("reviewer", councilLabels("reviewer"));
    const architect = makeAgent("architect", councilLabels("architect"));

    const council = groupCouncilCases([reviewer, scout, architect])[0];

    expect(council?.seats.map((seat) => seat.role)).toEqual(["scout", "architect", "reviewer"]);
    expect(councilRoleLabel("scout")).toBe("Scout");
    expect(councilRoleLabel("architect")).toBe("Solution Architect");
    expect(councilRoleLabel("reviewer")).toBe("Reviewer");
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

  it("requires explicit Lead-audited integrity before counting a finished report", () => {
    const ready = makeAgent(
      "ready",
      councilLabels("independent", { "council.integrity": "valid-audited-report" }),
    );
    const awaitingAudit = makeAgent("awaiting-audit", councilLabels("specialist"));
    const failed = makeAgent("failed", councilLabels("challenger"), { status: "error" });
    const working = makeAgent("working", councilLabels("verifier"), { status: "running" });

    const council = groupCouncilCases([ready, awaitingAudit, failed, working])[0];

    expect(council?.readyCount).toBe(1);
    expect(council?.unavailableCount).toBe(1);
    expect(council ? isCouncilSeatReportReady(council.seats[0]!) : false).toBe(true);
    expect(
      council
        ? isCouncilSeatReportReady(
            council.seats.find((seat) => seat.agent.id === "awaiting-audit")!,
          )
        : true,
    ).toBe(false);
  });

  it("counts only usable reports while preserving redundant replacements for audit", () => {
    const independent = makeAgent(
      "independent",
      councilLabels("independent", {
        "council.phase": "verdict",
        "council.integrity": "valid-native-provider-state",
        "council.disposition": "partial",
      }),
    );
    const challenger = makeAgent(
      "challenger",
      councilLabels("challenger", {
        "council.phase": "verdict",
        "council.integrity": "valid-codex-native",
        "council.disposition": "partial",
      }),
    );
    const replacement = makeAgent(
      "replacement",
      councilLabels("independent", {
        "council.phase": "verdict",
        "council.integrity": "redundant-aborted-replacement",
        "council.disposition": "partial",
      }),
      { lastActivityAt: new Date("2026-08-10T10:04:00.000Z") },
    );

    const council = groupCouncilCases([independent, challenger, replacement])[0];

    expect(council).toMatchObject({
      disposition: "partial",
      reportSeatCount: 2,
      readyCount: 2,
      unavailableCount: 0,
      redundantCount: 1,
    });
    expect(council?.seats.map((seat) => seat.integrity)).toEqual(["valid", "redundant", "valid"]);
    expect(council ? isCouncilSeatReportReady(council.seats[1]!) : true).toBe(false);
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

  it("keeps the same case ID isolated across workspaces", () => {
    const first = makeAgent("first", councilLabels("independent"), {
      workspaceId: "workspace-1",
      parentAgentId: "lead-1",
    });
    const second = makeAgent("second", councilLabels("challenger"), {
      workspaceId: "workspace-2",
      parentAgentId: "lead-2",
    });

    const councils = groupCouncilCases([first, second]);

    expect(councils).toHaveLength(2);
    expect(councils.map(summarizeCouncilWorkspace)).toEqual([
      { workspaceId: "workspace-1", seats: ["first"] },
      { workspaceId: "workspace-2", seats: ["second"] },
    ]);
  });

  it("fails closed across legacy seats that lack workspace identity", () => {
    const firstLead = makeAgent(
      "lead-1",
      {},
      {
        workspaceId: "shared-lead-workspace",
        parentAgentId: null,
        roleBinding: leadRoleBinding,
      },
    );
    const secondLead = makeAgent(
      "lead-2",
      {},
      {
        workspaceId: "shared-lead-workspace",
        parentAgentId: null,
        roleBinding: leadRoleBinding,
      },
    );
    const first = makeAgent("first", councilLabels("independent"), {
      workspaceId: undefined,
      parentAgentId: "lead-1",
    });
    const second = makeAgent("second", councilLabels("challenger"), {
      workspaceId: undefined,
      parentAgentId: "lead-2",
    });
    const unowned = makeAgent("unowned", councilLabels("verifier"), {
      workspaceId: undefined,
      parentAgentId: null,
    });

    const councils = groupCouncilCases([firstLead, secondLead, first, second, unowned]);

    expect(councils).toHaveLength(3);
    expect(councils.map(councilSeatAgentIds)).toEqual([["first"], ["second"], ["unowned"]]);
    expect(councils.map(councilCaseScopeIdentity)).toEqual([
      "parent:lead-1",
      "parent:lead-2",
      "agent:unowned",
    ]);
    expect(councils.map((council) => council.workspaceId)).toEqual([
      "shared-lead-workspace",
      "shared-lead-workspace",
      undefined,
    ]);
  });
});
