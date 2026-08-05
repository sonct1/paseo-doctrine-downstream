import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);
const devPilot = readFileSync(new URL("docs/dev-pilot.md", repoRoot), "utf8");
const foundationProduct = readFileSync(new URL("docs/foundation-product.md", repoRoot), "utf8");

test("Foundation canaries use daemon readback for route identity", () => {
  for (const source of [devPilot, foundationProduct]) {
    assert.match(source, /paseo agent inspect <agent-id> --json/);
    assert.match(source, /Agent tự mô tả\s+provider\/model không phải route evidence/);
  }
  assert.doesNotMatch(devPilot, /trả role marker và provider\/model/);
});

test("current-byte-only qualification declares the hard provenance boundary", () => {
  assert.match(devPilot, /current-bytes-only/);
  assert.match(devPilot, /cấm rõ Memory, user-home và\s+history/);
  assert.match(devPilot, /episode evidence không hợp lệ/);
  assert.match(devPilot, /isolated Codex home/);
});
