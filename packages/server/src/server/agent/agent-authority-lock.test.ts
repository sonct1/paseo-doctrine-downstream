import { expect, test } from "vitest";

import { withAgentAuthorityLock, withAgentAuthorityLocks } from "./agent-authority-lock.js";

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

test("multi-identity locks use stable order under reversed requests", async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = withAgentAuthorityLocks(["lead-b", "lead-a"], async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  const second = withAgentAuthorityLocks(["lead-a", "lead-b"], async () => {
    events.push("second:start");
  });

  await Promise.resolve();
  expect(events).toEqual(["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  expect(events).toEqual(["first:start", "first:end", "second:start"]);
});
