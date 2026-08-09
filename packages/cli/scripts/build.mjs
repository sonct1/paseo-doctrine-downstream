import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const tscPath = createRequire(import.meta.url).resolve("typescript/bin/tsc");
// npm runs workspace scripts from the package directory, where NodeNext loses sibling workspace
// export resolution. Compile from the repository root with the monorepo's bundler resolver.
const result = spawnSync(
  process.execPath,
  [
    tscPath,
    "-p",
    resolve(packageRoot, "tsconfig.json"),
    "--incremental",
    "false",
    "--module",
    "ESNext",
    "--moduleResolution",
    "bundler",
  ],
  {
    cwd: repositoryRoot,
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
