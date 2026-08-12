import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { isSameOrDescendantPath } from "./path-utils.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("isSameOrDescendantPath", () => {
  test("matches an existing workspace through a filesystem alias", () => {
    const root = mkdtempSync(path.join(tmpdir(), "paseo-path-alias-"));
    temporaryDirectories.push(root);
    const workspace = path.join(root, "workspace");
    const child = path.join(workspace, "packages", "server");
    const alias = path.join(root, "workspace-alias");
    mkdirSync(child, { recursive: true });
    symlinkSync(workspace, alias, process.platform === "win32" ? "junction" : "dir");

    expect(isSameOrDescendantPath(alias, workspace)).toBe(true);
    expect(isSameOrDescendantPath(alias, child)).toBe(true);
    expect(isSameOrDescendantPath(workspace, path.join(alias, "packages", "server"))).toBe(true);
  });

  test("keeps unrelated and lexical-prefix paths outside the workspace", () => {
    expect(isSameOrDescendantPath("/repo/work", "/repo/worktree")).toBe(false);
    expect(isSameOrDescendantPath("C:\\Repo\\Work", "c:\\repo\\work\\src")).toBe(true);
  });
});
