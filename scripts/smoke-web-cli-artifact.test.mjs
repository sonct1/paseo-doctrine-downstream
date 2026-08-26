import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("smoke-web-cli-artifact.mjs", import.meta.url), "utf8");
const gitAttributes = readFileSync(new URL("../.gitattributes", import.meta.url), "utf8");

test("portable artifact smoke binds every CLI probe to its isolated daemon", () => {
  assert.match(source, /PASEO_RELEASE_ARTIFACT_ROOT/);
  assert.match(source, /PASEO_LISTEN: listen/);
  assert.match(source, /PASEO_RELAY_ENABLED: "false"/);
  assert.match(source, /PASEO_DICTATION_ENABLED: "0"/);
  assert.match(source, /PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD: "0"/);
  assert.match(source, /PASEO_VOICE_MODE_ENABLED: "0"/);
  assert.match(source, /PASEO_BEADS_CENTRAL_SIDECAR: installedBeadsCentralSidecar/);
  assert.match(source, /PASEO_BEADS_CENTRAL_BD_BIN: installedBd/);
  assert.match(source, /await waitForBeadsCentral\(\)/);
  assert.match(source, /manifest\.bundledBeadsBinary !== true/);
  assert.match(source, /await waitForExit\(daemon\)/);
  assert.match(source, /await terminateChild\(daemon\)/);
});

test("portable artifact smoke uses a bounded host startup budget with daemon diagnostics", () => {
  assert.match(source, /PASEO_RELEASE_SMOKE_HEALTH_TIMEOUT_MS/);
  assert.match(source, /PASEO_RELEASE_SMOKE_HEALTH_TIMEOUT_MS \?\? 120_000/);
  assert.match(source, /Math\.ceil\(healthTimeoutMs \/ healthPollIntervalMs\)/);
  assert.match(source, /daemon exited before health became ready/);
  assert.match(source, /daemon health endpoint did not become ready within/);
  assert.match(source, /--- daemon log tail ---/);
  assert.match(source, /waitForHealth\(listen, \{ child: daemon, logPath: daemonLogPath \}\)/);
});

test("portable artifact smoke fails closed when an installed command hangs", () => {
  assert.match(source, /const timeout = options\.timeoutMs \?\? 120_000/);
  assert.match(source, /const windowsBundleIoTimeoutMs = 10 \* 60_000/);
  assert.equal(source.match(/timeoutMs: windowsBundleIoTimeoutMs/gu)?.length, 3);
  assert.match(source, /timeout,/);
  assert.match(source, /if \(result\.error\)/);
  assert.match(source, /SMOKE_COMMAND start=/);
});

test("portable artifact smoke only reports success after bounded cleanup", () => {
  assert.match(source, /const terminalRoot = mkdtempSync/);
  assert.match(source, /"terminal", "create", "--cwd", terminalRoot/);
  assert.match(source, /path\.join\(bundle, "uninstall\.ps1"\)/);
  assert.match(source, /"-PurgeFoundation"/);
  assert.match(source, /for \(const ownedRoot of \[terminalRoot, smokeRoot\]\)/);
  assert.match(source, /Remove-Item -LiteralPath \$target -Recurse -Force -ErrorAction Stop/);
  assert.match(source, /\$attempt -le 40/);
  assert.match(source, /SMOKE_CLEANUP_RETRY/);
  assert.match(source, /Start-Sleep -Milliseconds 250/);
  assert.match(source, /maxRetries:\s*40,\s*retryDelay:\s*250/);
  assert.match(source, /if \(existsSync\(ownedRoot\)\) fail/);
  assert.match(
    source,
    /\.then\(\(success\) => \{\s+cleanupSmokeRoots\(\);\s+return process\.stdout\.write\(success\);/u,
  );
});

test("Foundation manifest payload keeps canonical bytes on every checkout", () => {
  assert.match(gitAttributes, /^foundation\/dist\/\*\* -text$/mu);
});
