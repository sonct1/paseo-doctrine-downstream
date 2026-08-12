import { describe, expect, it } from "vitest";

import { resolveOnboardProbeListen } from "./onboard.js";

describe("resolveOnboardProbeListen", () => {
  it("does not probe a fallback address while the supervisor lock has no bound listen", () => {
    expect(
      resolveOnboardProbeListen({
        running: true,
        pidInfo: { listen: null },
      }),
    ).toBeNull();
  });

  it("uses only the bound listen recorded in the live PID lock", () => {
    expect(
      resolveOnboardProbeListen({
        running: true,
        pidInfo: { listen: " 127.0.0.1:43123 " },
      }),
    ).toBe("127.0.0.1:43123");
  });

  it("does not probe when the PID-lock owner is not running", () => {
    expect(
      resolveOnboardProbeListen({
        running: false,
        pidInfo: { listen: "127.0.0.1:43123" },
      }),
    ).toBeNull();
  });
});
