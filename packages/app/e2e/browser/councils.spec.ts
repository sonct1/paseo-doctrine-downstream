import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Client as CouncilMcpClient,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { AssignmentEnvelope } from "@getpaseo/protocol/assignment-contract";
import { buildHostCouncilRoute } from "@/utils/host-routes";
import { expect, test } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";

const NATIVE_COUNCIL_ROLES = ["scout", "architect", "reviewer"] as const;

// Production only exposes a Peer-delegation route for the supported provider
// allowlist (packages/protocol/src/provider-config.ts), which does not
// include the deterministic e2e "mock" provider. A custom provider extending
// "codex" is the one Product-supported way around this: it inherits real
// Codex's modes/role-binding metadata (packages/server/src/server/agent
// /provider-registry.ts createDerivedDefinition), so no-write Peer
// enforcement resolves exactly as it would for real Codex. The command below
// is a real, local, terminating Node process that answers the Codex
// app-server JSON-RPC-over-stdio protocol just far enough to let a seat
// reach a terminal turn without any provider credentials.
const COUNCIL_PEER_PROVIDER_ID = "council-e2e-codex";
const COUNCIL_PEER_MODEL_ID = "council-e2e-terminal";

const FAKE_CODEX_APP_SERVER_SCRIPT = `
"use strict";
let buffer = "";
function send(message) {
  process.stdout.write(\`\${JSON.stringify(message)}\\n\`);
}
const RESPONSES = {
  initialize: () => ({}),
  "account/read": () => ({ account: { type: "chatgpt" } }),
  "collaborationMode/list": () => ({ data: [] }),
  "config/read": () => ({ config: {} }),
  getUserSavedConfig: () => ({ config: {} }),
  "model/list": () => ({
    data: [{ id: "${COUNCIL_PEER_MODEL_ID}", isDefault: true, defaultReasoningEffort: "medium" }],
  }),
  "skills/list": () => ({ data: [] }),
  "thread/start": () => ({ thread: { id: "thread-1" } }),
  "thread/loaded/list": () => ({ data: [] }),
  "thread/resume": () => ({}),
  "config/mcpServer/reload": () => ({}),
  "mcpServerStatus/list": () => ({
    data: [
      {
        name: "paseo",
        authStatus: "notRequired",
        resourceTemplates: [],
        resources: [],
        tools: { beads_status: {}, beads_get: {} },
      },
    ],
    nextCursor: null,
  }),
  "mcpServer/tool/call": () => ({ content: [], structuredContent: {} }),
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf("\\n");
  while (newlineIndex !== -1) {
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);
    newlineIndex = buffer.indexOf("\\n");
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined || message.id === null) continue;
    if (message.method === "turn/start") {
      send({ id: message.id, result: {} });
      const threadId = "thread-1";
      send({ method: "turn/started", params: { threadId, turn: { id: "turn-1" } } });
      send({
        method: "turn/completed",
        params: { threadId, turn: { id: "turn-1", status: "completed", error: null } },
      });
      continue;
    }
    const handler = RESPONSES[message.method];
    send({ id: message.id, result: handler ? handler() : {} });
  }
});
process.stdin.on("end", () => process.exit(0));
`;

function writeFakeCodexAppServerScript(): { scriptPath: string; scriptDir: string } {
  const scriptDir = mkdtempSync(join(tmpdir(), "paseo-council-e2e-codex-"));
  const scriptPath = join(scriptDir, "fake-codex-app-server.cjs");
  writeFileSync(scriptPath, FAKE_CODEX_APP_SERVER_SCRIPT, "utf8");
  return { scriptPath, scriptDir };
}

/** Idempotent: safe to call more than once, and safe if the directory was never created. */
function removeFakeCodexAppServerScriptDir(scriptDir: string): void {
  rmSync(scriptDir, { recursive: true, force: true });
}

interface CouncilPeerDelegationPolicy {
  enabled: boolean;
  allowedModels: Array<{ provider: string; model: string }>;
  runMode: "unattended" | "prompt-per-turn";
}

interface CouncilDaemonConfigClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  getDaemonConfig(): Promise<{
    config: {
      peerDelegation?: CouncilPeerDelegationPolicy;
      mcp?: { injectIntoAgents?: boolean };
    };
  }>;
  patchDaemonConfig(config: {
    providers?: Record<string, Record<string, unknown>>;
    removeProviders?: string[];
    peerDelegation?: CouncilPeerDelegationPolicy;
    mcp?: { injectIntoAgents?: boolean };
  }): Promise<unknown>;
}

/**
 * Seeds a test-owned, terminating Peer-delegation route on the isolated e2e
 * daemon so a Lead's create_agent calls for a Peer resolve to a real (fake)
 * Codex app-server process instead of production's supported-provider
 * allowlist rejecting the deterministic "mock" provider outright. Restored
 * by the caller once every Council scenario in this file has finished.
 */
async function seedCouncilPeerDelegationRoute(): Promise<{
  restore: () => Promise<void>;
  scriptDir: string;
}> {
  const client = await connectDaemonClient<CouncilDaemonConfigClient>({
    clientIdPrefix: "council-peer-delegation-e2e",
  });
  const previousConfig = await client.getDaemonConfig();
  const previousPeerDelegation = previousConfig.config.peerDelegation;
  const previousInjectIntoAgents = previousConfig.config.mcp?.injectIntoAgents;
  const { scriptPath, scriptDir } = writeFakeCodexAppServerScript();
  try {
    await client.patchDaemonConfig({
      providers: {
        [COUNCIL_PEER_PROVIDER_ID]: {
          extends: "codex",
          label: "Council E2E Codex",
          description: "Test-owned terminating Codex route for Council seat fixtures",
          enabled: true,
          command: [process.execPath, scriptPath],
          models: [
            {
              id: COUNCIL_PEER_MODEL_ID,
              label: "Council E2E terminal",
              description: "Deterministic terminating model for Council seat fixtures",
            },
          ],
        },
      },
      peerDelegation: {
        enabled: true,
        allowedModels: [{ provider: COUNCIL_PEER_PROVIDER_ID, model: COUNCIL_PEER_MODEL_ID }],
        runMode: "unattended",
      },
      // The isolated e2e daemon disables MCP injection into launched agents by
      // default (test isolation), which also blocks the mandatory Paseo MCP
      // server a role-bound Codex session requires. Test-owned, restored below.
      mcp: { injectIntoAgents: true },
    });
  } catch (error) {
    removeFakeCodexAppServerScriptDir(scriptDir);
    await client.close().catch(() => undefined);
    throw error;
  }
  return {
    scriptDir,
    restore: async () => {
      try {
        await client
          .patchDaemonConfig({
            removeProviders: [COUNCIL_PEER_PROVIDER_ID],
            peerDelegation: previousPeerDelegation ?? {
              enabled: false,
              allowedModels: [],
              runMode: "unattended",
            },
            mcp: { injectIntoAgents: previousInjectIntoAgents ?? false },
          })
          .catch(() => undefined);
        await client.close().catch(() => undefined);
      } finally {
        removeFakeCodexAppServerScriptDir(scriptDir);
      }
    },
  };
}

interface CouncilSeatPlan {
  role: (typeof NATIVE_COUNCIL_ROLES)[number];
  labels: Record<string, string>;
  reportStartSentinel: string;
  reportEndSentinel: string;
}

interface StartCouncilResult {
  caseId: string;
  title: string;
  room: { id: string };
  seats: CouncilSeatPlan[];
}

interface CouncilSeedClient {
  postChatMessage(input: {
    room: string;
    body: string;
    authorAgentId?: string;
  }): Promise<{ message: { id: string } | null; error: string | null }>;
  waitForFinish(agentId: string, timeout?: number): Promise<{ status: string }>;
}

function leadAssignment(): AssignmentEnvelope {
  return {
    version: 1,
    disposition: "lead-direct",
    objective: "Run the bounded Council case.",
    // "delegation" (not "read-only") is required: create_agent rejects a Peer
    // creation unless the Lead's own assignment carries delegation authority
    // (packages/server/src/server/agent/tools/paseo-tools.ts hasLeadDelegationAuthority).
    effectClass: "delegation",
    mutationBoundary: { mode: "no-write" },
    externalEffectBoundary: { mode: "denied" },
    evidence: "Return the Council reports and Lead verdict.",
    handbackAndStop: "Stop after the binding verdict or a material blocker.",
  };
}

function peerAssignment(): AssignmentEnvelope {
  return {
    version: 1,
    disposition: "peer-execution",
    objective: "Author the sealed Council seat report in the bounded Room.",
    effectClass: "read-only",
    mutationBoundary: { mode: "no-write" },
    externalEffectBoundary: { mode: "denied" },
    evidence: "Post exactly one sentinel-wrapped report message in the Council Room.",
    handbackAndStop: "Stop once the report message is posted.",
  };
}

/**
 * Calls a Council MCP tool over the real Agent MCP endpoint, scoped as the
 * caller agent. This is the only daemon-supported way to mint or advance a
 * Council case; there is no WS RPC for it, by design (see
 * packages/protocol/src/council-labels.ts). It is also, as of the current
 * production validation, the only path that may attach council.* labels to
 * a created agent at all: session-kind (WS) agent creation now rejects any
 * council.* label outright.
 */
async function callAgentMcpTool<T>(input: {
  callerAgentId: string;
  name: string;
  arguments: Record<string, unknown>;
}): Promise<T> {
  const url = new URL(`http://127.0.0.1:${getE2EDaemonPort()}/mcp/agents`);
  url.searchParams.set("callerAgentId", input.callerAgentId);
  const transport = new StreamableHTTPClientTransport(url);
  const client = new CouncilMcpClient({ name: "paseo-council-e2e", version: "1.0.0" });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: input.name, arguments: input.arguments });
    if (result.isError) {
      throw new Error(`${input.name} failed: ${JSON.stringify(result)}`);
    }
    return result.structuredContent as T;
  } finally {
    await client.close();
  }
}

async function startCouncil(input: { leadId: string; title: string }): Promise<StartCouncilResult> {
  return callAgentMcpTool<StartCouncilResult>({
    callerAgentId: input.leadId,
    name: "start_council",
    arguments: {
      title: input.title,
      question: "Should this Council reach a bound verdict?",
      tier: "high-risk",
    },
  });
}

/**
 * Creates one native role-bound Peer Council seat through the real
 * create_agent MCP tool as a direct child of the Lead. This is the only
 * production-legal way to attach council.* labels to an agent; the parent
 * link is injected by the daemon from callerAgentId, not passed by hand.
 */
async function createCouncilSeat(input: {
  leadId: string;
  role: string;
  labels: Record<string, string>;
}): Promise<string> {
  const result = await callAgentMcpTool<{ agentId: string }>({
    callerAgentId: input.leadId,
    name: "create_agent",
    arguments: {
      title: input.role,
      role: "peer",
      assignment: peerAssignment(),
      labels: input.labels,
      initialPrompt: "Reply done and stop",
      notifyOnFinish: false,
    },
  });
  return result.agentId;
}

async function recordCouncilSeatVerdict(input: {
  leadId: string;
  caseId: string;
  agentId: string;
  reportMessageId: string;
}): Promise<void> {
  await callAgentMcpTool({
    callerAgentId: input.leadId,
    name: "record_council_seat",
    arguments: {
      caseId: input.caseId,
      agentId: input.agentId,
      phase: "verdict",
      integrity: "valid",
      reportMessageId: input.reportMessageId,
    },
  });
}

async function createLead(workspace: Awaited<ReturnType<typeof seedWorkspace>>) {
  return workspace.client.createAgent({
    provider: "mock",
    cwd: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    title: "Council Lead",
    modeId: "load-test",
    model: "ten-second-stream",
    roleId: "lead",
    assignment: leadAssignment(),
  });
}

/**
 * Drives a real Council through production's only authoritative path: the
 * Lead calls start_council, then create_agent once for exactly the three
 * canonical native roles it returns. Every seat is run to a terminal
 * lifecycle before the scenario returns. Optionally advances every seat to
 * a genuine daemon-recorded verdict via record_council_seat, using the
 * Room, kickoff, and sentinels start_council itself created.
 */
async function seedCouncilScenario(caseTitle: string, options: { verdict?: boolean } = {}) {
  const workspace = await seedWorkspace({ repoPrefix: "council-ui-" });
  const seedClient = workspace.client as unknown as CouncilSeedClient;
  try {
    const lead = await createLead(workspace);
    const plan = await startCouncil({ leadId: lead.id, title: caseTitle });

    const seatIds = await Promise.all(
      plan.seats.map(async (seatPlan) => {
        const seatId = await createCouncilSeat({
          leadId: lead.id,
          role: seatPlan.role,
          labels: seatPlan.labels,
        });
        await seedClient.waitForFinish(seatId, 60_000);

        if (options.verdict) {
          const report = await seedClient.postChatMessage({
            room: plan.room.id,
            body: `${seatPlan.reportStartSentinel}\nSeat report body for ${seatPlan.role}.\n${seatPlan.reportEndSentinel}`,
            authorAgentId: seatId,
          });
          if (!report.message) {
            throw new Error(report.error ?? "Failed to post Council seat report message");
          }
          await recordCouncilSeatVerdict({
            leadId: lead.id,
            caseId: plan.caseId,
            agentId: seatId,
            reportMessageId: report.message.id,
          });
        }

        return seatId;
      }),
    );

    return {
      caseId: plan.caseId,
      title: plan.title,
      leadId: lead.id,
      seatIds,
      workspaceId: workspace.workspaceId,
      cleanup: workspace.cleanup,
    };
  } catch (error) {
    await workspace.cleanup();
    throw error;
  }
}

test.describe("Council case surface", () => {
  let restoreCouncilPeerDelegationRoute: () => Promise<void>;
  let councilPeerDelegationScriptDir: string;

  test.beforeAll(async () => {
    const seeded = await seedCouncilPeerDelegationRoute();
    restoreCouncilPeerDelegationRoute = seeded.restore;
    councilPeerDelegationScriptDir = seeded.scriptDir;
    expect(existsSync(councilPeerDelegationScriptDir)).toBe(true);
  });

  test.afterAll(async () => {
    await restoreCouncilPeerDelegationRoute();
    expect(existsSync(councilPeerDelegationScriptDir)).toBe(false);
  });

  test("projects labeled seats at desktop and compact viewports", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const scenario = await seedCouncilScenario("Phase 6 dirty implementation review", {
      verdict: true,
    });
    try {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(buildHostCouncilRoute(getServerId(), scenario.caseId, scenario.workspaceId));

      const detail = page.getByTestId(`council-detail-${scenario.caseId}`);
      await expect(detail).toBeVisible({ timeout: 30_000 });
      await expect(detail.getByText(scenario.title, { exact: true })).toBeVisible();
      await expect(
        page.getByText("One accountable Lead. Architect + Reviewer. No vote."),
      ).toBeVisible();
      await expect(
        page.getByTestId(`council-row-phase-${scenario.caseId}-${scenario.workspaceId}`),
      ).toContainText("Lead-linked verdict marker");
      await expect(page.getByTestId("council-phase-rail")).toContainText(
        "Lead-linked verdict marker",
      );
      await expect(
        page
          .getByTestId("council-verdict-summary")
          .getByText("Lead-linked verdict marker", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "The canonical case entered verdict through its daemon-authorized Lead owner. Open the case owner or Room to inspect the binding decision and handoff evidence.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.locator('[data-testid^="council-open-agent-"]')).toHaveCount(3);
      await expect(page.getByTestId("councils-list")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("council-desktop.png"),
        animations: "disabled",
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(detail).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("councils-list")).toHaveCount(0);
      await expect(page.getByText("Seats", { exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("council-compact.png"),
        animations: "disabled",
      });
    } finally {
      await scenario.cleanup();
    }
  });

  test("does not call a finished but unaudited seat report ready", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await seedCouncilScenario("Phase 6 unaudited report review");
    try {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(buildHostCouncilRoute(getServerId(), scenario.caseId, scenario.workspaceId));

      const detail = page.getByTestId(`council-detail-${scenario.caseId}`);
      await expect(detail).toBeVisible({ timeout: 30_000 });
      await expect(detail.getByText("Awaiting Lead audit", { exact: true })).toHaveCount(3);
      await expect(detail.getByText("Report ready", { exact: true })).toHaveCount(0);
      await expect(
        detail.getByText(
          "The seat finished, but the Lead has not marked its report as valid. Inspect the timeline before counting it.",
          { exact: true },
        ),
      ).toHaveCount(3);
    } finally {
      await scenario.cleanup();
    }
  });

  test("keeps canonical cases isolated across workspaces", async ({ page }) => {
    test.setTimeout(120_000);
    const first = await seedCouncilScenario("Workspace one Council");
    const second = await seedCouncilScenario("Workspace two Council");
    try {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(buildHostCouncilRoute(getServerId(), second.caseId, second.workspaceId));

      await expect(
        page.getByTestId(`council-row-${first.caseId}-${first.workspaceId}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`council-row-${second.caseId}-${second.workspaceId}`),
      ).toBeVisible();

      const detail = page.getByTestId(`council-detail-${second.caseId}`);
      await expect(detail).toBeVisible({ timeout: 30_000 });
      await expect(detail.getByText("Workspace two Council", { exact: true })).toBeVisible();
      await expect(detail.getByText("Workspace one Council", { exact: true })).toHaveCount(0);
      await expect(detail.locator('[data-testid^="council-open-agent-"]')).toHaveCount(3);
      const list = page.getByTestId("councils-list");
      await expect(list.getByText("Workspace one Council", { exact: true })).toBeVisible();
      await expect(list.getByText("Workspace two Council", { exact: true })).toBeVisible();
    } finally {
      await Promise.all([first.cleanup(), second.cleanup()]);
    }
  });
});
