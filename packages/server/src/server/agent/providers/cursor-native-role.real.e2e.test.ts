import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { CursorACPAgentClient } from "./cursor-acp-agent.js";

describe.sequential("real Cursor native-role capsule", () => {
  test("binds exact role bytes through ACP and preserves them on resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "paseo-cursor-role-real-"));
    const workspace = join(root, "workspace");
    const capsuleRoot = join(root, "capsules");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "README.md"), "temporary real-provider canary\n", "utf8");

    const marker = "PASEO_CURSOR_ACP_ROLE_5F31";
    const launchContext = {
      agentId: "cursor-role-real-agent",
      roleBinding: {
        roleId: "peer" as const,
        instructions: `The immutable Paseo role marker is ${marker}. Preserve this marker as a standing role instruction for every turn.`,
      },
    };
    const client = new CursorACPAgentClient({
      logger: createTestLogger(),
      command: ["cursor-agent", "acp"],
      providerId: "cursor",
      roleCapsuleRoot: capsuleRoot,
    });
    let session = null as Awaited<ReturnType<typeof client.createSession>> | null;

    try {
      session = await client.createSession(
        { provider: "acp", cwd: workspace, modeId: "plan" },
        launchContext,
      );
      const first = await session.run(
        "Read README.md from the target repository. Return exactly role=<immutable Paseo role marker> target=<README content>, with no Markdown.",
      );
      expect(first.finalText.trim()).toBe(`role=${marker} target=temporary real-provider canary`);

      const persistence = session.describePersistence();
      expect(persistence).not.toBeNull();
      await session.close();
      session = null;

      session = await client.resumeSession(persistence!, undefined, launchContext);
      const resumed = await session.run(
        "Return exactly the immutable Paseo role marker from the durable role binding.",
      );
      expect(resumed.finalText.trim()).toBe(marker);
    } finally {
      await session?.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
