import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { constants as zlibConstants, createBrotliCompress, createGzip } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(REPO_ROOT, "packages", "app");
const SOURCE_DIST = path.join(APP_DIR, "dist");
const TARGET_DIST = path.join(REPO_ROOT, "packages", "server", "dist", "server", "web-ui");
const COMPRESS_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".svg", ".map"]);
// Keep the lock outside package dist trees: build:server:clean removes server/dist before invoking
// this script, so a lock inside that directory cannot serialize two complete product builds.
const LOCK_DIR = path.join(REPO_ROOT, "artifacts", ".web-ui-build-lock");

// Two builds at once destroy each other: cleanTarget() removes the directory that the other
// build's precompressAssets() is writing .br/.gz files into, and the loser dies with ENOENT on
// a path it just created. mkdir is atomic, so it doubles as the lock.
async function acquireBuildLock() {
  await mkdir(path.dirname(LOCK_DIR), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(LOCK_DIR);
      await writeFile(path.join(LOCK_DIR, "pid"), String(process.pid), "utf8");
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = Number.parseInt(
        await readFile(path.join(LOCK_DIR, "pid"), "utf8").catch(() => ""),
        10,
      );
      if (Number.isInteger(owner) && isProcessAlive(owner)) {
        throw new Error(
          `Another daemon web UI build is running (pid ${owner}). Wait for it, or remove ${LOCK_DIR} if that process is gone.`,
          { cause: error },
        );
      }
      // The owner died mid-build and left the lock behind; its output is untrustworthy anyway.
      await rm(LOCK_DIR, { recursive: true, force: true });
    }
  }
  throw new Error(`Could not acquire ${LOCK_DIR}`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function fmtMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
        return;
      }
      resolve();
    });
  });
}

async function exportBrowserWebApp() {
  console.log("Exporting browser web app...");
  const npmArgs = ["run", "build:web", "--workspace=@getpaseo/app"];
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = npmExecPath ? [npmExecPath, ...npmArgs] : npmArgs;
  await run(command, args, {
    cwd: REPO_ROOT,
  });
}

async function cleanTarget() {
  console.log(`Cleaning ${path.relative(REPO_ROOT, TARGET_DIST)}...`);
  await rm(TARGET_DIST, { recursive: true, force: true });
  await mkdir(TARGET_DIST, { recursive: true });
}

async function copyAssets() {
  console.log(`Copying assets to ${path.relative(REPO_ROOT, TARGET_DIST)}...`);
  await cp(SOURCE_DIST, TARGET_DIST, { recursive: true, force: true });
}

async function compressFile(filePath) {
  const brotliPath = `${filePath}.br`;
  const gzipPath = `${filePath}.gz`;
  await Promise.all([
    pipeline(
      createReadStream(filePath),
      createBrotliCompress({
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
        },
      }),
      createWriteStream(brotliPath),
    ),
    pipeline(createReadStream(filePath), createGzip(), createWriteStream(gzipPath)),
  ]);
}

async function precompressAssets(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const dirs = entries.filter((entry) => entry.isDirectory());

  for (const file of files) {
    const filePath = path.join(dir, file.name);
    if (COMPRESS_EXTENSIONS.has(path.extname(file.name).toLowerCase())) {
      await compressFile(filePath);
    }
  }

  for (const subdir of dirs) {
    await precompressAssets(path.join(dir, subdir.name));
  }
}

async function measureBundle(dir) {
  let raw = 0;
  let gzip = 0;
  let brotli = 0;

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      const info = await stat(entryPath);
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".br") {
        brotli += info.size;
      } else if (ext === ".gz") {
        gzip += info.size;
      } else {
        raw += info.size;
      }
    }
  }

  await walk(dir);
  return { raw, gzip, brotli };
}

async function main() {
  await acquireBuildLock();
  try {
    await exportBrowserWebApp();

    const sourceStat = await stat(SOURCE_DIST).catch(() => null);
    if (!sourceStat?.isDirectory()) {
      throw new Error(`Browser web export not found at ${SOURCE_DIST}`);
    }

    await cleanTarget();
    await copyAssets();
    await precompressAssets(TARGET_DIST);

    const sizes = await measureBundle(TARGET_DIST);
    console.log("Daemon web UI bundle:");
    console.log(`  raw:    ${fmtMiB(sizes.raw)}`);
    console.log(`  gzip:   ${fmtMiB(sizes.gzip)}`);
    console.log(`  brotli: ${fmtMiB(sizes.brotli)}`);
  } finally {
    await rm(LOCK_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
