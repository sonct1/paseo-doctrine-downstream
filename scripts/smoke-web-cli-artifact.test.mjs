import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("smoke-web-cli-artifact.mjs", import.meta.url), "utf8");
const gitAttributes = readFileSync(new URL("../.gitattributes", import.meta.url), "utf8");

test("portable artifact smoke binds every CLI probe to its isolated daemon", () => {
  assert.match(source, /PASEO_LISTEN: listen/);
  assert.match(source, /PASEO_RELAY_ENABLED: "false"/);
  assert.match(source, /await waitForExit\(daemon\)/);
});

test("portable artifact smoke fails closed when an installed command hangs", () => {
  assert.match(source, /const timeout = options\.timeoutMs \?\? 120_000/);
  assert.match(source, /const windowsBundleIoTimeoutMs = 10 \* 60_000/);
  assert.equal(source.match(/timeoutMs: windowsBundleIoTimeoutMs/gu)?.length, 2);
  assert.match(source, /timeout,/);
  assert.match(source, /if \(result\.error\)/);
  assert.match(source, /SMOKE_COMMAND start=/);
});

test("portable artifact smoke only reports success after bounded cleanup", () => {
  assert.match(source, /maxRetries: process\.platform === "win32" \? 20 : 0/);
  assert.match(source, /retryDelay: 250/);
  assert.match(
    source,
    /\.then\(\(success\) => \{\s+cleanupSmokeRoot\(\);\s+return process\.stdout\.write\(success\);/u,
  );
});

test("Foundation manifest payload keeps canonical bytes on every checkout", () => {
  assert.match(gitAttributes, /^foundation\/dist\/\*\* -text$/mu);
});
