import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  FoundationCredentialStore,
  resolveFoundationCredentialFile,
} from "./foundation-credential-store.js";
import { loadPersistedConfig, savePersistedConfig } from "./persisted-config.js";

describe("FoundationCredentialStore", () => {
  const temporaryHomes: string[] = [];

  afterEach(() => {
    for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  function createStore(): { home: string; store: FoundationCredentialStore } {
    const home = mkdtempSync(path.join(os.tmpdir(), "paseo-credential-store-"));
    temporaryHomes.push(home);
    return { home, store: new FoundationCredentialStore(home) };
  }

  test("writes config-backed credentials and returns status without credential bytes", () => {
    const { home, store } = createStore();
    const status = store.set("codex-proxy", "  sk-private-value  ");
    const filePath = resolveFoundationCredentialFile(home, "codex-proxy");

    expect(status).toEqual({ credentialRef: "codex-proxy", configured: true });
    expect(JSON.stringify(status)).not.toContain("sk-private-value");
    expect(lstatSync(filePath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({
      schemaVersion: 1,
      OPENAI_API_KEY: "sk-private-value",
    });
    expect(loadPersistedConfig(home).agents?.credentials).toEqual({
      "codex-proxy": { OPENAI_API_KEY: "sk-private-value" },
    });
    expect(store.delete("codex-proxy")).toEqual({
      credentialRef: "codex-proxy",
      configured: false,
    });
    expect(loadPersistedConfig(home).agents?.credentials).toBeUndefined();
  });

  test("restores runtime credential files from config on startup", () => {
    const { home } = createStore();
    const config = loadPersistedConfig(home);
    savePersistedConfig(home, {
      ...config,
      agents: {
        ...config.agents,
        credentials: {
          "codex-proxy": { OPENAI_API_KEY: "sk-config-value" },
        },
      },
    });

    const filePath = resolveFoundationCredentialFile(home, "codex-proxy");
    rmSync(filePath, { force: true });
    const store = new FoundationCredentialStore(home);

    expect(store.getStatus("codex-proxy")).toEqual({
      credentialRef: "codex-proxy",
      configured: true,
    });
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({
      schemaVersion: 1,
      OPENAI_API_KEY: "sk-config-value",
    });
  });

  test("rejects traversal refs and symlink targets", () => {
    const { home, store } = createStore();
    expect(() => store.set("../escape", "secret")).toThrow();

    store.set("codex-proxy", "first");
    const filePath = resolveFoundationCredentialFile(home, "codex-proxy");
    rmSync(filePath);
    symlinkSync(path.join(home, "outside.json"), filePath);
    expect(() => store.set("codex-proxy", "second")).toThrow("not a regular file");
    expect(loadPersistedConfig(home).agents?.credentials?.["codex-proxy"]).toEqual({
      OPENAI_API_KEY: "first",
    });
  });

  test("rejects symlinked credential directories", () => {
    const { home, store } = createStore();
    const outside = path.join(home, "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(home, "credentials"));

    expect(() => store.set("codex-proxy", "secret")).toThrow(
      "credential directory is not a regular directory",
    );
    expect(() => store.getStatus("codex-proxy")).toThrow(
      "credential directory is not a regular directory",
    );
    expect(loadPersistedConfig(home).agents?.credentials).toBeUndefined();
  });
});
