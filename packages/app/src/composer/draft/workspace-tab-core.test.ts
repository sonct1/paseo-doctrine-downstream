import { describe, expect, it } from "vitest";

import { claimDraftAutoSubmit } from "./workspace-tab-core";

describe("claimDraftAutoSubmit", () => {
  it("keeps one terminal claim per draft so a rejected create cannot re-enter the effect", () => {
    const claim = { current: null as string | null };

    expect(claimDraftAutoSubmit(claim, "host:workspace:draft")).toBe(true);
    expect(claimDraftAutoSubmit(claim, "host:workspace:draft")).toBe(false);
    expect(claim.current).toBe("host:workspace:draft");
  });
});
