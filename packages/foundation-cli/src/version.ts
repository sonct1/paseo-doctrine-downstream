import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface FoundationCliPackageJson {
  version?: unknown;
}

export function resolveFoundationCliVersion(): string {
  const packageJson = require("../package.json") as FoundationCliPackageJson;
  if (typeof packageJson.version === "string" && packageJson.version.trim().length > 0) {
    return packageJson.version.trim();
  }
  throw new Error("Unable to resolve @getpaseo/foundation-cli version from package.json.");
}
