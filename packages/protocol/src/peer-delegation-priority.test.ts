import { describe, expect, test } from "vitest";
import {
  orderPeerDelegationProfiles,
  resolvePeerDelegationProviderPriority,
  selectPeerDelegationProfileForSubrole,
  selectPeerDelegationProfiles,
} from "./peer-delegation-priority.js";

const profiles = [
  { id: "claude-scout", provider: "claude", peerSubrole: "scout" as const },
  { id: "codex-engineer", provider: "codex", peerSubrole: "engineer" as const },
  { id: "cursor-reviewer", provider: "cursor", peerSubrole: "reviewer" as const },
  { id: "claude-architect", provider: "claude", peerSubrole: "architect" as const },
  { id: "claude-engineer", provider: "claude", peerSubrole: "engineer" as const },
];

describe("Peer delegation provider priority", () => {
  test("keeps selected profile order while dropping duplicate and stale ids", () => {
    expect(
      selectPeerDelegationProfiles(profiles, [
        "cursor-reviewer",
        "missing",
        "claude-scout",
        "cursor-reviewer",
      ]),
    ).toEqual([profiles[2], profiles[0]]);
  });

  test("keeps configured selected providers first and appends newly selected providers", () => {
    expect(
      resolvePeerDelegationProviderPriority(
        profiles,
        ["claude-scout", "codex-engineer", "cursor-reviewer", "claude-architect"],
        ["cursor", "stale", "cursor", "claude"],
      ),
    ).toEqual(["cursor", "claude", "codex"]);
  });

  test("orders profiles by provider rank and remains stable within each provider", () => {
    expect(orderPeerDelegationProfiles(profiles, ["cursor", "claude", "codex"])).toEqual([
      profiles[2],
      profiles[0],
      profiles[3],
      profiles[4],
      profiles[1],
    ]);
  });

  test("selects the matching subrole from the highest-priority provider", () => {
    expect(
      selectPeerDelegationProfileForSubrole(
        profiles,
        profiles.map((profile) => profile.id),
        ["claude", "codex", "cursor"],
        "engineer",
      ),
    ).toEqual(profiles[4]);
  });

  test("returns undefined instead of crossing a subrole boundary", () => {
    expect(
      selectPeerDelegationProfileForSubrole(
        profiles,
        ["claude-scout", "cursor-reviewer"],
        ["claude", "cursor"],
        "engineer",
      ),
    ).toBeUndefined();
  });
});
