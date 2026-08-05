import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageManager = packageJson.packageManager;
const expectedMatch = /^npm@(\d+\.\d+\.\d+)$/.exec(packageManager ?? "");

if (!expectedMatch) {
  throw new Error('package.json must pin an exact "packageManager": "npm@X.Y.Z"');
}

const userAgentMatch = /^npm\/([^\s]+)/.exec(process.env.npm_config_user_agent ?? "");
const actualVersion =
  userAgentMatch?.[1] ?? execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
const expectedVersion = expectedMatch[1];

if (actualVersion !== expectedVersion) {
  throw new Error(
    `release toolchain requires npm ${expectedVersion}; current npm is ${actualVersion}`,
  );
}

process.stdout.write(`Release toolchain npm ${actualVersion}\n`);
