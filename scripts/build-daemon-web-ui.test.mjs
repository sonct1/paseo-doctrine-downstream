import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("build-daemon-web-ui.mjs", import.meta.url), "utf8");

test("daemon WebUI build invokes npm through a Windows-safe executable", () => {
  assert.match(source, /process\.env\.npm_execpath/);
  assert.match(source, /process\.platform === "win32" \? "npm\.cmd" : "npm"/);
  assert.doesNotMatch(source, /run\("npm",/);
});
