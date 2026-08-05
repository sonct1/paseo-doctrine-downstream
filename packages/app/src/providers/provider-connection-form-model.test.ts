import { describe, expect, test, vi } from "vitest";
import {
  normalizeProviderBaseUrl,
  openProviderConnectionForm,
} from "./provider-connection-form-model";

describe("provider connection form model", () => {
  test("normalizes an HTTPS Responses endpoint exactly once", () => {
    expect(normalizeProviderBaseUrl("https://proxy.example/")).toBe("https://proxy.example/v1");
    expect(normalizeProviderBaseUrl("https://proxy.example/v1/")).toBe("https://proxy.example/v1");
    expect(normalizeProviderBaseUrl("http://proxy.example/v1")).toBeNull();
    expect(normalizeProviderBaseUrl("https://user:pass@proxy.example/v1")).toBeNull();
    expect(normalizeProviderBaseUrl("https://proxy.example/v1?key=secret")).toBeNull();
  });

  test("requires a valid URL and either an existing or replacement credential", () => {
    const model = openProviderConnectionForm({
      mode: "create",
      providerId: "codex-proxy",
      providerLabel: "Codex proxy",
      baseUrl: "https://proxy.example",
    });
    expect(model.getState().canSave).toBe(false);
    model.applyCredentialStatus(false);
    expect(model.getState().canSave).toBe(false);
    model.setApiKey("sk-private");
    expect(model.getState().canSave).toBe(true);
    model.setBaseUrl("http://insecure.example");
    expect(model.getState().canSave).toBe(false);
  });

  test("clears credential draft bytes after save and close", () => {
    const model = openProviderConnectionForm({
      mode: "edit",
      providerId: "codex-proxy",
      providerLabel: "Codex proxy",
      baseUrl: "https://proxy.example",
    });
    const listener = vi.fn();
    model.subscribe(listener);
    model.setApiKey("sk-private");
    model.startSaving();
    model.finishSaving();
    expect(model.getState().apiKey).toBe("");
    expect(model.getState().credentialConfigured).toBe(true);
    model.setApiKey("sk-second");
    model.close();
    expect(model.getState().apiKey).toBe("");
  });
});
