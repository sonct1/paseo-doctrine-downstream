import { expect, test } from "vitest";

import { withAgentAuthorityLock } from "./agent-authority-lock.js";

test("serializes prompt dispatch and authority transfer for one agent", async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const promptDispatch = withAgentAuthorityLock("lead-old", async () => {
    events.push("prompt:start");
    await firstGate;
    events.push("prompt:committed");
  });
  const authorityTransfer = withAgentAuthorityLock("lead-old", async () => {
    events.push("release:start");
  });

  await Promise.resolve();
  expect(events).toEqual(["prompt:start"]);
  releaseFirst();
  await Promise.all([promptDispatch, authorityTransfer]);
  expect(events).toEqual(["prompt:start", "prompt:committed", "release:start"]);
});
