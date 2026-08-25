import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  getDistributionUpdateService,
  type DistributionUpdateService,
  type DistributionUpdateStatus,
} from "./distribution-update-service.js";

type DistributionUpdateRequest = Extract<
  SessionInboundMessage,
  {
    type:
      | "distribution.update.check.request"
      | "distribution.update.prepare.request"
      | "distribution.update.apply.request"
      | "distribution.update.get_status.request"
      | "distribution.update.rollback.request";
  }
>;

const MESSAGE_TYPES: ReadonlySet<SessionInboundMessage["type"]> = new Set([
  "distribution.update.check.request",
  "distribution.update.prepare.request",
  "distribution.update.apply.request",
  "distribution.update.get_status.request",
  "distribution.update.rollback.request",
]);

export interface DistributionUpdateSessionControllerOptions {
  paseoHome: string;
  daemonVersion: string | null;
  emit: (message: SessionOutboundMessage) => void;
  logger: pino.Logger;
  service?: Pick<
    DistributionUpdateService,
    "check" | "prepare" | "apply" | "getStatus" | "rollback"
  >;
}

function isDistributionUpdateRequest(
  message: SessionInboundMessage,
): message is DistributionUpdateRequest {
  return MESSAGE_TYPES.has(message.type);
}

export class DistributionUpdateSessionController {
  private readonly emit: (message: SessionOutboundMessage) => void;
  private readonly service: Pick<
    DistributionUpdateService,
    "check" | "prepare" | "apply" | "getStatus" | "rollback"
  >;

  constructor(options: DistributionUpdateSessionControllerOptions) {
    this.emit = options.emit;
    this.service =
      options.service ??
      getDistributionUpdateService({
        paseoHome: options.paseoHome,
        currentVersion: options.daemonVersion,
        logger: options.logger,
      });
  }

  dispatch(message: SessionInboundMessage): Promise<void> | undefined {
    if (!isDistributionUpdateRequest(message)) return undefined;
    return this.handle(message);
  }

  private async handle(message: DistributionUpdateRequest): Promise<void> {
    if (message.type === "distribution.update.check.request") {
      const result = await this.service.check(message.intent ?? "automatic");
      this.emit({
        type: "distribution.update.check.response",
        payload: { requestId: message.requestId, ...result },
      });
      return;
    }
    if (message.type === "distribution.update.get_status.request") {
      this.emit({
        type: "distribution.update.get_status.response",
        payload: {
          requestId: message.requestId,
          status: await this.service.getStatus(),
        },
      });
      return;
    }

    const onProgress = (status: DistributionUpdateStatus) => {
      this.emit({
        type: "distribution.update.progress",
        payload: { requestId: message.requestId, status },
      });
    };
    if (message.type === "distribution.update.prepare.request") {
      const result = await this.service.prepare(message.tag, onProgress);
      this.emit({
        type: "distribution.update.prepare.response",
        payload: { requestId: message.requestId, ...result },
      });
      return;
    }
    if (message.type === "distribution.update.apply.request") {
      const result = await this.service.apply(message.tag, onProgress);
      this.emit({
        type: "distribution.update.apply.response",
        payload: { requestId: message.requestId, ...result },
      });
      return;
    }
    const result = await this.service.rollback(onProgress);
    this.emit({
      type: "distribution.update.rollback.response",
      payload: { requestId: message.requestId, ...result },
    });
  }
}
