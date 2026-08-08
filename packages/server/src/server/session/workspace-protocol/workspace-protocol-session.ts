import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../../workspace-registry.js";
import {
  inspectWorkspaceProtocol,
  writeWorkspaceProtocol,
} from "../../../utils/workspace-protocol-file.js";

export interface WorkspaceProtocolSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export class WorkspaceProtocolSession {
  constructor(
    private readonly options: {
      host: WorkspaceProtocolSessionHost;
      projectRegistry: Pick<ProjectRegistry, "list">;
      workspaceRegistry: Pick<WorkspaceRegistry, "list">;
      logger: pino.Logger;
    },
  ) {}

  async handleInspectRequest(
    msg: Extract<SessionInboundMessage, { type: "foundation.workspaceProtocol.inspect.request" }>,
  ): Promise<void> {
    const repoRoot = await this.resolveKnownProjectRoot(msg.repoRoot);
    if (!repoRoot) {
      this.options.host.emit({
        type: "foundation.workspaceProtocol.inspect.response",
        payload: { requestId: msg.requestId, ok: false, error: { code: "project_not_found" } },
      });
      return;
    }

    const snapshot = inspectWorkspaceProtocol(repoRoot);
    this.options.logger.debug(
      { repoRoot, requestId: msg.requestId, outcome: snapshot.status },
      "Inspected workspace protocol",
    );
    this.options.host.emit({
      type: "foundation.workspaceProtocol.inspect.response",
      payload: { requestId: msg.requestId, ok: true, snapshot },
    });
  }

  async handleWriteRequest(
    msg: Extract<SessionInboundMessage, { type: "foundation.workspaceProtocol.write.request" }>,
  ): Promise<void> {
    const repoRoot = await this.resolveKnownProjectRoot(msg.repoRoot);
    if (!repoRoot) {
      this.options.host.emit({
        type: "foundation.workspaceProtocol.write.response",
        payload: { requestId: msg.requestId, ok: false, error: { code: "project_not_found" } },
      });
      return;
    }

    const result = writeWorkspaceProtocol({
      repoRoot,
      content: msg.content,
      expectedRevision: msg.expectedRevision,
    });
    this.options.logger.info(
      {
        repoRoot,
        requestId: msg.requestId,
        outcome: result.ok ? result.snapshot.status : result.error.code,
      },
      "Handled workspace protocol write",
    );
    this.options.host.emit({
      type: "foundation.workspaceProtocol.write.response",
      payload: result.ok
        ? { requestId: msg.requestId, ok: true, snapshot: result.snapshot }
        : { requestId: msg.requestId, ok: false, error: result.error },
    });
  }

  private async resolveKnownProjectRoot(repoRoot: string): Promise<string | null> {
    const requestedRoot = canonicalizeRoot(repoRoot);
    const [projects, workspaces] = await Promise.all([
      this.options.projectRegistry.list(),
      this.options.workspaceRegistry.list(),
    ]);
    for (const project of projects) {
      if (project.archivedAt !== null) continue;
      const projectRoot = canonicalizeRoot(project.rootPath);
      if (requestedRoot === projectRoot) return projectRoot;
    }
    for (const workspace of workspaces) {
      if (workspace.archivedAt !== null) continue;
      const candidateRoots = [workspace.cwd, workspace.worktreeRoot].filter(
        (candidate): candidate is string => Boolean(candidate),
      );
      for (const candidate of candidateRoots) {
        const workspaceRoot = canonicalizeRoot(candidate);
        if (requestedRoot === workspaceRoot) return workspaceRoot;
      }
    }
    return null;
  }
}

function canonicalizeRoot(repoRoot: string): string {
  const resolved = resolve(repoRoot);
  try {
    return stripTrailingPathSeparators(realpathSync(resolved));
  } catch {
    return stripTrailingPathSeparators(resolved);
  }
}

function stripTrailingPathSeparators(path: string): string {
  let normalized = path;
  while (normalized.length > 1 && normalized.endsWith(sep)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
