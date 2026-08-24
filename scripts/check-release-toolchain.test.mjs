import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./check-release-toolchain.mjs", import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));

function runWithNpmVersion(version) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_user_agent: `npm/${version} node/${process.version}`,
    },
  });
}

test("accepts the exact pinned npm release toolchain", () => {
  const result = runWithNpmVersion("11.17.0");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release toolchain npm 11\.17\.0/);
});

test("rejects a different npm release toolchain", () => {
  const result = runWithNpmVersion("11.10.1");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /release toolchain requires npm 11\.17\.0; current npm is 11\.10\.1/);
});

test("keeps release qualification immutable and version preparation explicit", () => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const releaseCheck = packageJson.scripts["release:check"];
  const releasePrepare = packageJson.scripts["release:prepare"];

  assert.equal(packageJson.packageManager, "npm@11.17.0");
  assert.match(releaseCheck, /^npm run release:toolchain:check && npm ci && /);
  assert.match(releaseCheck, /npm run acp:version-drift:check/);
  assert.match(releaseCheck, / && git diff --exit-code$/);
  assert.doesNotMatch(releaseCheck, /release:prepare/);
  assert.doesNotMatch(releaseCheck, /npm install/);

  assert.equal(
    releasePrepare,
    "npm run release:toolchain:check && npm install --workspaces --include-workspace-root && ./scripts/update-nix.sh",
  );
});
