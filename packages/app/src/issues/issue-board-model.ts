import type { BeadsIssue, BeadsIssueStatus } from "@getpaseo/protocol/beads/rpc-schemas";
import type { IssueStatusFilter } from "./data";

export const ISSUE_BOARD_STATUSES: readonly BeadsIssueStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
];

export interface IssueBoardColumn {
  status: BeadsIssueStatus;
  issues: BeadsIssue[];
}

function compareIssues(left: BeadsIssue, right: BeadsIssue): number {
  return left.priority - right.priority || left.id.localeCompare(right.id);
}

export function buildIssueBoard(
  issues: readonly BeadsIssue[],
  filter: IssueStatusFilter,
): IssueBoardColumn[] {
  const statuses = filter === "all" ? ISSUE_BOARD_STATUSES : [filter];
  return statuses.map((status) => ({
    status,
    issues: issues.filter((issue) => issue.status === status).sort(compareIssues),
  }));
}
