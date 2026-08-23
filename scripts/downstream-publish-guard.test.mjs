import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);
const rootPackageJson = JSON.parse(readFileSync(new URL("package.json", repoRoot), "utf8"));
const repoRootPath = dirname(fileURLToPath(new URL("package.json", repoRoot)));
const downstreamPackages = rootPackageJson.workspaces.map((workspace) =>
  join(workspace, "package.json"),
);

test("downstream packages cannot be published under the upstream npm scope", () => {
  for (const relativePath of downstreamPackages) {
    const packageJson = JSON.parse(readFileSync(join(repoRootPath, relativePath), "utf8"));
    if (packageJson.name?.startsWith("@getpaseo/")) {
      assert.equal(
        packageJson.private,
        true,
        `${relativePath} must stay private while it uses the @getpaseo scope`,
      );
    }
  }
});
