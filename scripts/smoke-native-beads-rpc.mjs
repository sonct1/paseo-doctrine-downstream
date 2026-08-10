import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appRoot = process.env.PASEO_SMOKE_APP;
const port = process.env.PASEO_SMOKE_PORT;
const projectPath = process.env.PASEO_SMOKE_PROJECT;
if (!appRoot || !port || !projectPath) {
  throw new Error("PASEO_SMOKE_APP, PASEO_SMOKE_PORT, and PASEO_SMOKE_PROJECT are required");
}

const clientModule = pathToFileURL(
  path.join(appRoot, "node_modules", "@getpaseo", "client", "dist", "daemon-client.js"),
).href;
const { DaemonClient } = await import(clientModule);
const client = new DaemonClient({
  url: `ws://127.0.0.1:${port}/ws`,
  clientId: `artifact-beads-smoke-${Date.now()}`,
  clientType: "cli",
  reconnect: { enabled: false },
});

try {
  await client.connect();
  const added = await client.addProject(projectPath);
  assert.equal(added.error, null);
  assert.ok(added.project?.projectId);
  const projectId = added.project.projectId;

  const empty = await client.listBeadsIssues({ projectId, limit: 20 });
  assert.equal(empty.error, null);
  assert.deepEqual(empty.runtime, { available: true, version: "1.1.2" });
  assert.deepEqual(empty.issues, []);

  const created = await client.createBeadsIssue({
    projectId,
    title: "Artifact-native Beads smoke",
    description: "Created through the packaged daemon and packaged client.",
    issueType: "task",
    priority: 2,
    idempotencyKey: "artifact-smoke-create-v1",
  });
  assert.equal(created.error, null);
  assert.ok(created.issue?.id);
  const issueId = created.issue.id;

  const readback = await client.getBeadsIssue({ projectId, issueId });
  assert.equal(readback.error, null);
  assert.equal(readback.issue?.title, "Artifact-native Beads smoke");
  const listed = await client.listBeadsIssues({ projectId, limit: 20 });
  assert.equal(listed.error, null);
  assert.ok(listed.issues.some((issue) => issue.id === issueId));

  const closed = await client.closeBeadsIssue({
    projectId,
    issueId,
    reason: "Packaged RPC round trip passed",
    idempotencyKey: "artifact-smoke-close-v1",
  });
  assert.equal(closed.error, null);
  assert.equal(closed.issue?.status, "closed");
  const closedReadback = await client.getBeadsIssue({ projectId, issueId });
  assert.equal(closedReadback.error, null);
  assert.equal(closedReadback.issue?.status, "closed");

  process.stdout.write(`BEADS_RPC_OK project=${projectId} issue=${issueId}\n`);
} finally {
  await client.close();
}
