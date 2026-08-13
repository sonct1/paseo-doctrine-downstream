#!/usr/bin/env bash
# Keep the local Paseo daemon on the build we are actually developing.
#
# The failure this exists to prevent: an installed daemon can carry the same version
# string as the source while holding different bytes. That happened on 2026-08-13 and
# blocked every repository whose Workspace Protocol was newer than the stale build.
# Build provenance (source commit + fingerprint) is the only reliable signal, so this
# script compares it rather than trusting the version number.
#
#   ./scripts/local-stack.sh            report drift, exit 1 if stale
#   ./scripts/local-stack.sh --apply    import Foundation, build, install, restart
#
# --apply refuses to restart while any agent is running or starting, per the universal
# idle-readback rule in ROLE_CONTRACTS.md.

set -euo pipefail

PRODUCT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FOUNDATION_ROOT="${PASEO_FOUNDATION_ROOT:-$(cd "$PRODUCT_ROOT/../paseo-foundation" 2>/dev/null && pwd || true)}"
PASEO_BIN="${PASEO_BIN:-$HOME/.local/bin/paseo}"

MODE=check
[ "${1:-}" = "--apply" ] && MODE=apply

say() { printf '%s\n' "$*"; }
fail() { printf 'local-stack: %s\n' "$*" >&2; exit 1; }

# --- what is installed -------------------------------------------------------

release_dir() {
  [ -e "$PASEO_BIN" ] || return 1
  ( cd "$(dirname "$(readlink "$PASEO_BIN" || echo "$PASEO_BIN")")/.." && pwd )
}

installed_provenance() {
  local dir
  dir="$(release_dir)" || return 1
  local file="$dir/app/node_modules/@getpaseo/server/dist/server/build-provenance.json"
  [ -f "$file" ] || return 1
  printf '%s' "$file"
}

# Fingerprint of just what ships into the daemon. The provenance file records a whole-tree
# fingerprint, which flips on any doc edit and would cry stale for changes the daemon never
# sees. This one is scoped to packages/ and foundation/dist/, written beside the release at
# install time, and compared on the next check — so "stale" means runtime code actually moved.
runtime_fingerprint() {
  node -e '
    const { createHash } = require("node:crypto");
    const { execFileSync } = require("node:child_process");
    const { readFileSync, readlinkSync, lstatSync } = require("node:fs");
    const { resolve } = require("node:path");
    const root = process.argv[1];
    const scope = ["packages", "foundation/dist"];
    const git = (a, o = {}) => execFileSync("git", ["-C", root, ...a], { maxBuffer: 64 << 20, ...o });
    const h = createHash("sha256");
    h.update("paseo-runtime-scope-v1\0");
    h.update(git(["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
    h.update("\0diff\0");
    h.update(git(["diff", "--binary", "--no-ext-diff", "HEAD", "--", ...scope]));
    const untracked = git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...scope],
      { encoding: "utf8" }).split("\0").filter(Boolean).sort();
    for (const rel of untracked) {
      const abs = resolve(root, rel);
      h.update("\0untracked\0"); h.update(rel); h.update("\0");
      if (lstatSync(abs).isSymbolicLink()) h.update(`symlink:${readlinkSync(abs)}`);
      else h.update(readFileSync(abs));
    }
    console.log(h.digest("hex"));
  ' "$1"
}

# Reproduces packages/server/scripts/write-build-provenance.mjs exactly, for the commit line.
current_fingerprint() {
  node -e '
    const { createHash } = require("node:crypto");
    const { execFileSync } = require("node:child_process");
    const { readFileSync, readlinkSync, lstatSync } = require("node:fs");
    const { resolve } = require("node:path");
    const root = process.argv[1];
    const git = (a, o = {}) => execFileSync("git", ["-C", root, ...a], { maxBuffer: 64 << 20, ...o });
    const commit = git(["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const diff = git(["diff", "--binary", "--no-ext-diff", "HEAD", "--"]);
    const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
      .split("\0").filter(Boolean).sort();
    const h = createHash("sha256");
    h.update("paseo-source-fingerprint-v1\0");
    h.update(commit);
    h.update("\0tracked-diff\0");
    h.update(diff);
    for (const rel of untracked) {
      const abs = resolve(root, rel);
      h.update("\0untracked\0"); h.update(rel); h.update("\0");
      if (lstatSync(abs).isSymbolicLink()) h.update(`symlink:${readlinkSync(abs)}`);
      else h.update(readFileSync(abs));
    }
    console.log(h.digest("hex"));
  ' "$1"
}

# --- current source ----------------------------------------------------------

product_head="$(git -C "$PRODUCT_ROOT" rev-parse HEAD)"
product_dirty=false
[ -n "$(git -C "$PRODUCT_ROOT" status --porcelain)" ] && product_dirty=true
product_fingerprint="$(current_fingerprint "$PRODUCT_ROOT")"

foundation_head=""
foundation_locked=""
if [ -n "$FOUNDATION_ROOT" ] && [ -d "$FOUNDATION_ROOT/.git" ]; then
  foundation_head="$(git -C "$FOUNDATION_ROOT" rev-parse HEAD)"
  foundation_locked="$(node -e "try{console.log(require('$PRODUCT_ROOT/foundation/sources.lock.json').foundation.commit)}catch{console.log('')}")"
fi

# --- report ------------------------------------------------------------------

drift=0
say "Paseo local stack"
say ""

if prov_file="$(installed_provenance)"; then
  installed_fingerprint="$(node -e "console.log(require('$prov_file').sourceFingerprint ?? '')")"
  installed_commit="$(node -e "console.log(require('$prov_file').sourceCommit ?? '')")"
  installed_at="$(node -e "console.log(require('$prov_file').builtAt ?? '')")"
  say "  installed build   ${installed_commit:0:12}  fp ${installed_fingerprint:0:12}  built $installed_at"
else
  installed_fingerprint=""
  say "  installed build   (no provenance found)"
fi

say "  product source    ${product_head:0:12}  fp ${product_fingerprint:0:12}  dirty=$product_dirty"

runtime_now="$(runtime_fingerprint "$PRODUCT_ROOT")"
runtime_stamp="$(cat "$(release_dir)/.local-stack-runtime-fp" 2>/dev/null || true)"
if [ -n "$runtime_stamp" ]; then
  say "  runtime scope     built ${runtime_stamp:0:12}  now ${runtime_now:0:12}"
  [ "$runtime_stamp" = "$runtime_now" ] || drift=1
else
  # No stamp: this release predates the scoped check, so fall back to the whole-tree fingerprint.
  [ -n "$installed_fingerprint" ] && [ "$installed_fingerprint" = "$product_fingerprint" ] || drift=1
fi

if [ -n "$foundation_head" ]; then
  say "  foundation        ${foundation_head:0:12}  locked ${foundation_locked:0:12}"
  [ "$foundation_head" = "$foundation_locked" ] || drift=1
fi

say ""
if [ "$drift" -eq 0 ]; then
  say "  up to date — the daemon is running this exact tree"
  exit 0
fi

say "  STALE — runtime code has moved since this daemon was built"

if [ "$MODE" = check ]; then
  say "  run: ./scripts/local-stack.sh --apply"
  exit 1
fi

# --- apply -------------------------------------------------------------------

say ""
say "Applying..."

[ -n "$FOUNDATION_ROOT" ] || fail "set PASEO_FOUNDATION_ROOT"
[ -z "$(git -C "$FOUNDATION_ROOT" status --porcelain)" ] ||
  fail "Foundation worktree must be clean before import (untracked files count too)"

if [ "$foundation_head" != "$foundation_locked" ]; then
  ref="$(git -C "$FOUNDATION_ROOT" describe --tags --exact-match HEAD 2>/dev/null || true)"
  [ -n "$ref" ] || fail "tag the Foundation commit first: git -C $FOUNDATION_ROOT tag -a foundation-v… -m …"
  version="${ref#foundation-v}"
  upstream="$(node -e "console.log(require('$PRODUCT_ROOT/foundation/sources.lock.json').paseoUpstream.commit)")"
  say "  importing Foundation $ref"
  node "$PRODUCT_ROOT/scripts/import-foundation.mjs" \
    --source "$FOUNDATION_ROOT" --foundation-ref "$ref" \
    --foundation-version "$version" --paseo-upstream-ref "$upstream"
fi

# build:macos-web-cli-artifact rebuilds server deps but not @getpaseo/protocol, and the web
# bundle resolves protocol subpaths straight out of its dist. If a previous clean emptied that
# dist the Metro step fails with an unresolved-module error that looks like a code fault but is
# only build order, so materialise protocol first.
say "  building protocol"
( cd "$PRODUCT_ROOT" && npm run --silent build:protocol )

say "  building artifact"
( cd "$PRODUCT_ROOT" && PASEO_RELEASE_ALLOW_DIRTY=1 npm run --silent build:macos-web-cli-artifact )

version="$(node -e "console.log(require('$PRODUCT_ROOT/package.json').version)")"
bundle="$PRODUCT_ROOT/artifacts/paseo-web-cli-$version-macos-$(node -e 'console.log(process.arch)')"
[ -x "$bundle/install.sh" ] || fail "no installer at $bundle/install.sh"

# Idle readback: never swap the daemon out from under live work.
if [ -x "$PASEO_BIN" ]; then
  busy="$("$PASEO_BIN" agent ls --global --json 2>/dev/null |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      let a=[];try{a=JSON.parse(s);a=Array.isArray(a)?a:(a.agents??[])}catch{}
      console.log(a.filter(x=>['running','starting'].includes(String(x.status??''))).length)})" || echo 0)"
  [ "${busy:-0}" = "0" ] || fail "$busy agent(s) running or starting — not restarting; retry when idle"
fi

say "  installing $version"
"$bundle/install.sh"

# Stamp what the runtime scope looked like at build time. The next check compares against this
# rather than the whole-tree fingerprint, so editing a doc does not read as a stale daemon.
printf '%s\n' "$(runtime_fingerprint "$PRODUCT_ROOT")" > "$(release_dir)/.local-stack-runtime-fp"

say "  done — verify with: ./scripts/local-stack.sh"
