import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("smoke-web-cli-artifact.mjs", import.meta.url), "utf8");

test("portable artifact smoke binds every CLI probe to its isolated daemon", () => {
  assert.match(source, /PASEO_LISTEN: listen/);
  assert.match(source, /PASEO_RELAY_ENABLED: "false"/);
  assert.match(source, /await waitForExit\(daemon\)/);
});
