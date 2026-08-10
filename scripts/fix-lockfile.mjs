#!/usr/bin/env node
// Workaround for https://github.com/npm/cli/issues/4460
//
// npm silently omits `resolved` and `integrity` fields from some
// package-lock.json entries in workspace monorepos (especially for
// workspace-hoisted packages). npm acknowledged this as a bug in 2022
// but has never shipped a fix.
//
// This is harmless for regular `npm ci`, but breaks offline installers
// like Nix that need every entry to have a resolved URL + integrity hash
// so they can pre-fetch all tarballs in a sandbox with no network access.
//
// This script finds incomplete entries and fills them in using `npm view`.
// It's idempotent — running it on an already-complete lockfile is a no-op.
//
// See also: https://github.com/npm/cli/issues/4263
//           https://github.com/npm/cli/issues/6301
//
// Usage:
//   node scripts/fix-lockfile.mjs
//   node scripts/fix-lockfile.mjs path/to/package-lock.json

import fs from "fs";
const checkMode = process.argv.includes("--check");
const lockPath =
  process.argv.slice(2).find((argument) => argument !== "--check") || "package-lock.json";
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const registry = (process.env.npm_config_registry || "https://registry.npmjs.org").replace(
  /\/$/,
  "",
);
const fetchConcurrency = 24;

// Collect workspace package roots (local packages, not from npm)
const workspaceRoots = new Set();
for (const [key, val] of Object.entries(lock.packages || {})) {
  if (val.link) {
    workspaceRoots.add(val.resolved || key);
  }
}

const incompleteEntries = [];

for (const [key, val] of Object.entries(lock.packages || {})) {
  if (
    !key || // root package
    val.link || // workspace link entry
    (val.resolved && val.integrity) || // already complete
    !val.version || // no version to look up
    workspaceRoots.has(key) // workspace package root (local, not on npm)
  )
    continue;

  const nodeModulesIndex = key.lastIndexOf("node_modules/");
  if (nodeModulesIndex === -1) continue;

  incompleteEntries.push({
    val,
    pkgName: val.name || key.slice(nodeModulesIndex + "node_modules/".length),
    version: val.version,
  });
}

const lookups = new Map();
for (const entry of incompleteEntries) {
  const lookupKey = `${entry.pkgName}\0${entry.version}`;
  if (!lookups.has(lookupKey)) {
    lookups.set(lookupKey, {
      pkgName: entry.pkgName,
      version: entry.version,
      entries: [],
    });
  }
  lookups.get(lookupKey).entries.push(entry.val);
}

if (checkMode && incompleteEntries.length > 0) {
  console.error(
    `ERROR: ${incompleteEntries.length} lockfile entries are missing resolved/integrity metadata. Run scripts/update-nix.sh.`,
  );
  process.exit(1);
}

async function fetchDist(pkgName, version) {
  const packagePath = pkgName.replace("/", "%2f");
  const url = `${registry}/${packagePath}/${encodeURIComponent(version)}`;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const info = await response.json();
      if (!info.dist?.tarball || !info.dist?.integrity) {
        throw new Error("registry response is missing dist.tarball or dist.integrity");
      }
      return info.dist;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
  }

  throw lastError;
}

const pendingLookups = [...lookups.values()];
let nextLookup = 0;
let fixed = 0;
let failed = 0;

async function worker() {
  while (nextLookup < pendingLookups.length) {
    const lookup = pendingLookups[nextLookup++];

    try {
      const dist = await fetchDist(lookup.pkgName, lookup.version);
      for (const entry of lookup.entries) {
        entry.resolved = dist.tarball;
        entry.integrity = dist.integrity;
        fixed++;
      }
    } catch (error) {
      failed++;
      console.error(
        `Warning: could not fetch info for ${lookup.pkgName}@${lookup.version}: ${error.message}`,
      );
    }
  }
}

await Promise.all(
  Array.from({ length: Math.min(fetchConcurrency, pendingLookups.length) }, () => worker()),
);

if (fixed > 0) {
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  console.log(`Fixed ${fixed} lockfile entries with missing resolved/integrity`);
} else {
  console.log("Lockfile is already complete");
}

if (failed > 0) {
  console.error(`ERROR: ${failed} registry package lookup(s) remain incomplete`);
}

if (failed > 0) process.exitCode = 1;
