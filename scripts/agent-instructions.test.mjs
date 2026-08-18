import assert from "node:assert/strict";
import { lstatSync, readlinkSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);

// Agent runtimes cap instruction files and truncate silently (Codex cuts the
// AGENTS.md chain at 32 KiB by default). A rule pushed past the cap stops
// existing without any error, so the budget leaves headroom for nested files.
const CLAUDE_MD_BYTE_BUDGET = 20 * 1024;

test("CLAUDE.md stays inside the agent-instruction byte budget", () => {
  const size = statSync(new URL("CLAUDE.md", repoRoot)).size;
  assert.ok(
    size <= CLAUDE_MD_BYTE_BUDGET,
    `CLAUDE.md is ${size} bytes, over the ${CLAUDE_MD_BYTE_BUDGET}-byte budget. ` +
      "Move content into an owned doc under docs/ and leave a link (see docs/README.md).",
  );
});

test("AGENTS.md remains a symlink to CLAUDE.md", () => {
  // Codex-family agents read AGENTS.md, Claude-family agents read CLAUDE.md.
  // A regular-file copy would fork the operating rules and drift silently.
  const agentsUrl = new URL("AGENTS.md", repoRoot);
  assert.ok(
    lstatSync(fileURLToPath(agentsUrl)).isSymbolicLink(),
    "AGENTS.md must be a symlink to CLAUDE.md, not a regular file",
  );
  assert.equal(readlinkSync(fileURLToPath(agentsUrl)), "CLAUDE.md");
});
