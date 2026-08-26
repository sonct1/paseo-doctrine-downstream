import { describe, expect, test } from "vitest";
import { claimColdOpenDistributionUpdateCheck } from "./distribution-update-check-policy";

describe("claimColdOpenDistributionUpdateCheck", () => {
  test("allows one automatic check per host for the lifetime of the WebUI process", () => {
    const serverId = `cold-open-${crypto.randomUUID()}`;

    expect(claimColdOpenDistributionUpdateCheck(serverId)).toBe(true);
    expect(claimColdOpenDistributionUpdateCheck(serverId)).toBe(false);
  });

  test("does not let one host suppress another host's first check", () => {
    const first = `cold-open-${crypto.randomUUID()}`;
    const second = `cold-open-${crypto.randomUUID()}`;

    expect(claimColdOpenDistributionUpdateCheck(first)).toBe(true);
    expect(claimColdOpenDistributionUpdateCheck(second)).toBe(true);
  });
});
