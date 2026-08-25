import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type pino from "pino";
import { z } from "zod";
import { writeJsonFileAtomic } from "../../atomic-file.js";

export const DOWNSTREAM_REPOSITORY = "webplode/paseo-doctrine-downstream";
export const DOWNSTREAM_RELEASES_API = `https://api.github.com/repos/${DOWNSTREAM_REPOSITORY}/releases`;
export const DISTRIBUTION_UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const DISTRIBUTION_UPDATE_MANUAL_COOLDOWN_MS = 5 * 60 * 1000;

const UPDATE_MANIFEST_ASSET = "paseo-update-manifest.json";
const execFileAsync = promisify(execFile);

const GitHubAssetSchema = z.object({
  name: z.string(),
  browser_download_url: z.string().url(),
  digest: z.string().nullable().optional(),
});

const GitHubReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  html_url: z.string().url(),
  published_at: z.string().nullable(),
  assets: z.array(GitHubAssetSchema),
});

const GitHubReleasesSchema = z.array(GitHubReleaseSchema);
type GitHubRelease = z.infer<typeof GitHubReleaseSchema>;

const QualifiedAssetSchema = z.object({
  name: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

const DistributionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string(),
  tag: z.string(),
  sourceCommit: z.string(),
  qualifiedAt: z.string(),
  minimumUpdaterVersion: z.string().nullable().optional(),
  assets: z.record(z.string(), QualifiedAssetSchema),
});

const CandidateSchema = z.object({
  version: z.string(),
  tag: z.string(),
  releaseUrl: z.string().url(),
  publishedAt: z.string().nullable(),
  manifestUrl: z.string().url(),
  manifestDigest: z.string().nullable(),
  archiveName: z.string(),
  archiveUrl: z.string().url(),
  archiveDigest: z.string().nullable(),
  checksumName: z.string(),
  checksumUrl: z.string().url(),
});

const CacheDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  checkedAt: z.string(),
  etag: z.string().nullable(),
  rateLimitedUntil: z.string().nullable(),
  candidate: CandidateSchema.nullable(),
  error: z.string().nullable().optional(),
});

const UpdateStatusSchema = z.object({
  phase: z.enum(["idle", "checking", "downloading", "prepared", "installing", "failed"]),
  version: z.string().nullable(),
  message: z.string().nullable(),
  updatedAt: z.string(),
  preparedBundlePath: z.string().nullable().optional(),
});

export type DistributionUpdateStatus = z.infer<typeof UpdateStatusSchema>;
type Candidate = z.infer<typeof CandidateSchema>;
type CacheDocument = z.infer<typeof CacheDocumentSchema>;

export interface DistributionUpdateCheckResult {
  currentVersion: string | null;
  update: {
    version: string;
    tag: string;
    releaseUrl: string;
    publishedAt: string | null;
  } | null;
  checkedAt: string;
  source: "cache" | "network";
  error: string | null;
}

export interface DistributionUpdatePrepareResult {
  success: boolean;
  version: string | null;
  error: string | null;
}

export interface DistributionUpdateApplyResult {
  accepted: boolean;
  version: string | null;
  error: string | null;
}

export interface PortableInstallOrigin {
  prefix: string;
  binDir: string;
  releaseDir: string;
}

export interface DistributionUpdateRuntime {
  now(): number;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  platform: NodeJS.Platform;
  arch: string;
  resolvePortableInstallOrigin(): Promise<PortableInstallOrigin | null>;
  extractArchive(archivePath: string, destination: string): Promise<void>;
  spawnInstaller(input: {
    installerPath: string;
    prefix: string;
    binDir: string;
    logPath: string;
  }): Promise<ChildProcess>;
}

export interface DistributionUpdateServiceOptions {
  paseoHome: string;
  currentVersion: string | null;
  logger: pino.Logger;
  runtime?: DistributionUpdateRuntime;
}

function parsePaseoVersion(version: string): readonly number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)-paseo\.(\d+)$/u.exec(version);
  if (!match) return null;
  return match.slice(1).map((value) => Number.parseInt(value, 10));
}

export function comparePaseoVersions(left: string, right: string): number {
  const leftParts = parsePaseoVersion(left);
  const rightParts = parsePaseoVersion(right);
  if (!leftParts || !rightParts) return left.localeCompare(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function platformName(platform: NodeJS.Platform): string | null {
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  if (platform === "win32") return "windows";
  return null;
}

function normalizedArch(platform: NodeJS.Platform, arch: string): string | null {
  if (arch === "x64") return "x64";
  if (platform === "darwin" && arch === "arm64") return "arm64";
  return null;
}

function archiveExtension(platform: NodeJS.Platform): string {
  return platform === "win32" ? ".zip" : ".tar.gz";
}

function versionFromTag(tag: string): string | null {
  if (!tag.startsWith("paseo-v")) return null;
  const version = tag.slice("paseo-v".length);
  return parsePaseoVersion(version) ? version : null;
}

function toPublicRelease(candidate: Candidate | null) {
  if (!candidate) return null;
  return {
    version: candidate.version,
    tag: candidate.tag,
    releaseUrl: candidate.releaseUrl,
    publishedAt: candidate.publishedAt,
  };
}

function toDigest(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^sha256:([0-9a-f]{64})$/u.exec(value);
  return match?.[1] ?? null;
}

function rateLimitedUntil(response: Response, now: number): string | null {
  const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
  if (Number.isFinite(retryAfterSeconds)) {
    return new Date(now + retryAfterSeconds * 1000).toISOString();
  }
  const resetSeconds = Number.parseInt(response.headers.get("x-ratelimit-reset") ?? "", 10);
  return Number.isFinite(resetSeconds) ? new Date(resetSeconds * 1000).toISOString() : null;
}

function assertExtractedArtifactManifest(
  manifest: { product?: unknown; version?: unknown; platform?: unknown; arch?: unknown },
  candidate: Candidate,
  platform: NodeJS.Platform,
  arch: string,
): void {
  if (
    manifest.product !== "Paseo WebUI + CLI" ||
    manifest.version !== candidate.version ||
    manifest.platform !== platform ||
    manifest.arch !== normalizedArch(platform, arch)
  ) {
    throw new Error("Extracted portable artifact manifest does not match this host.");
  }
}

function candidateFromRelease(
  release: GitHubRelease,
  platform: NodeJS.Platform,
  arch: string,
): Candidate | null {
  if (release.draft) return null;
  const version = versionFromTag(release.tag_name);
  const targetPlatform = platformName(platform);
  const targetArch = normalizedArch(platform, arch);
  if (!version || !targetPlatform || !targetArch) return null;

  const archiveName = `paseo-web-cli-${version}-${targetPlatform}-${targetArch}${archiveExtension(
    platform,
  )}`;
  const checksumName = `${archiveName}.sha256`;
  const manifest = release.assets.find((asset) => asset.name === UPDATE_MANIFEST_ASSET);
  const archive = release.assets.find((asset) => asset.name === archiveName);
  const checksum = release.assets.find((asset) => asset.name === checksumName);
  if (!manifest || !archive || !checksum) return null;

  return {
    version,
    tag: release.tag_name,
    releaseUrl: release.html_url,
    publishedAt: release.published_at,
    manifestUrl: manifest.browser_download_url,
    manifestDigest: toDigest(manifest.digest),
    archiveName,
    archiveUrl: archive.browser_download_url,
    archiveDigest: toDigest(archive.digest),
    checksumName,
    checksumUrl: checksum.browser_download_url,
  };
}

function selectCandidate(
  releases: GitHubRelease[],
  platform: NodeJS.Platform,
  arch: string,
): Candidate | null {
  return (
    releases
      .map((release) => candidateFromRelease(release, platform, arch))
      .filter((candidate): candidate is Candidate => candidate !== null)
      .sort((left, right) => comparePaseoVersions(right.version, left.version))[0] ?? null
  );
}

async function readJsonFile<T>(filePath: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    return schema.parse(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function fetchToFile(
  fetcher: DistributionUpdateRuntime["fetch"],
  url: string,
  target: string,
) {
  const response = await fetcher(url, {
    headers: {
      Accept: "application/octet-stream",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
  }
  await pipeline(response.body as unknown as NodeJS.ReadableStream, createWriteStream(target));
}

async function defaultExtractArchive(archivePath: string, destination: string): Promise<void> {
  if (process.platform === "win32") {
    const escapedArchive = archivePath.replaceAll("'", "''");
    const escapedDestination = destination.replaceAll("'", "''");
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`,
    ]);
    return;
  }
  await execFileAsync("tar", ["-xzf", archivePath, "-C", destination]);
}

async function defaultResolvePortableInstallOrigin(): Promise<PortableInstallOrigin | null> {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 16; depth += 1) {
    const manifestPath = path.join(current, "manifest.json");
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
        product?: unknown;
      };
      if (manifest.product === "Paseo WebUI + CLI") {
        const releasesDir = path.dirname(current);
        if (path.basename(releasesDir) !== "releases") return null;
        const prefix = path.dirname(releasesDir);
        let binDir =
          process.platform === "win32"
            ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Paseo", "bin")
            : path.join(os.homedir(), ".local", "bin");
        const installConfig = await readJsonFile(
          path.join(prefix, "install-config.json"),
          z.object({ schemaVersion: z.literal(1), binDir: z.string() }),
        );
        if (installConfig && path.isAbsolute(installConfig.binDir)) {
          binDir = installConfig.binDir;
        }
        return { prefix, binDir, releaseDir: current };
      }
    } catch {
      // Keep walking toward the portable artifact root.
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function defaultSpawnInstaller(input: {
  installerPath: string;
  prefix: string;
  binDir: string;
  logPath: string;
}): Promise<ChildProcess> {
  await fs.mkdir(path.dirname(input.logPath), { recursive: true });
  const logHandle = await fs.open(input.logPath, "a", 0o600);
  const command = process.platform === "win32" ? "powershell.exe" : input.installerPath;
  const args =
    process.platform === "win32"
      ? [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          input.installerPath,
          "-Prefix",
          input.prefix,
          "-BinDir",
          input.binDir,
        ]
      : ["--prefix", input.prefix, "--bin-dir", input.binDir];
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
      env: { ...process.env, PASEO_DOWNSTREAM_TAG: undefined },
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return child;
  } finally {
    await logHandle.close();
  }
}

function createDefaultRuntime(): DistributionUpdateRuntime {
  return {
    now: () => Date.now(),
    fetch: (input, init) => fetch(input, init),
    platform: process.platform,
    arch: process.arch,
    resolvePortableInstallOrigin: defaultResolvePortableInstallOrigin,
    extractArchive: defaultExtractArchive,
    spawnInstaller: defaultSpawnInstaller,
  };
}

export class DistributionUpdateService {
  private readonly paseoHome: string;
  private readonly currentVersion: string | null;
  private readonly logger: pino.Logger;
  private readonly runtime: DistributionUpdateRuntime;
  private readonly cachePath: string;
  private readonly statusPath: string;
  private checkInFlight: Promise<DistributionUpdateCheckResult> | null = null;
  private operationInFlight = false;

  constructor(options: DistributionUpdateServiceOptions) {
    this.paseoHome = options.paseoHome;
    this.currentVersion = options.currentVersion;
    this.logger = options.logger.child({ module: "distribution-update" });
    this.runtime = options.runtime ?? createDefaultRuntime();
    this.cachePath = path.join(this.paseoHome, "updates", "release-cache.json");
    this.statusPath = path.join(this.paseoHome, "updates", "status.json");
  }

  async check(
    intent: "automatic" | "manual" = "automatic",
  ): Promise<DistributionUpdateCheckResult> {
    if (this.checkInFlight) return this.checkInFlight;
    this.checkInFlight = this.checkInternal(intent).finally(() => {
      this.checkInFlight = null;
    });
    return this.checkInFlight;
  }

  private async checkInternal(
    intent: "automatic" | "manual",
  ): Promise<DistributionUpdateCheckResult> {
    const now = this.runtime.now();
    const cached = await readJsonFile(this.cachePath, CacheDocumentSchema);
    const cooldown =
      intent === "automatic"
        ? DISTRIBUTION_UPDATE_CACHE_TTL_MS
        : DISTRIBUTION_UPDATE_MANUAL_COOLDOWN_MS;
    if (cached && now - Date.parse(cached.checkedAt) < cooldown) {
      return this.toCheckResult(cached, "cache");
    }
    if (cached?.rateLimitedUntil && Date.parse(cached.rateLimitedUntil) > now) {
      return this.toCheckResult(cached, "cache", "GitHub rate limit is still active.");
    }

    const checkedAt = new Date(now).toISOString();
    try {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "paseo-distribution-updater",
      };
      if (cached?.etag) headers["If-None-Match"] = cached.etag;
      const response = await this.runtime.fetch(`${DOWNSTREAM_RELEASES_API}?per_page=10`, {
        headers,
      });
      return await this.processCheckResponse(response, cached, now, checkedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ err: error }, "Distribution update check failed");
      const failed: CacheDocument = {
        schemaVersion: 1,
        checkedAt,
        etag: cached?.etag ?? null,
        rateLimitedUntil: cached?.rateLimitedUntil ?? null,
        candidate: cached?.candidate ?? null,
        error: message,
      };
      await writeJsonFileAtomic(this.cachePath, failed);
      return this.toCheckResult(failed, cached ? "cache" : "network");
    }
  }

  private async processCheckResponse(
    response: Response,
    cached: CacheDocument | null,
    now: number,
    checkedAt: string,
  ): Promise<DistributionUpdateCheckResult> {
    if (response.status === 304 && cached) {
      const refreshed = { ...cached, checkedAt, rateLimitedUntil: null, error: null };
      await writeJsonFileAtomic(this.cachePath, refreshed);
      return this.toCheckResult(refreshed, "network");
    }
    if (!response.ok) {
      if (response.status !== 403 && response.status !== 429) {
        throw new Error(`GitHub releases request failed with HTTP ${response.status}`);
      }
      const error = `GitHub returned HTTP ${response.status}.`;
      const limited: CacheDocument = {
        schemaVersion: 1,
        checkedAt,
        etag: cached?.etag ?? null,
        rateLimitedUntil: rateLimitedUntil(response, now),
        candidate: cached?.candidate ?? null,
        error,
      };
      await writeJsonFileAtomic(this.cachePath, limited);
      return this.toCheckResult(limited, "cache");
    }

    const releases = GitHubReleasesSchema.parse(await response.json());
    const newest = selectCandidate(releases, this.runtime.platform, this.runtime.arch);
    const currentIsNewer =
      newest !== null &&
      this.currentVersion !== null &&
      comparePaseoVersions(newest.version, this.currentVersion) <= 0;
    const document: CacheDocument = {
      schemaVersion: 1,
      checkedAt,
      etag: response.headers.get("etag"),
      rateLimitedUntil: null,
      candidate: currentIsNewer ? null : newest,
      error: null,
    };
    await writeJsonFileAtomic(this.cachePath, document);
    return this.toCheckResult(document, "network");
  }

  async prepare(
    tag?: string,
    onProgress?: (status: DistributionUpdateStatus) => void,
  ): Promise<DistributionUpdatePrepareResult> {
    if (this.operationInFlight) {
      return {
        success: false,
        version: null,
        error: "An update operation is already in progress.",
      };
    }
    this.operationInFlight = true;
    try {
      return await this.prepareInternal(tag, onProgress);
    } finally {
      this.operationInFlight = false;
    }
  }

  async apply(
    tag?: string,
    onProgress?: (status: DistributionUpdateStatus) => void,
  ): Promise<DistributionUpdateApplyResult> {
    if (this.operationInFlight) {
      return {
        accepted: false,
        version: null,
        error: "An update operation is already in progress.",
      };
    }
    this.operationInFlight = true;
    try {
      const origin = await this.runtime.resolvePortableInstallOrigin();
      if (!origin) {
        return {
          accepted: false,
          version: null,
          error: "Distribution update only supports a verified portable downstream installation.",
        };
      }

      let status = await this.getStatus();
      if (tag && status.version !== versionFromTag(tag)) status = this.idleStatus();
      if (status.phase !== "prepared" || !status.preparedBundlePath) {
        const prepared = await this.prepareInternal(tag, onProgress);
        if (!prepared.success) {
          return {
            accepted: false,
            version: prepared.version,
            error: prepared.error,
          };
        }
        status = await this.getStatus();
      }
      if (!status.preparedBundlePath || !status.version) {
        return {
          accepted: false,
          version: null,
          error: "Prepared update state is incomplete.",
        };
      }

      return await this.launchInstaller(
        path.join(
          status.preparedBundlePath,
          this.runtime.platform === "win32" ? "install.ps1" : "install.sh",
        ),
        status.version,
        origin,
        onProgress,
        status.preparedBundlePath,
      );
    } finally {
      this.operationInFlight = false;
    }
  }

  async rollback(
    onProgress?: (status: DistributionUpdateStatus) => void,
  ): Promise<DistributionUpdateApplyResult> {
    if (this.operationInFlight) {
      return {
        accepted: false,
        version: null,
        error: "An update operation is already in progress.",
      };
    }
    this.operationInFlight = true;
    try {
      const origin = await this.runtime.resolvePortableInstallOrigin();
      if (!origin || !this.currentVersion) {
        return {
          accepted: false,
          version: null,
          error: "Rollback requires a verified portable downstream installation.",
        };
      }
      const entries = await fs.readdir(path.join(origin.prefix, "releases"), {
        withFileTypes: true,
      });
      const previous = entries
        .filter((entry) => entry.isDirectory() && parsePaseoVersion(entry.name))
        .map((entry) => entry.name)
        .filter((version) => comparePaseoVersions(version, this.currentVersion as string) < 0)
        .sort((left, right) => comparePaseoVersions(right, left))[0];
      if (!previous) {
        return {
          accepted: false,
          version: null,
          error: "No previous portable release is available.",
        };
      }
      const installerPath = path.join(
        origin.prefix,
        "releases",
        previous,
        this.runtime.platform === "win32" ? "install.ps1" : "install.sh",
      );
      try {
        await fs.access(installerPath);
      } catch {
        return {
          accepted: false,
          version: previous,
          error:
            "This previous release predates local rollback support. Failed updates still restore it automatically.",
        };
      }
      return await this.launchInstaller(installerPath, previous, origin, onProgress, null);
    } finally {
      this.operationInFlight = false;
    }
  }

  async getStatus(): Promise<DistributionUpdateStatus> {
    return (await readJsonFile(this.statusPath, UpdateStatusSchema)) ?? this.idleStatus();
  }

  private async prepareInternal(
    tag?: string,
    onProgress?: (status: DistributionUpdateStatus) => void,
  ): Promise<DistributionUpdatePrepareResult> {
    try {
      const candidate = await this.resolveCandidate(tag);
      if (!candidate) {
        return {
          success: false,
          version: null,
          error: "No qualified downstream update is available.",
        };
      }
      await this.setStatus(
        "downloading",
        candidate.version,
        "Downloading verified release",
        onProgress,
      );
      const preparedBundlePath = await this.downloadAndVerify(candidate);
      await this.setStatus(
        "prepared",
        candidate.version,
        "Release is verified and ready",
        onProgress,
        {
          preparedBundlePath,
        },
      );
      return { success: true, version: candidate.version, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.setStatus("failed", null, message, onProgress);
      this.logger.error({ err: error }, "Distribution update preparation failed");
      return { success: false, version: null, error: message };
    }
  }

  private async launchInstaller(
    installerPath: string,
    version: string,
    origin: PortableInstallOrigin,
    onProgress: ((status: DistributionUpdateStatus) => void) | undefined,
    preparedBundlePath: string | null,
  ): Promise<DistributionUpdateApplyResult> {
    try {
      await fs.access(installerPath);
      await this.setStatus(
        "installing",
        version,
        "Installer accepted; Paseo will reconnect after the transaction",
        onProgress,
        { preparedBundlePath },
      );
      await this.runtime.spawnInstaller({
        installerPath,
        prefix: origin.prefix,
        binDir: origin.binDir,
        logPath: path.join(this.paseoHome, "updates", "update.log"),
      });
      return { accepted: true, version, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.setStatus("failed", version, message, onProgress);
      return { accepted: false, version, error: message };
    }
  }

  private async resolveCandidate(tag?: string): Promise<Candidate | null> {
    const cached = await readJsonFile(this.cachePath, CacheDocumentSchema);
    if (!tag) {
      const result = await this.check("manual");
      if (!result.update) return null;
      return (await readJsonFile(this.cachePath, CacheDocumentSchema))?.candidate ?? null;
    }
    if (cached?.candidate?.tag === tag) return cached.candidate;
    const response = await this.runtime.fetch(
      `${DOWNSTREAM_RELEASES_API}/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "paseo-distribution-updater",
        },
      },
    );
    if (!response.ok) throw new Error(`Downstream release ${tag} returned HTTP ${response.status}`);
    return candidateFromRelease(
      GitHubReleaseSchema.parse(await response.json()),
      this.runtime.platform,
      this.runtime.arch,
    );
  }

  private async downloadAndVerify(candidate: Candidate): Promise<string> {
    const updateRoot = path.join(this.paseoHome, "updates", "staged", candidate.version);
    const extractionRoot = path.join(updateRoot, "extracted");
    await fs.rm(updateRoot, { recursive: true, force: true });
    await fs.mkdir(extractionRoot, { recursive: true });
    const manifestPath = path.join(updateRoot, UPDATE_MANIFEST_ASSET);
    const archivePath = path.join(updateRoot, candidate.archiveName);
    const checksumPath = path.join(updateRoot, candidate.checksumName);
    await fetchToFile(this.runtime.fetch, candidate.manifestUrl, manifestPath);
    await fetchToFile(this.runtime.fetch, candidate.checksumUrl, checksumPath);
    await fetchToFile(this.runtime.fetch, candidate.archiveUrl, archivePath);

    if (candidate.manifestDigest && (await sha256File(manifestPath)) !== candidate.manifestDigest) {
      throw new Error("Qualified update manifest digest does not match GitHub release metadata.");
    }
    const manifest = DistributionManifestSchema.parse(
      JSON.parse(await fs.readFile(manifestPath, "utf8")),
    );
    if (manifest.version !== candidate.version || manifest.tag !== candidate.tag) {
      throw new Error("Qualified update manifest identity does not match the selected release.");
    }
    if (
      manifest.minimumUpdaterVersion &&
      this.currentVersion &&
      comparePaseoVersions(this.currentVersion, manifest.minimumUpdaterVersion) < 0
    ) {
      throw new Error(`Update requires Paseo ${manifest.minimumUpdaterVersion} or newer.`);
    }
    const targetKey = `${platformName(this.runtime.platform)}-${normalizedArch(
      this.runtime.platform,
      this.runtime.arch,
    )}`;
    const qualifiedAsset = manifest.assets[targetKey];
    if (!qualifiedAsset || qualifiedAsset.name !== candidate.archiveName) {
      throw new Error(`Qualified update manifest does not contain ${targetKey}.`);
    }
    const checksumText = await fs.readFile(checksumPath, "utf8");
    const checksum = /^([0-9a-f]{64})(?:\s|$)/u.exec(checksumText.trim())?.[1] ?? null;
    const actual = await sha256File(archivePath);
    if (!checksum || checksum !== qualifiedAsset.sha256 || checksum !== actual) {
      throw new Error("Downloaded release SHA-256 verification failed.");
    }
    if (candidate.archiveDigest && candidate.archiveDigest !== actual) {
      throw new Error("Downloaded release digest does not match GitHub release metadata.");
    }

    await this.runtime.extractArchive(archivePath, extractionRoot);
    const bundlePath = path.join(
      extractionRoot,
      `paseo-web-cli-${candidate.version}-${platformName(
        this.runtime.platform,
      )}-${normalizedArch(this.runtime.platform, this.runtime.arch)}`,
    );
    const artifactManifest = JSON.parse(
      await fs.readFile(path.join(bundlePath, "manifest.json"), "utf8"),
    ) as {
      product?: unknown;
      version?: unknown;
      platform?: unknown;
      arch?: unknown;
    };
    assertExtractedArtifactManifest(
      artifactManifest,
      candidate,
      this.runtime.platform,
      this.runtime.arch,
    );
    return bundlePath;
  }

  private toCheckResult(
    document: CacheDocument,
    source: "cache" | "network",
    error: string | null | undefined = undefined,
  ): DistributionUpdateCheckResult {
    return {
      currentVersion: this.currentVersion,
      update: toPublicRelease(document.candidate),
      checkedAt: document.checkedAt,
      source,
      error: error === undefined ? (document.error ?? null) : error,
    };
  }

  private idleStatus(): DistributionUpdateStatus {
    return {
      phase: "idle",
      version: null,
      message: null,
      updatedAt: new Date(this.runtime.now()).toISOString(),
      preparedBundlePath: null,
    };
  }

  private async setStatus(
    phase: DistributionUpdateStatus["phase"],
    version: string | null,
    message: string | null,
    onProgress?: (status: DistributionUpdateStatus) => void,
    extras?: { preparedBundlePath?: string | null },
  ): Promise<void> {
    const status: DistributionUpdateStatus = {
      phase,
      version,
      message,
      updatedAt: new Date(this.runtime.now()).toISOString(),
      preparedBundlePath: extras?.preparedBundlePath ?? null,
    };
    await writeJsonFileAtomic(this.statusPath, status);
    onProgress?.(status);
  }
}

const sharedServices = new Map<string, DistributionUpdateService>();

export function getDistributionUpdateService(
  options: DistributionUpdateServiceOptions,
): DistributionUpdateService {
  const key = `${path.resolve(options.paseoHome)}\u0000${options.currentVersion ?? "unknown"}`;
  const existing = sharedServices.get(key);
  if (existing) return existing;
  const service = new DistributionUpdateService(options);
  sharedServices.set(key, service);
  return service;
}
