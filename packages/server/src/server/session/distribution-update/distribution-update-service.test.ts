import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  DISTRIBUTION_UPDATE_CACHE_TTL_MS,
  DISTRIBUTION_UPDATE_MANUAL_COOLDOWN_MS,
  DOWNSTREAM_RELEASES_API,
  DistributionUpdateService,
  comparePaseoVersions,
  type DistributionUpdateRuntime,
} from "./distribution-update-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createHome(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-distribution-update-"));
  roots.push(root);
  return root;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function releaseFixture(version = "0.5.0-paseo.39") {
  const archiveName = `paseo-web-cli-${version}-macos-arm64.tar.gz`;
  return {
    tag_name: `paseo-v${version}`,
    draft: false,
    prerelease: true,
    html_url: `https://github.com/webplode/paseo-doctrine-downstream/releases/tag/paseo-v${version}`,
    published_at: "2026-08-25T00:00:00Z",
    assets: [
      {
        name: "paseo-update-manifest.json",
        browser_download_url: `https://downloads.invalid/${version}/manifest`,
        digest: null,
      },
      {
        name: archiveName,
        browser_download_url: `https://downloads.invalid/${version}/archive`,
        digest: null,
      },
      {
        name: `${archiveName}.sha256`,
        browser_download_url: `https://downloads.invalid/${version}/checksum`,
        digest: null,
      },
    ],
  };
}

function createRuntime(input: {
  now: () => number;
  fetch: DistributionUpdateRuntime["fetch"];
  paseoHome: string;
  spawned?: Array<{ installerPath: string; prefix: string; binDir: string }>;
}): DistributionUpdateRuntime {
  return {
    now: input.now,
    fetch: input.fetch,
    platform: "darwin",
    arch: "arm64",
    async resolvePortableInstallOrigin() {
      return {
        prefix: path.join(input.paseoHome, "portable"),
        binDir: path.join(input.paseoHome, "bin"),
        releaseDir: path.join(input.paseoHome, "portable", "releases", "0.5.0-paseo.38"),
      };
    },
    async extractArchive(_archivePath, destination) {
      const bundle = path.join(destination, "paseo-web-cli-0.5.0-paseo.39-macos-arm64");
      await fs.mkdir(bundle, { recursive: true });
      await fs.writeFile(
        path.join(bundle, "manifest.json"),
        JSON.stringify({
          product: "Paseo WebUI + CLI",
          version: "0.5.0-paseo.39",
          platform: "darwin",
          arch: "arm64",
        }),
      );
      await fs.writeFile(path.join(bundle, "install.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    },
    async spawnInstaller(spawnInput) {
      input.spawned?.push(spawnInput);
      return {} as ChildProcess;
    },
  };
}

describe("DistributionUpdateService", () => {
  test("compares downstream Paseo versions by core semver and release counter", () => {
    expect(comparePaseoVersions("0.5.1-paseo.1", "0.5.0-paseo.99")).toBeGreaterThan(0);
    expect(comparePaseoVersions("0.5.0-paseo.39", "0.5.0-paseo.38")).toBeGreaterThan(0);
    expect(comparePaseoVersions("0.5.0-paseo.38", "0.5.0-paseo.38")).toBe(0);
  });

  test("checks only the downstream release list and reuses the persistent 24h cache", async () => {
    const paseoHome = await createHome();
    let now = Date.parse("2026-08-25T01:00:00Z");
    const calls: string[] = [];
    const runtime = createRuntime({
      paseoHome,
      now: () => now,
      fetch: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify([releaseFixture()]), {
          headers: {
            etag: '"release-etag"',
            "content-type": "application/json",
          },
        });
      },
    });
    const service = new DistributionUpdateService({
      paseoHome,
      currentVersion: "0.5.0-paseo.38",
      logger: createTestLogger(),
      runtime,
    });

    const [first, concurrent] = await Promise.all([service.check(), service.check()]);
    expect(first.update?.version).toBe("0.5.0-paseo.39");
    expect(concurrent.update?.version).toBe("0.5.0-paseo.39");
    expect(calls).toEqual([`${DOWNSTREAM_RELEASES_API}?per_page=10`]);

    now += DISTRIBUTION_UPDATE_CACHE_TTL_MS - 1;
    const cached = await service.check();
    expect(cached.source).toBe("cache");
    expect(calls).toHaveLength(1);
  });

  test("manual checks cannot bypass the five minute cooldown", async () => {
    const paseoHome = await createHome();
    let now = Date.parse("2026-08-25T01:00:00Z");
    let calls = 0;
    const service = new DistributionUpdateService({
      paseoHome,
      currentVersion: "0.5.0-paseo.38",
      logger: createTestLogger(),
      runtime: createRuntime({
        paseoHome,
        now: () => now,
        fetch: async () => {
          calls += 1;
          return new Response(JSON.stringify([releaseFixture()]));
        },
      }),
    });

    await service.check("manual");
    now += DISTRIBUTION_UPDATE_MANUAL_COOLDOWN_MS - 1;
    await service.check("manual");
    expect(calls).toBe(1);
  });

  test("persists a no-cache rate-limit response so repeated cold opens do not hit GitHub", async () => {
    const paseoHome = await createHome();
    let calls = 0;
    const service = new DistributionUpdateService({
      paseoHome,
      currentVersion: "0.5.0-paseo.38",
      logger: createTestLogger(),
      runtime: createRuntime({
        paseoHome,
        now: () => Date.parse("2026-08-25T01:00:00Z"),
        fetch: async () => {
          calls += 1;
          return new Response("rate limited", {
            status: 403,
            headers: { "retry-after": "3600" },
          });
        },
      }),
    });

    const first = await service.check("automatic");
    const second = await service.check("automatic");

    expect(first.error).toBe("GitHub returned HTTP 403.");
    expect(second).toMatchObject({ source: "cache", error: "GitHub returned HTTP 403." });
    expect(calls).toBe(1);
  });

  test("ignores a release until its final qualified manifest asset exists", async () => {
    const paseoHome = await createHome();
    const incomplete = releaseFixture();
    incomplete.assets = incomplete.assets.filter(
      (asset) => asset.name !== "paseo-update-manifest.json",
    );
    const service = new DistributionUpdateService({
      paseoHome,
      currentVersion: "0.5.0-paseo.38",
      logger: createTestLogger(),
      runtime: createRuntime({
        paseoHome,
        now: () => Date.now(),
        fetch: async () => new Response(JSON.stringify([incomplete])),
      }),
    });

    await expect(service.check()).resolves.toMatchObject({
      update: null,
      error: null,
    });
  });

  test("downloads, verifies, prepares, and launches the portable installer", async () => {
    const paseoHome = await createHome();
    const archiveBytes = new TextEncoder().encode("verified portable archive bytes");
    const archiveSha = sha256(archiveBytes);
    const spawned: Array<{
      installerPath: string;
      prefix: string;
      binDir: string;
    }> = [];
    const release = releaseFixture();
    const fetcher: DistributionUpdateRuntime["fetch"] = async (url) => {
      if (url === `${DOWNSTREAM_RELEASES_API}?per_page=10`) {
        return new Response(JSON.stringify([release]));
      }
      if (url.endsWith("/manifest")) {
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            version: "0.5.0-paseo.39",
            tag: "paseo-v0.5.0-paseo.39",
            sourceCommit: "abc123",
            qualifiedAt: "2026-08-25T00:00:00Z",
            minimumUpdaterVersion: "0.5.0-paseo.38",
            assets: {
              "macos-arm64": {
                name: "paseo-web-cli-0.5.0-paseo.39-macos-arm64.tar.gz",
                sha256: archiveSha,
              },
            },
          }),
        );
      }
      if (url.endsWith("/checksum")) return new Response(`${archiveSha}  archive.tar.gz\n`);
      if (url.endsWith("/archive")) return new Response(archiveBytes);
      throw new Error(`Unexpected URL: ${url}`);
    };
    const service = new DistributionUpdateService({
      paseoHome,
      currentVersion: "0.5.0-paseo.38",
      logger: createTestLogger(),
      runtime: createRuntime({
        paseoHome,
        now: () => Date.now(),
        fetch: fetcher,
        spawned,
      }),
    });

    await service.check();
    await expect(service.prepare()).resolves.toEqual({
      success: true,
      version: "0.5.0-paseo.39",
      error: null,
    });
    await expect(service.apply()).resolves.toEqual({
      accepted: true,
      version: "0.5.0-paseo.39",
      error: null,
    });
    expect(spawned).toHaveLength(1);
    expect(path.basename(spawned[0]?.installerPath ?? "")).toBe("install.sh");
    expect(path.basename(path.dirname(spawned[0]?.installerPath ?? ""))).toBe(
      "paseo-web-cli-0.5.0-paseo.39-macos-arm64",
    );
    await expect(service.getStatus()).resolves.toMatchObject({
      phase: "installing",
      version: "0.5.0-paseo.39",
    });
  });

  test("rolls back through the locally retained installer without calling GitHub", async () => {
    const paseoHome = await createHome();
    const previousRelease = path.join(paseoHome, "portable", "releases", "0.5.0-paseo.37");
    await fs.mkdir(previousRelease, { recursive: true });
    await fs.mkdir(path.join(paseoHome, "portable", "releases", "0.5.0-paseo.38"), {
      recursive: true,
    });
    await fs.writeFile(path.join(previousRelease, "install.sh"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    const spawned: Array<{
      installerPath: string;
      prefix: string;
      binDir: string;
    }> = [];
    const service = new DistributionUpdateService({
      paseoHome,
      currentVersion: "0.5.0-paseo.38",
      logger: createTestLogger(),
      runtime: createRuntime({
        paseoHome,
        now: () => Date.now(),
        fetch: async () => {
          throw new Error("rollback must not call GitHub");
        },
        spawned,
      }),
    });

    await expect(service.rollback()).resolves.toEqual({
      accepted: true,
      version: "0.5.0-paseo.37",
      error: null,
    });
    expect(spawned[0]?.installerPath).toBe(path.join(previousRelease, "install.sh"));
  });
});
