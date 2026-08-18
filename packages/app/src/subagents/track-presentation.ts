import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { SubagentRow } from "./select";
import { isFinishedSubagent } from "./archive-finished";
import { providerSubagentLifecycleStatus } from "./provider-store";

function presentationStatus(row: SubagentRow) {
  if (row.kind === "paseo") return row.status;
  return providerSubagentLifecycleStatus(row.status);
}

export interface SubagentRowPresentationData {
  key: string;
  kind: "agent";
  label: string;
  subtitle: string;
  titleState: "ready" | "loading";
  statusBucket: SidebarStateBucket | null;
}

export function buildSubagentRowPresentationData(row: SubagentRow): SubagentRowPresentationData {
  // The task distinguishes siblings in a fan-out, so it names the row when present. Providers
  // own the compact secondary context because model, effort, and usage semantics differ.
  const description = resolveRowLabel(row.description);
  const title = resolveRowLabel(row.title);
  const label = description ?? title;
  const providerSubtitle = row.kind === "provider" ? resolveRowLabel(row.subtitle) : null;
  const permissionCount = row.kind === "paseo" ? row.pendingPermissionCount : 0;
  const permissionSubtitle =
    permissionCount > 0
      ? `${permissionCount} ${permissionCount === 1 ? "approval" : "approvals"} needed`
      : null;
  const subtitle = permissionSubtitle ?? providerSubtitle ?? (description ? title : null);
  const status = presentationStatus(row);
  return {
    key: `${row.kind}_subagent_${row.id}`,
    kind: "agent",
    label: label ?? "",
    subtitle: subtitle ?? "",
    titleState: label ? "ready" : "loading",
    statusBucket: deriveSidebarStateBucket({
      status,
      pendingPermissionCount: permissionCount,
      requiresAttention: permissionCount > 0,
      attentionReason: permissionCount > 0 ? "permission" : null,
    }),
  };
}

export function formatHeaderLabel(rows: readonly SubagentRow[]): string {
  let runningCount = 0;
  let pendingPermissionCount = 0;
  for (const row of rows) {
    if (row.status === "running") {
      runningCount += 1;
    }
    if (row.kind === "paseo") {
      pendingPermissionCount += row.pendingPermissionCount;
    }
  }

  const parts = [`${rows.length} ${rows.length === 1 ? "subagent" : "subagents"}`];
  if (runningCount > 0) {
    parts.push(`${runningCount} running`);
  }
  if (pendingPermissionCount > 0) {
    parts.push(
      `${pendingPermissionCount} ${pendingPermissionCount === 1 ? "approval" : "approvals"}`,
    );
  }
  return parts.join(" · ");
}

export function countFinishedSubagents(rows: readonly SubagentRow[]): number {
  return rows.filter(isFinishedSubagent).length;
}

export function resolveRowLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}
