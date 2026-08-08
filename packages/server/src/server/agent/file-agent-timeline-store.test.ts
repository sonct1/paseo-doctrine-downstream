import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { writeJsonFileAtomic } from "../atomic-file.js";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";

test("retains canonical timeline rows and epoch across store restarts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-agent-timeline-store-"));
  const agentId = "agent-1";
  try {
    const first = new FileAgentTimelineStore(root);
    await first.bulkInsert(agentId, [
      {
        seq: 1,
        timestamp: "2026-08-08T00:00:00.000Z",
        item: { type: "user_message", text: "question" },
      },
      {
        seq: 2,
        timestamp: "2026-08-08T00:00:01.000Z",
        item: { type: "assistant_message", text: "answer" },
      },
    ]);
    const firstPage = await first.fetchCommitted(agentId, { direction: "tail", limit: 0 });

    const restarted = new FileAgentTimelineStore(root);
    const restartedPage = await restarted.fetchCommitted(agentId, {
      direction: "tail",
      limit: 0,
    });
    expect(restartedPage.epoch).toBe(firstPage.epoch);
    expect(restartedPage.rows.map((row) => row.item)).toEqual([
      { type: "user_message", text: "question" },
      { type: "assistant_message", text: "answer" },
    ]);

    await restarted.bulkInsert(agentId, [restartedPage.rows[1]]);
    await restarted.updateCommittedRow(agentId, {
      ...restartedPage.rows[1],
      providerMessageId: "provider-message-2",
    });
    const appended = await restarted.appendCommitted(
      agentId,
      { type: "assistant_message", text: "follow-up" },
      { timestamp: "2026-08-08T00:00:02.000Z" },
    );
    expect(appended.seq).toBe(3);

    const secondRestart = new FileAgentTimelineStore(root);
    const rows = await secondRestart.getCommittedRows(agentId);
    expect(rows).toHaveLength(3);
    expect(rows[1].providerMessageId).toBe("provider-message-2");
    expect(await secondRestart.getLastAssistantMessage(agentId)).toBe("answerfollow-up");

    await secondRestart.deleteAgent(agentId);
    const afterDelete = new FileAgentTimelineStore(root);
    await expect(afterDelete.getCommittedRows(agentId)).resolves.toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not commit memory before disk and retries the same row after a transient failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-agent-timeline-retry-"));
  const agentId = "agent-retry";
  let failRowWrite = true;
  const store = new FileAgentTimelineStore(root, async (filePath, value) => {
    if (failRowWrite && filePath.endsWith(`${path.sep}rows${path.sep}1.json`)) {
      failRowWrite = false;
      throw new Error("injected row write failure");
    }
    await writeJsonFileAtomic(filePath, value);
  });
  const row = {
    seq: 1,
    timestamp: "2026-08-08T00:00:00.000Z",
    item: { type: "assistant_message" as const, text: "repair me" },
  };

  try {
    await expect(store.bulkInsert(agentId, [row])).rejects.toThrow("injected row write failure");
    await expect(store.getCommittedRows(agentId)).resolves.toEqual([]);

    await expect(store.bulkInsert(agentId, [row])).resolves.toBeUndefined();
    await writeFile(
      path.join(root, encodeURIComponent(agentId), "rows", ".1.json.partial.tmp"),
      '{"seq":',
      "utf8",
    );
    const restarted = new FileAgentTimelineStore(root);
    await expect(restarted.getCommittedRows(agentId)).resolves.toEqual([row]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
