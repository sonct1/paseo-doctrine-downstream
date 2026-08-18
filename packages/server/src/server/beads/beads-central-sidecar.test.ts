import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

import { BeadsCentralSidecar, type BeadsCentralSidecarRuntime } from "./beads-central-sidecar.js";

class FakeChildProcess extends EventEmitter {
  public readonly pid = 4242;
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;

  public kill(): boolean {
    return true;
  }
}

interface RuntimeHarness {
  runtime: BeadsCentralSidecarRuntime;
  child: FakeChildProcess;
  spawnCalls: Array<{
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
  }>;
  terminated: FakeChildProcess[];
  fetchCalls: number;
}

function createRuntime(
  readyBody: Record<string, unknown> = {
    status: "ready",
    central: "1.2.0",
    bd: "bd version 1.1.2 (v1.1.2-bundled)",
  },
): RuntimeHarness {
  const child = new FakeChildProcess();
  const spawnCalls: RuntimeHarness["spawnCalls"] = [];
  const terminated: FakeChildProcess[] = [];
  let now = 0;
  let fetchCalls = 0;
  const runtime: BeadsCentralSidecarRuntime = {
    spawn: (command, args, options) => {
      spawnCalls.push({ command, args, env: options.env });
      return child as unknown as ChildProcess;
    },
    fetch: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new TypeError("connection refused");
      return Response.json(readyBody);
    },
    terminate: async (target) => {
      terminated.push(target as FakeChildProcess);
      return "terminated";
    },
    sleep: async (ms) => {
      now += ms;
    },
    now: () => now,
    randomToken: () => "generated-sidecar-token-that-is-long-enough",
    resolveExecutable: () => "/bundle/beads-central",
    resolveBdExecutable: () => "/bundle/bin/bd",
  };
  return {
    runtime,
    child,
    spawnCalls,
    terminated,
    get fetchCalls() {
      return fetchCalls;
    },
  };
}

const temporaryRoots: string[] = [];

function temporaryHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "paseo-beads-sidecar-test."));
  temporaryRoots.push(home);
  return home;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("BeadsCentralSidecar", () => {
  it("owns startup readiness, credential bootstrap, data path, and shutdown", async () => {
    const harness = createRuntime();
    const paseoHome = temporaryHome();
    const savedCredentials: Array<{ credentialRef: string; token: string }> = [];
    const sidecar = new BeadsCentralSidecar({
      paseoHome,
      config: { endpoint: "http://127.0.0.1:8080", credentialRef: "beads-central" },
      credentialStore: {
        readApiKeyForInternalUse: () => null,
        set: (credentialRef, token) => {
          savedCredentials.push({ credentialRef, token });
          return { credentialRef, configured: true };
        },
      },
      logger: pino({ level: "silent" }),
      onUnexpectedExit: () => undefined,
      runtime: harness.runtime,
    });

    await sidecar.start();

    expect(sidecar.isReady()).toBe(true);
    expect(savedCredentials).toEqual([
      {
        credentialRef: "beads-central",
        token: "generated-sidecar-token-that-is-long-enough",
      },
    ]);
    expect(harness.spawnCalls).toHaveLength(1);
    expect(harness.spawnCalls[0]?.command).toBe("/bundle/beads-central");
    expect(harness.spawnCalls[0]?.args).toEqual(["--host", "127.0.0.1", "--port", "8080"]);
    expect(harness.spawnCalls[0]?.env.BEADS_CENTRAL_BD_BIN).toBe("/bundle/bin/bd");
    expect(harness.spawnCalls[0]?.env.OPENAI_API_KEY).toBeUndefined();
    expect(harness.spawnCalls[0]?.env.BEADS_CENTRAL_DATA).toBe(
      path.join(paseoHome, "beads-central"),
    );
    expect(JSON.parse(harness.spawnCalls[0]?.env.BEADS_CENTRAL_TOKENS_JSON ?? "{}")).toEqual({
      "generated-sidecar-token-that-is-long-enough": {
        subject: "paseo-daemon",
        projects: ["*"],
        permissions: ["admin"],
      },
    });
    expect(readFileSync(path.join(paseoHome, "beads-central", "projects.yaml"), "utf8")).toBe(
      "projects: []\n",
    );

    await sidecar.stop();

    expect(sidecar.isReady()).toBe(false);
    expect(harness.terminated).toEqual([harness.child]);
  });

  it("allows a populated bundled Central up to 60 seconds to become ready", async () => {
    const harness = createRuntime();
    let fetchCalls = 0;
    harness.runtime.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new TypeError("connection refused");
      if (fetchCalls <= 202) return new Response(null, { status: 503 });
      return Response.json({
        status: "ready",
        central: "1.2.0",
        bd: "bd version 1.1.2 (v1.1.2-bundled)",
      });
    };
    const sidecar = new BeadsCentralSidecar({
      paseoHome: temporaryHome(),
      config: { endpoint: "http://127.0.0.1:8080", credentialRef: "beads-central" },
      credentialStore: {
        readApiKeyForInternalUse: () => "existing-private-token-0123456789-abcd",
        set: (credentialRef) => ({ credentialRef, configured: true }),
      },
      logger: pino({ level: "silent" }),
      onUnexpectedExit: () => undefined,
      runtime: harness.runtime,
    });

    await expect(sidecar.start()).resolves.toBeUndefined();
    expect(sidecar.isReady()).toBe(true);
  });

  it("uses an existing private credential without replacing it", async () => {
    const harness = createRuntime();
    const setCalls: string[] = [];
    const sidecar = new BeadsCentralSidecar({
      paseoHome: temporaryHome(),
      config: { endpoint: "http://localhost:8080", credentialRef: "beads-central" },
      credentialStore: {
        readApiKeyForInternalUse: () => "existing-private-token-0123456789-abcd",
        set: (_credentialRef, token) => {
          setCalls.push(token);
          return { credentialRef: "beads-central", configured: true };
        },
      },
      logger: pino({ level: "silent" }),
      onUnexpectedExit: () => undefined,
      runtime: harness.runtime,
    });

    await sidecar.start();

    expect(setCalls).toEqual([]);
    expect(harness.spawnCalls[0]?.env.BEADS_CENTRAL_TOKENS_JSON).toContain(
      "existing-private-token-0123456789-abcd",
    );
  });

  it("uses the explicit Central token for both client and sidecar without persisting it", async () => {
    const harness = createRuntime();
    const setCalls: string[] = [];
    const sidecar = new BeadsCentralSidecar({
      paseoHome: temporaryHome(),
      config: { endpoint: "http://127.0.0.1:8080", credentialRef: "beads-central" },
      credentialStore: {
        readApiKeyForInternalUse: () => "stored-token-0123456789-0123456789",
        set: (_credentialRef, token) => {
          setCalls.push(token);
          return { credentialRef: "beads-central", configured: true };
        },
      },
      logger: pino({ level: "silent" }),
      onUnexpectedExit: () => undefined,
      env: {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "must-not-leak",
        PASEO_BEADS_CENTRAL_TOKEN: "explicit-central-token-0123456789-abcd",
      },
      runtime: harness.runtime,
    });

    await sidecar.start();

    expect(setCalls).toEqual([]);
    expect(harness.spawnCalls[0]?.env.BEADS_CENTRAL_TOKENS_JSON).toContain(
      "explicit-central-token-0123456789-abcd",
    );
    expect(harness.spawnCalls[0]?.env.OPENAI_API_KEY).toBeUndefined();
    expect(harness.spawnCalls[0]?.env.PATH).toBe("/usr/bin");
  });

  it("rejects a short stored credential before spawning the component", async () => {
    const harness = createRuntime();
    const sidecar = new BeadsCentralSidecar({
      paseoHome: temporaryHome(),
      config: { endpoint: "http://127.0.0.1:8080", credentialRef: "beads-central" },
      credentialStore: {
        readApiKeyForInternalUse: () => "too-short",
        set: (credentialRef) => ({ credentialRef, configured: true }),
      },
      logger: pino({ level: "silent" }),
      onUnexpectedExit: () => undefined,
      runtime: harness.runtime,
    });

    await expect(sidecar.start()).rejects.toThrow("must contain at least 32 characters");
    expect(harness.spawnCalls).toEqual([]);
  });

  it("fails closed while a legacy Central service still owns the endpoint", async () => {
    const harness = createRuntime();
    harness.runtime.fetch = async () =>
      Response.json({ status: "ready", central: "1.2.0", bd: "bd version 1.1.2" });
    const sidecar = new BeadsCentralSidecar({
      paseoHome: temporaryHome(),
      config: { endpoint: "http://127.0.0.1:8080", credentialRef: "beads-central" },
      credentialStore: {
        readApiKeyForInternalUse: () => "existing-private-token-0123456789-abcd",
        set: (credentialRef) => ({ credentialRef, configured: true }),
      },
      logger: pino({ level: "silent" }),
      onUnexpectedExit: () => undefined,
      runtime: harness.runtime,
    });

    await expect(sidecar.start()).rejects.toThrow(
      "stop the legacy external service before starting Paseo",
    );
    expect(harness.spawnCalls).toEqual([]);
  });

  it("fails fast while an unrelated HTTP service owns the endpoint", async () => {
    const harness = createRuntime();
    harness.runtime.fetch = async () => Response.json({ status: "ready" });
    const sidecar = new BeadsCentralSidecar({
      paseoHome: temporaryHome(),
      config: { endpoint: "http://127.0.0.1:8080", credentialRef: "beads-central" },
      credentialStore: {
        readApiKeyForInternalUse: () => "existing-private-token-0123456789-abcd",
        set: (credentialRef) => ({ credentialRef, configured: true }),
      },
      logger: pino({ level: "silent" }),
      onUnexpectedExit: () => undefined,
      runtime: harness.runtime,
    });

    await expect(sidecar.start()).rejects.toThrow("already occupied by another HTTP service");
    expect(harness.spawnCalls).toEqual([]);
  });

  it("fails startup and terminates the child when the bundled version is wrong", async () => {
    const harness = createRuntime({
      status: "ready",
      central: "1.1.0",
      bd: "bd version 1.1.2 (v1.1.2-bundled)",
    });
    const sidecar = new BeadsCentralSidecar({
      paseoHome: temporaryHome(),
      config: { endpoint: "http://127.0.0.1:8080", credentialRef: "beads-central" },
      credentialStore: {
        readApiKeyForInternalUse: () => "existing-private-token-0123456789-abcd",
        set: (credentialRef) => ({ credentialRef, configured: true }),
      },
      logger: pino({ level: "silent" }),
      onUnexpectedExit: () => undefined,
      runtime: harness.runtime,
    });

    await expect(sidecar.start()).rejects.toThrow(
      "Bundled Beads Central version mismatch: expected 1.2.0, received 1.1.0",
    );
    expect(harness.terminated).toEqual([harness.child]);
  });

  it("reports an unexpected post-readiness exit to daemon lifecycle", async () => {
    const harness = createRuntime();
    const exits: Array<{ code: number | null; signal: NodeJS.Signals | null }> = [];
    const sidecar = new BeadsCentralSidecar({
      paseoHome: temporaryHome(),
      config: { endpoint: "http://127.0.0.1:8080", credentialRef: "beads-central" },
      credentialStore: {
        readApiKeyForInternalUse: () => "existing-private-token-0123456789-abcd",
        set: (credentialRef) => ({ credentialRef, configured: true }),
      },
      logger: pino({ level: "silent" }),
      onUnexpectedExit: (detail) => exits.push(detail),
      runtime: harness.runtime,
    });
    await sidecar.start();

    harness.child.exitCode = 17;
    harness.child.emit("exit", 17, null);

    expect(sidecar.isReady()).toBe(false);
    expect(exits).toEqual([{ code: 17, signal: null }]);
  });

  it("rejects a non-loopback Central endpoint", () => {
    const harness = createRuntime();
    expect(
      () =>
        new BeadsCentralSidecar({
          paseoHome: temporaryHome(),
          config: { endpoint: "https://central.example.com", credentialRef: "beads-central" },
          credentialStore: {
            readApiKeyForInternalUse: () => "token",
            set: (credentialRef) => ({ credentialRef, configured: true }),
          },
          logger: pino({ level: "silent" }),
          onUnexpectedExit: () => undefined,
          runtime: harness.runtime,
        }),
    ).toThrow("Bundled Beads Central requires a plain loopback HTTP endpoint");
  });
});
