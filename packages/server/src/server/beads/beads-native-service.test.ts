import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  BeadsNativeService,
  beadsActorForAgent,
  type BeadsCommandInput,
  type BeadsCommandRunner,
} from "./beads-native-service.js";

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-beads-native-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function commandName(args: string[]): string {
  return (
    args.find((argument) =>
      [
        "version",
        "init",
        "metrics",
        "config",
        "ready",
        "list",
        "show",
        "create",
        "update",
      ].includes(argument),
    ) ?? "unknown"
  );
}

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: "ps123-abc",
    title: "Native issue",
    status: "open",
    priority: 2,
    issue_type: "task",
    ...overrides,
  };
}

function fakeRunner(calls: BeadsCommandInput[]): BeadsCommandRunner {
  return vi.fn(async (input: BeadsCommandInput) => {
    calls.push(input);
    switch (commandName(input.args)) {
      case "version":
        return { stdout: "bd version 1.1.2 (20e493e56: 20e493e569c9)\n", stderr: "" };
      case "ready":
      case "list":
        return { stdout: JSON.stringify([issue()]), stderr: "" };
      case "show":
        return { stdout: JSON.stringify([issue()]), stderr: "" };
      case "create":
        return { stdout: JSON.stringify(issue()), stderr: "" };
      case "update":
        return {
          stdout: JSON.stringify([
            issue({ status: "in_progress", assignee: input.env.BEADS_ACTOR }),
          ]),
          stderr: "",
        };
      default:
        return { stdout: "", stderr: "" };
    }
  });
}

describe("BeadsNativeService", () => {
  it("pins the runtime and isolates HOME, cwd, and BEADS_DIR per Paseo project", async () => {
    const paseoHome = await tempRoot();
    const calls: BeadsCommandInput[] = [];
    const service = new BeadsNativeService({
      paseoHome,
      logger: createTestLogger(),
      binaryPath: "/trusted/runtime/bd",
      commandRunner: fakeRunner(calls),
    });

    await service.create(
      { projectId: "project-a", actor: "paseo-agent-lead" },
      {
        title: "Project A issue",
        issueType: "task",
        priority: 2,
        idempotencyKey: "project-a-create",
      },
    );
    await service.create(
      { projectId: "project-b", actor: "paseo-agent-peer" },
      {
        title: "Project B issue",
        issueType: "task",
        priority: 2,
        idempotencyKey: "project-b-create",
      },
    );
    await service.list({ projectId: "project-a", actor: "paseo-agent-lead" }, { limit: 10 });
    await service.list({ projectId: "project-b", actor: "paseo-agent-peer" }, { limit: 10 });

    expect(calls.filter((call) => commandName(call.args) === "version")).toHaveLength(1);
    const listCalls = calls.filter((call) => commandName(call.args) === "list");
    expect(listCalls).toHaveLength(2);
    expect(listCalls[0]?.cwd).not.toBe(listCalls[1]?.cwd);
    for (const call of listCalls) {
      expect(call.cwd).toMatch(new RegExp(`^${paseoHome.replaceAll("/", "\\/")}/beads/projects/`));
      expect(call.env.HOME).toBe(path.join(call.cwd, "home"));
      expect(call.env.BEADS_DIR).toBe(path.join(call.cwd, ".beads"));
      expect(call.env.HOME).not.toBe(process.env.HOME);
      expect(call.args).toContain("--readonly");
      expect(call.args).toContain("--sandbox");
    }
  });

  it("replays a matching mutation receipt and rejects idempotency-key drift", async () => {
    const paseoHome = await tempRoot();
    const calls: BeadsCommandInput[] = [];
    const service = new BeadsNativeService({
      paseoHome,
      logger: createTestLogger(),
      binaryPath: "/trusted/runtime/bd",
      commandRunner: fakeRunner(calls),
    });
    const context = { projectId: "project-a", actor: "paseo-agent-lead" };
    const input = {
      title: "Native issue",
      issueType: "task" as const,
      priority: 2,
      idempotencyKey: "create-native-issue",
    };

    const first = await service.create(context, input);
    const replay = await service.create(context, input);
    expect(replay).toEqual(first);
    expect(calls.filter((call) => commandName(call.args) === "create")).toHaveLength(1);

    await expect(service.create(context, { ...input, title: "Different title" })).rejects.toThrow(
      "already used with different input",
    );

    const stores = calls
      .filter((call) => commandName(call.args) === "create")
      .map((call) => path.join(call.cwd, "idempotency.json"));
    const persisted = JSON.parse(await readFile(stores[0]!, "utf8")) as {
      schemaVersion: number;
      entries: Record<string, unknown>;
    };
    expect(persisted.schemaVersion).toBe(1);
    expect(Object.keys(persisted.entries)).toHaveLength(1);
    expect(Object.values(persisted.entries)[0]).toMatchObject({ state: "completed" });
  });

  it("fails closed instead of replaying a mutation after an indeterminate command attempt", async () => {
    const paseoHome = await tempRoot();
    const calls: BeadsCommandInput[] = [];
    const baseRunner = fakeRunner(calls);
    const runner: BeadsCommandRunner = async (input) => {
      if (commandName(input.args) === "create") {
        calls.push(input);
        throw new Error("transport ended after command dispatch");
      }
      return baseRunner(input);
    };
    const service = new BeadsNativeService({
      paseoHome,
      logger: createTestLogger(),
      binaryPath: "/trusted/runtime/bd",
      commandRunner: runner,
    });
    const context = { projectId: "project-a", actor: "paseo-agent-lead" };
    const input = {
      title: "Ambiguous issue",
      issueType: "task" as const,
      priority: 2,
      idempotencyKey: "ambiguous-create",
    };

    await expect(service.create(context, input)).rejects.toThrow("Beads command 'create' failed");
    await expect(service.create(context, input)).rejects.toThrow("indeterminate prior attempt");
    expect(calls.filter((call) => commandName(call.args) === "create")).toHaveLength(1);

    const createCall = calls.find((call) => commandName(call.args) === "create");
    const persisted = JSON.parse(
      await readFile(path.join(createCall!.cwd, "idempotency.json"), "utf8"),
    ) as { entries: Record<string, unknown> };
    expect(Object.values(persisted.entries)[0]).toMatchObject({ state: "pending" });
  });

  it("fails closed when the native binary is not the pinned Beads release", async () => {
    const service = new BeadsNativeService({
      paseoHome: await tempRoot(),
      logger: createTestLogger(),
      binaryPath: "/trusted/runtime/bd",
      commandRunner: async () => ({ stdout: "bd version 1.2.0\n", stderr: "" }),
    });

    await expect(service.status()).resolves.toMatchObject({
      available: false,
      version: "1.1.2",
      reason: expect.stringContaining("requires bd 1.1.2"),
    });
  });

  it("keeps status and uninitialized read paths free of durable state", async () => {
    const paseoHome = await tempRoot();
    const calls: BeadsCommandInput[] = [];
    const service = new BeadsNativeService({
      paseoHome,
      logger: createTestLogger(),
      binaryPath: "/trusted/runtime/bd",
      commandRunner: fakeRunner(calls),
    });
    const context = { projectId: "project-a", actor: "paseo-agent-supervisor" };

    await expect(service.status()).resolves.toMatchObject({ available: true, version: "1.1.2" });
    await expect(service.list(context, {})).resolves.toEqual([]);
    await expect(service.ready(context)).resolves.toEqual([]);
    await expect(service.get(context, "ps123-abc")).rejects.toThrow("is not initialized");
    await expect(service.prime(context)).rejects.toThrow("is not initialized");

    expect(await readdir(paseoHome)).toEqual([]);
    expect(calls.map((call) => commandName(call.args))).toEqual(["version"]);
  });

  it("does not trust a source-runtime sibling or global bd without explicit configuration", async () => {
    vi.stubEnv("PASEO_BEADS_BINARY", "");
    const calls: BeadsCommandInput[] = [];
    const service = new BeadsNativeService({
      paseoHome: await tempRoot(),
      logger: createTestLogger(),
      commandRunner: fakeRunner(calls),
    });

    await expect(service.status()).resolves.toMatchObject({
      available: false,
      reason: expect.stringContaining("set PASEO_BEADS_BINARY"),
    });
    expect(calls).toEqual([]);
  });

  it("derives bounded stable Beads actors from durable Paseo agent IDs", () => {
    expect(beadsActorForAgent("Peer 01/alpha")).toBe("paseo-agent-peer-01-alpha");
    expect(beadsActorForAgent("x".repeat(200))).toMatch(/^paseo-agent-x{48}-[a-f0-9]{12}$/u);
  });
});
