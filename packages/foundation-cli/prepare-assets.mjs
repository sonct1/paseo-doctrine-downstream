import { cpSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = realpathSync(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = realpathSync(path.resolve(packageRoot, "../.."));
const assetsRoot = path.join(packageRoot, "assets");
if (path.dirname(assetsRoot) !== packageRoot) {
  throw new Error(`Refusing unsafe assets root: ${assetsRoot}`);
}

rmSync(assetsRoot, { recursive: true, force: true });
mkdirSync(assetsRoot, { recursive: true });
cpSync(path.join(repoRoot, "foundation"), path.join(assetsRoot, "foundation"), { recursive: true });
cpSync(path.join(repoRoot, "control-workspace"), path.join(assetsRoot, "control-workspace"), {
  recursive: true,
});
