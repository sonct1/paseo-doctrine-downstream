import { createHash } from "node:crypto";

import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";

import type { BeadsService } from "../../beads/beads-service.js";
import type { ProjectRegistry } from "../../workspace-registry.js";

interface BeadsSessionHost {
  emit(message: SessionOutboundMessage): void;
}

export interface BeadsSessionOptions {
  host: BeadsSessionHost;
  service: BeadsService;
  projectRegistry: Pick<ProjectRegistry, "get">;
  clientId: string;
}

function humanActor(clientId: string): string {
  return `paseo-human-${createHash("sha256").update(clientId).digest("hex").slice(0, 12)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class BeadsSession {
  private readonly actor: string;

  constructor(private readonly options: BeadsSessionOptions) {
    this.actor = humanActor(options.clientId);
  }

  async handleList(
    message: Extract<SessionInboundMessage, { type: "beads.issues.list.request" }>,
  ): Promise<void> {
    const runtime = await this.options.service.status();
    if (!runtime.available) {
      this.options.host.emit({
        type: "beads.issues.list.response",
        payload: {
          requestId: message.requestId,
          projectId: message.projectId,
          runtime,
          issues: [],
          truncated: false,
          error: runtime.reason ?? "Beads Central is unavailable",
        },
      });
      return;
    }
    try {
      await this.requireActiveProject(message.projectId);
      const limit = message.limit ?? 100;
      const issues = await this.options.service.list(
        { projectId: message.projectId, actor: this.actor },
        { status: message.status, limit: limit + 1 },
      );
      this.options.host.emit({
        type: "beads.issues.list.response",
        payload: {
          requestId: message.requestId,
          projectId: message.projectId,
          runtime,
          issues: issues.slice(0, limit),
          truncated: issues.length > limit,
          error: null,
        },
      });
    } catch (error) {
      this.options.host.emit({
        type: "beads.issues.list.response",
        payload: {
          requestId: message.requestId,
          projectId: message.projectId,
          runtime,
          issues: [],
          truncated: false,
          error: errorMessage(error),
        },
      });
    }
  }

  async handleCreate(
    message: Extract<SessionInboundMessage, { type: "beads.issue.create.request" }>,
  ): Promise<void> {
    try {
      await this.requireActiveProject(message.projectId);
      const issue = await this.options.service.create(
        { projectId: message.projectId, actor: this.actor },
        {
          title: message.title,
          description: message.description,
          issueType: message.issueType,
          priority: message.priority,
          acceptance: message.acceptance,
          idempotencyKey: message.idempotencyKey,
        },
      );
      this.options.host.emit({
        type: "beads.issue.create.response",
        payload: {
          requestId: message.requestId,
          projectId: message.projectId,
          issue,
          error: null,
        },
      });
    } catch (error) {
      this.options.host.emit({
        type: "beads.issue.create.response",
        payload: {
          requestId: message.requestId,
          projectId: message.projectId,
          issue: null,
          error: errorMessage(error),
        },
      });
    }
  }

  async handleGet(
    message: Extract<SessionInboundMessage, { type: "beads.issue.get.request" }>,
  ): Promise<void> {
    try {
      await this.requireActiveProject(message.projectId);
      const issue = await this.options.service.get(
        { projectId: message.projectId, actor: this.actor },
        message.issueId,
      );
      this.options.host.emit({
        type: "beads.issue.get.response",
        payload: {
          requestId: message.requestId,
          projectId: message.projectId,
          issue,
          error: null,
        },
      });
    } catch (error) {
      this.options.host.emit({
        type: "beads.issue.get.response",
        payload: {
          requestId: message.requestId,
          projectId: message.projectId,
          issue: null,
          error: errorMessage(error),
        },
      });
    }
  }

  async handleClose(
    message: Extract<SessionInboundMessage, { type: "beads.issue.close.request" }>,
  ): Promise<void> {
    try {
      await this.requireActiveProject(message.projectId);
      const issue = await this.options.service.close(
        { projectId: message.projectId, actor: this.actor },
        message.issueId,
        message.reason,
        message.idempotencyKey,
      );
      this.options.host.emit({
        type: "beads.issue.close.response",
        payload: {
          requestId: message.requestId,
          projectId: message.projectId,
          issue,
          error: null,
        },
      });
    } catch (error) {
      this.options.host.emit({
        type: "beads.issue.close.response",
        payload: {
          requestId: message.requestId,
          projectId: message.projectId,
          issue: null,
          error: errorMessage(error),
        },
      });
    }
  }

  private async requireActiveProject(projectId: string): Promise<void> {
    const project = await this.options.projectRegistry.get(projectId);
    if (!project || project.archivedAt) {
      throw new Error(`Project ${projectId} is unavailable or archived`);
    }
  }
}
