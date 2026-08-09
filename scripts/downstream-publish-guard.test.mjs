import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);
const downstreamPackages = [
  "packages/highlight/package.json",
  "packages/relay/package.json",
  "packages/protocol/package.json",
  "packages/client/package.json",
  "packages/server/package.json",
  "packages/cli/package.json",
  "packages/foundation-cli/package.json",
];

test("downstream packages cannot be published under the upstream npm scope", () => {
  for (const relativePath of downstreamPackages) {
    const packageJson = JSON.parse(readFileSync(new URL(relativePath, repoRoot), "utf8"));
    assert.equal(
      packageJson.private,
      true,
      `${relativePath} must stay private while it uses the @getpaseo scope`,
    );
  }
});
