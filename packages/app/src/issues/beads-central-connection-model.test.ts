import { describe, expect, test } from "vitest";

import {
  normalizeBeadsCentralCredentialRef,
  normalizeBeadsCentralEndpoint,
  validateBeadsCentralToken,
} from "./beads-central-connection-model";

describe("Beads Central connection model", () => {
  test("normalizes HTTP(S) endpoints and rejects credential-bearing or non-HTTP URLs", () => {
    expect(normalizeBeadsCentralEndpoint(" https://central.example/paseo/ ")).toBe(
      "https://central.example/paseo",
    );
    expect(normalizeBeadsCentralEndpoint("http://127.0.0.1:8080/")).toBe("http://127.0.0.1:8080");
    expect(normalizeBeadsCentralEndpoint("file:///tmp/central")).toBeNull();
    expect(normalizeBeadsCentralEndpoint("https://secret@central.example")).toBeNull();
    expect(normalizeBeadsCentralEndpoint("https://central.example?token=secret")).toBeNull();
  });

  test("validates credential references and production-length tokens", () => {
    expect(normalizeBeadsCentralCredentialRef(" beads-production ")).toBe("beads-production");
    expect(normalizeBeadsCentralCredentialRef("Beads Production")).toBeNull();
    expect(validateBeadsCentralToken("")).toBe(true);
    expect(validateBeadsCentralToken("short-token")).toBe(false);
    expect(validateBeadsCentralToken("x".repeat(32))).toBe(true);
  });
});
