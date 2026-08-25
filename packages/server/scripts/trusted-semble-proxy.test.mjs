import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { resolveTrustedSembleCallArguments } from "./trusted-semble-proxy.mjs";

describe("trusted Semble workspace confinement", () => {
  test("canonicalizes the assignment root and an in-root related file", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "paseo-semble-proxy-"));
    const workspace = join(temporaryRoot, "workspace");
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "src", "index.ts"), "export {};\n");
    const canonicalWorkspace = await realpath(workspace);

    await expect(
      resolveTrustedSembleCallArguments("search", { query: "entry", repo: "." }, workspace),
    ).resolves.toMatchObject({ query: "entry", repo: canonicalWorkspace });
    await expect(
      resolveTrustedSembleCallArguments(
        "find_related",
        { file_path: "src/index.ts", line: 1, repo: workspace },
        workspace,
      ),
    ).resolves.toMatchObject({
      file_path: "src/index.ts",
      line: 1,
      repo: canonicalWorkspace,
    });
  });

  test("rejects remote repos, adjacent roots, and symlink escapes", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "paseo-semble-proxy-"));
    const workspace = join(temporaryRoot, "workspace");
    const adjacent = join(temporaryRoot, "adjacent");
    await mkdir(workspace);
    await mkdir(adjacent);
    await writeFile(join(adjacent, "outside.ts"), "export {};\n");
    await symlink(join(adjacent, "outside.ts"), join(workspace, "escape.ts"));

    await expect(
      resolveTrustedSembleCallArguments(
        "search",
        { query: "entry", repo: "https://example.test/repo.git" },
        workspace,
      ),
    ).rejects.toThrow("rejects remote repository URLs");
    await expect(
      resolveTrustedSembleCallArguments("search", { query: "entry", repo: adjacent }, workspace),
    ).rejects.toThrow("must equal the assignment workspace root");
    await expect(
      resolveTrustedSembleCallArguments(
        "find_related",
        { file_path: "escape.ts", line: 1, repo: workspace },
        workspace,
      ),
    ).rejects.toThrow("must stay inside the assignment workspace root");
  });
});
