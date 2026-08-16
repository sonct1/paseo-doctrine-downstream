import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { syncReleaseNotes } from "./sync-release-notes-from-changelog.mjs";

function withTempChangelog(fn, changelogText = "## 0.1.60-beta.1 - 2026-04-20\n\n- Beta notes.\n") {
  const previousCwd = process.cwd();
  const tempDir = mkdtempSync(path.join(tmpdir(), "paseo-release-notes-test-"));
  process.chdir(tempDir);
  writeFileSync("CHANGELOG.md", changelogText);

  try {
    fn();
  } finally {
    process.chdir(previousCwd);
    rmSync(tempDir, { force: true, recursive: true });
  }
}

test("updates an existing release body through the release id API", () => {
  withTempChangelog(() => {
    const calls = [];

    const execFileSync = (command, args, options) => {
      calls.push({ args, command, options });

      if (args[0] === "api" && args[1] === "repos/getpaseo/paseo/releases/tags/v0.1.60-beta.1") {
        return JSON.stringify({ id: 311163621 });
      }

      if (args[0] === "api" && args[1] === "-X" && args[2] === "PATCH") {
        const notesArg = args.find((arg) => arg.startsWith("body=@"));
        assert.ok(notesArg, "PATCH should send the notes body from a file");
        const notesPath = notesArg.slice("body=@".length);
        assert.match(notesPath, /v0\.1\.60-beta\.1-notes\.md$/);
        return "";
      }

      throw new Error(`Unexpected gh call: ${command} ${args.join(" ")}`);
    };

    syncReleaseNotes(["--repo", "getpaseo/paseo", "--tag", "v0.1.60-beta.1"], {
      execFileSync,
    });

    assert.equal(
      calls.some((call) => call.args[0] === "release" && call.args[1] === "edit"),
      false,
      "retagged releases should not use gh release edit because it can resend tag_name",
    );
    assert.equal(
      calls.some(
        (call) =>
          call.args[0] === "api" &&
          call.args[1] === "-X" &&
          call.args[2] === "PATCH" &&
          call.args[3] === "repos/getpaseo/paseo/releases/311163621",
      ),
      true,
      "existing releases should be patched by release id",
    );
  });
});

test("converts contributor profile links to mentions in synced release notes", () => {
  const changelogText = [
    "## 0.1.60-beta.1 - 2026-04-20",
    "",
    "- Beta notes. ([#526](https://github.com/getpaseo/paseo/pull/526) by [@therainisme](https://github.com/therainisme))",
    "",
  ].join("\n");

  withTempChangelog(() => {
    let syncedNotes = "";

    const execFileSync = (command, args) => {
      if (args[0] === "api" && args[1] === "repos/getpaseo/paseo/releases/tags/v0.1.60-beta.1") {
        return JSON.stringify({ id: 311163621 });
      }

      if (args[0] === "api" && args[1] === "-X" && args[2] === "PATCH") {
        const notesArg = args.find((arg) => arg.startsWith("body=@"));
        assert.ok(notesArg, "PATCH should send the notes body from a file");
        syncedNotes = readFileSync(notesArg.slice("body=@".length), "utf8");
        return "";
      }

      throw new Error(`Unexpected gh call: ${command} ${args.join(" ")}`);
    };

    syncReleaseNotes(["--repo", "getpaseo/paseo", "--tag", "v0.1.60-beta.1"], {
      execFileSync,
    });

    assert.match(syncedNotes, /by @therainisme\)/);
    assert.doesNotMatch(syncedNotes, /\[@therainisme\]\(https:\/\/github\.com\/therainisme\)/);
  }, changelogText);
});

test("skips downstream changelog versions on branch-triggered sync", () => {
  const changelogText = "## 0.4.0-paseo.2 - 2026-08-16\n\n- Downstream notes.\n";

  withTempChangelog(() => {
    const calls = [];
    const messages = [];
    const originalLog = console.log;
    console.log = (message) => messages.push(String(message));

    try {
      syncReleaseNotes(
        ["--repo", "webplode/paseo-doctrine-downstream", "--skip-unsupported-version"],
        {
          execFileSync: (...args) => calls.push(args),
        },
      );
    } finally {
      console.log = originalLog;
    }

    assert.deepEqual(calls, []);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /Skipping release notes sync/);
    assert.match(messages[0], /0\.4\.0-paseo\.2/);
  }, changelogText);
});

test("keeps unsupported explicit release sync strict", () => {
  const changelogText = "## 0.4.0-paseo.2 - 2026-08-16\n\n- Downstream notes.\n";

  withTempChangelog(() => {
    assert.throws(
      () =>
        syncReleaseNotes([
          "--repo",
          "webplode/paseo-doctrine-downstream",
          "--tag",
          "v0.4.0-paseo.2",
        ]),
      /Unsupported release version/,
    );
  }, changelogText);
});
