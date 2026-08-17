import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
const platformName = { darwin: "macos", linux: "linux", win32: "windows" }[process.platform];
const extension = process.platform === "win32" ? ".zip" : ".tar.gz";
const bundleName = `paseo-web-cli-${version}-${platformName}-${process.arch}`;
const archive = path.join(repoRoot, "artifacts", `${bundleName}${extension}`);
const checksum = `${archive}.sha256`;
const smokeRoot = mkdtempSync(path.join(os.tmpdir(), "paseo-release-smoke-"));
const terminalRoot = mkdtempSync(path.join(os.tmpdir(), "paseo-release-terminal-"));
const home = path.join(smokeRoot, "home");
const prefix = path.join(smokeRoot, "install");
const binDir = path.join(smokeRoot, "bin");
const port = process.env.PASEO_RELEASE_SMOKE_PORT ?? "17677";
const listen = `127.0.0.1:${port}`;
const windowsBundleIoTimeoutMs = 10 * 60_000;
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
  APPDATA: path.join(home, "AppData", "Roaming"),
  PASEO_HOME: path.join(home, ".paseo"),
  PASEO_LISTEN: listen,
  PASEO_RELAY_ENABLED: "false",
};

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const timeout = options.timeoutMs ?? 120_000;
  process.stdout.write(
    `SMOKE_COMMAND start=${command} args=${JSON.stringify(args)} timeout_ms=${timeout}\n`,
  );
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout,
  });
  if (result.error) {
    fail(
      `${command} ${args.join(" ")} failed (${
        result.error.code ?? result.error.message
      })\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result.stdout ?? "";
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function cliCommand(name) {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      prefix: ["/d", "/s", "/c", path.join(binDir, `${name}.cmd`)],
    };
  }
  return { command: path.join(binDir, name), prefix: [] };
}

function runCli(name, args, options) {
  const cli = cliCommand(name);
  return run(cli.command, [...cli.prefix, ...args], options);
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://${listen}/api/health`);
      if (response.ok) return await response.text();
    } catch {
      // The daemon is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail("daemon health endpoint did not become ready");
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

async function smokeTerminal() {
  const marker = `paseo-portable-terminal-${process.pid}`;
  const created = JSON.parse(
    runCli(
      "paseo",
      ["terminal", "create", "--cwd", terminalRoot, "--name", "release-smoke", "--json"],
      {
        capture: true,
      },
    ),
  );
  if (typeof created.id !== "string" || created.id.length === 0) {
    fail(`terminal create returned an invalid payload: ${JSON.stringify(created)}`);
  }
  try {
    runCli("paseo", ["terminal", "send-keys", created.id, `echo ${marker}`, "Enter", "--json"], {
      capture: true,
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const capture = JSON.parse(
        runCli("paseo", ["terminal", "capture", created.id, "--scrollback", "--json"], {
          capture: true,
        }),
      );
      if (Array.isArray(capture.lines) && capture.lines.join("\n").includes(marker)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    fail(`terminal output did not contain ${marker}`);
  } finally {
    runCli("paseo", ["terminal", "kill", created.id, "--json"], {
      capture: true,
    });
  }
}

async function main() {
  if (!platformName) fail(`unsupported smoke platform: ${process.platform}`);
  if (!existsSync(archive) || !existsSync(checksum)) fail(`missing artifact: ${archive}`);
  const expected = readFileSync(checksum, "utf8").trim().split(/\s+/u)[0];
  if (!/^[0-9a-f]{64}$/u.test(expected) || sha256(archive) !== expected) {
    fail(`SHA-256 verification failed for ${archive}`);
  }

  if (process.platform === "win32") {
    run(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${archive.replaceAll(
          "'",
          "''",
        )}' -DestinationPath '${smokeRoot.replaceAll("'", "''")}' -Force`,
      ],
      { timeoutMs: windowsBundleIoTimeoutMs },
    );
  } else {
    run("tar", ["-xzf", archive, "-C", smokeRoot]);
  }
  const bundle = path.join(smokeRoot, bundleName);
  const manifest = JSON.parse(readFileSync(path.join(bundle, "manifest.json"), "utf8"));
  if (
    manifest.product !== "Paseo WebUI + CLI" ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    manifest.beadsBackend !== "central" ||
    manifest.bundledBeadsBinary !== false ||
    manifest.internalPackages?.["@paseo/plugin"] !== manifest.version
  ) {
    fail("artifact manifest does not match the smoke host");
  }

  if (process.platform === "win32") {
    run(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(bundle, "install.ps1"),
        "-Prefix",
        prefix,
        "-BinDir",
        binDir,
        "-Listen",
        listen,
        "-NoStart",
      ],
      { timeoutMs: windowsBundleIoTimeoutMs },
    );
  } else {
    run(path.join(bundle, "install.sh"), [
      "--prefix",
      prefix,
      "--bin-dir",
      binDir,
      "--listen",
      listen,
      "--no-start",
    ]);
  }

  runCli("paseo", ["--version"]);
  runCli("paseo-foundation", ["--version"]);
  runCli("paseo-foundation", ["doctor", "--json"], { capture: true });

  const runtimeNode = path.join(
    prefix,
    "current",
    "runtime",
    ...(process.platform === "win32" ? ["node.exe"] : ["bin", "node"]),
  );
  const bundledBd = path.join(
    prefix,
    "current",
    "runtime",
    ...(process.platform === "win32" ? ["bd.exe"] : ["bin", "bd"]),
  );
  if (existsSync(bundledBd)) fail("Central-only artifact unexpectedly contains a native bd binary");
  const cliEntry = path.join(
    prefix,
    "current",
    "app",
    "node_modules",
    "@getpaseo",
    "cli",
    "dist",
    "index.js",
  );
  const log = openSync(path.join(smokeRoot, "daemon.log"), "w");
  const daemon = spawn(
    runtimeNode,
    [cliEntry, "daemon", "start", "--foreground", "--listen", listen, "--web-ui", "--no-relay"],
    { env, stdio: ["ignore", log, log] },
  );
  let success;
  try {
    const health = await waitForHealth();
    const index = await (await fetch(`http://${listen}/`)).text();
    if (!index.includes("<title>Paseo</title>")) fail("WebUI title was not served");
    await smokeTerminal();
    runCli("paseo", ["daemon", "stop"]);
    await waitForExit(daemon);
    success = `SMOKE_OK platform=${process.platform} arch=${
      process.arch
    } cli=ok foundation=ok terminal=ok daemon=ok webui=ok health=${health.trim()}\n`;
  } finally {
    if (daemon.exitCode === null) {
      daemon.kill();
      await waitForExit(daemon);
    }
    closeSync(log);
  }
  if (process.platform === "win32") {
    run(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(bundle, "uninstall.ps1"),
        "-Prefix",
        prefix,
        "-BinDir",
        binDir,
        "-TaskName",
        `Paseo Release Smoke ${process.pid}`,
        "-PurgeFoundation",
      ],
      { timeoutMs: windowsBundleIoTimeoutMs },
    );
  }
  return success;
}

function cleanupSmokeRoots() {
  if (process.env.PASEO_KEEP_RELEASE_SMOKE === "1") {
    process.stdout.write(`SMOKE_ROOT=${smokeRoot}\nTERMINAL_ROOT=${terminalRoot}\n`);
    return;
  }
  for (const ownedRoot of [terminalRoot, smokeRoot]) {
    rmSync(ownedRoot, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 20 : 0,
      retryDelay: 250,
    });
  }
}

main()
  .then((success) => {
    cleanupSmokeRoots();
    return process.stdout.write(success);
  })
  .catch((error) => {
    try {
      cleanupSmokeRoots();
    } catch (cleanupError) {
      process.stderr.write(
        `SMOKE_CLEANUP_FAILED ${
          cleanupError instanceof Error ? cleanupError.stack : String(cleanupError)
        }\n`,
      );
    }
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
