import { describe, expect, it } from "vitest";
import type { BeadsIssue } from "@getpaseo/protocol/beads/rpc-schemas";
import { buildIssueBoard } from "./issue-board-model";

function issue(id: string, status: BeadsIssue["status"], priority: number): BeadsIssue {
  return { id, title: id, status, priority, issue_type: "task" };
}

describe("buildIssueBoard", () => {
  it("creates stable workflow columns and sorts each lane by priority", () => {
    const board = buildIssueBoard(
      [issue("open-low", "open", 3), issue("blocked", "blocked", 1), issue("open-high", "open", 0)],
      "all",
    );

    expect(board.map((column) => column.status)).toEqual([
      "open",
      "in_progress",
      "blocked",
      "deferred",
      "closed",
    ]);
    expect(board[0]?.issues.map((entry) => entry.id)).toEqual(["open-high", "open-low"]);
    expect(board[2]?.issues.map((entry) => entry.id)).toEqual(["blocked"]);
  });

  it("projects a single lane for a status filter", () => {
    const board = buildIssueBoard(
      [issue("open", "open", 2), issue("closed", "closed", 2)],
      "closed",
    );
    expect(board).toEqual([{ status: "closed", issues: [issue("closed", "closed", 2)] }]);
  });
});
