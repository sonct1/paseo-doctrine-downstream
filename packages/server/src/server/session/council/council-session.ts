import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { CouncilCaseStore } from "../../council/council-case-store.js";

interface CouncilSessionHost {
  emit(message: SessionOutboundMessage): void;
}

export class CouncilSession {
  constructor(
    private readonly host: CouncilSessionHost,
    private readonly store: Pick<CouncilCaseStore, "list">,
  ) {}

  async handleListRequest(
    request: Extract<SessionInboundMessage, { type: "council.case.list.request" }>,
  ): Promise<void> {
    try {
      this.host.emit({
        type: "council.case.list.response",
        payload: {
          requestId: request.requestId,
          cases: await this.store.list(),
          error: null,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "council.case.list.response",
        payload: {
          requestId: request.requestId,
          cases: [],
          error: error instanceof Error ? error.message : "Council case list failed",
        },
      });
    }
  }
}
