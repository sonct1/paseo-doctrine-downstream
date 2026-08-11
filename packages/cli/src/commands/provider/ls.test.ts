import { describe, expect, test } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";

import { toProviderListItem } from "./ls.js";

function providerEntry(overrides: Partial<ProviderSnapshotEntry>): ProviderSnapshotEntry {
  return {
    provider: "acp",
    status: "ready",
    enabled: true,
    models: [],
    modes: [],
    defaultModeId: null,
    lastUpdatedAt: "2026-08-11T00:00:00.000Z",
    error: null,
    ...overrides,
  } as ProviderSnapshotEntry;
}

describe("provider list projection", () => {
  test("shows the discovered current mode instead of manufacturing a default", () => {
    expect(
      toProviderListItem(
        providerEntry({
          provider: "cursor",
          modes: [{ id: "agent", label: "Agent" }],
          defaultModeId: "agent",
        }),
      ),
    ).toMatchObject({
      provider: "cursor",
      defaultMode: "agent",
      modes: "Agent",
    });
  });

  test("renders absent dynamic modes explicitly", () => {
    expect(toProviderListItem(providerEntry({ provider: "gemini-antigravity" }))).toMatchObject({
      defaultMode: "-",
      modes: "-",
    });
  });
});
