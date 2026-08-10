import { lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MutableDaemonConfig } from "./daemon-config-store.js";
import { FoundationCredentialStore } from "./foundation-credential-store.js";
import { FoundationProviderConnectionService } from "./foundation-provider-connection-service.js";

describe("FoundationProviderConnectionService", () => {
  const temporaryHomes: string[] = [];

  afterEach(() => {
    for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  function createFixture() {
    const home = mkdtempSync(path.join(os.tmpdir(), "paseo-provider-qualification-"));
    temporaryHomes.push(home);
    const credentialStore = new FoundationCredentialStore(home);
    credentialStore.set("codex-proxy", "sk-private-test");
    let config: MutableDaemonConfig = {
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: false },
      providers: {
        "codex-proxy": {
          extends: "codex",
          label: "Codex Proxy",
          credentialRef: "codex-proxy",
          env: { OPENAI_BASE_URL: "https://proxy.example/v1" },
          additionalModels: [{ id: "custom-model", label: "Custom Model", isDefault: true }],
        },
      },
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "resp_test", object: "response", output: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const service = new FoundationProviderConnectionService({
      paseoHome: home,
      daemonVersion: "test-version",
      getConfig: () => config,
      credentialStore,
      fetchImpl,
      now: () => new Date("2026-08-07T04:30:00.000Z"),
    });
    return {
      home,
      credentialStore,
      fetchImpl,
      service,
      setConfig: (next: MutableDaemonConfig) => (config = next),
      getConfig: () => config,
    };
  }

  test("qualifies an exact custom Codex route without persisting credential bytes", async () => {
    const { home, fetchImpl, service } = createFixture();

    await expect(service.test("codex-proxy", "custom-model")).resolves.toMatchObject({
      provider: "codex-proxy",
      model: "custom-model",
      status: "qualified",
      qualifiedAt: "2026-08-07T04:30:00.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://proxy.example/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer sk-private-test" }),
      }),
    );
    expect(service.getStatus("codex-proxy", "custom-model").status).toBe("qualified");

    const storePath = path.join(home, "provider-connection-qualifications.json");
    const persisted = readFileSync(storePath, "utf8");
    if (process.platform !== "win32") {
      expect(lstatSync(storePath).mode & 0o777).toBe(0o600);
    }
    expect(persisted).not.toContain("sk-private-test");
    expect(persisted).not.toContain("proxy.example");
  });

  test("marks a receipt stale after route or credential changes", async () => {
    const { credentialStore, service, setConfig, getConfig } = createFixture();
    await service.test("codex-proxy", "custom-model");

    setConfig({
      ...getConfig(),
      providers: {
        ...getConfig().providers,
        "codex-proxy": {
          ...getConfig().providers["codex-proxy"],
          env: { OPENAI_BASE_URL: "https://other.example/v1" },
        },
      },
    });
    expect(service.getStatus("codex-proxy", "custom-model").status).toBe("stale");

    setConfig({
      ...getConfig(),
      providers: {
        ...getConfig().providers,
        "codex-proxy": {
          ...getConfig().providers["codex-proxy"],
          env: { OPENAI_BASE_URL: "https://proxy.example/v1" },
        },
      },
    });
    credentialStore.set("codex-proxy", "rotated-private-test");
    expect(service.getStatus("codex-proxy", "custom-model").status).toBe("stale");
  });

  test("reports the requested target when an older provider receipt is stale", async () => {
    const { service, setConfig, getConfig } = createFixture();
    await service.test("codex-proxy", "custom-model");
    setConfig({
      ...getConfig(),
      providers: {
        ...getConfig().providers,
        "codex-proxy": {
          ...getConfig().providers["codex-proxy"],
          additionalModels: [{ id: "new-model", label: "New Model", isDefault: true }],
        },
      },
    });

    expect(service.getStatus("codex-proxy", "new-model")).toMatchObject({
      provider: "codex-proxy",
      model: "new-model",
      status: "stale",
    });
  });

  test("rejects non-Responses payloads and does not write a receipt", async () => {
    const fixture = createFixture();
    fixture.fetchImpl.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(fixture.service.test("codex-proxy", "custom-model")).rejects.toThrow(
      "did not return an OpenAI Responses API object",
    );
    expect(fixture.service.getStatus("codex-proxy", "custom-model").status).toBe("unqualified");
  });
});
