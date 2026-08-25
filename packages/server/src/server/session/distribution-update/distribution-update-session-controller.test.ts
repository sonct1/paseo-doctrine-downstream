import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { describe, expect, test, vi } from "vitest";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import type {
  DistributionUpdateService,
  DistributionUpdateStatus,
} from "./distribution-update-service.js";
import { DistributionUpdateSessionController } from "./distribution-update-session-controller.js";

type UpdateService = Pick<
  DistributionUpdateService,
  "check" | "prepare" | "apply" | "getStatus" | "rollback"
>;

function createService(): UpdateService {
  return {
    check: vi.fn(async () => ({
      currentVersion: "0.5.0-paseo.38",
      update: null,
      checkedAt: "2026-08-25T00:00:00.000Z",
      source: "cache" as const,
      error: null,
    })),
    prepare: vi.fn(async () => ({ success: true, version: "0.5.0-paseo.39", error: null })),
    apply: vi.fn(async () => ({ accepted: true, version: "0.5.0-paseo.39", error: null })),
    getStatus: vi.fn(async () => ({
      phase: "idle" as const,
      version: null,
      message: null,
      updatedAt: "2026-08-25T00:00:00.000Z",
      preparedBundlePath: null,
    })),
    rollback: vi.fn(async () => ({ accepted: true, version: "0.5.0-paseo.37", error: null })),
  };
}

function createController(service = createService()) {
  const emitted: SessionOutboundMessage[] = [];
  return {
    emitted,
    service,
    controller: new DistributionUpdateSessionController({
      paseoHome: "/tmp/paseo-test",
      daemonVersion: "0.5.0-paseo.38",
      emit: (message) => emitted.push(message),
      logger: createTestLogger(),
      service,
    }),
  };
}

describe("DistributionUpdateSessionController", () => {
  test("returns undefined synchronously for messages owned by another subsystem", () => {
    const { controller } = createController();
    const message: SessionInboundMessage = {
      type: "daemon.get_status.request",
      requestId: "status-1",
    };

    expect(controller.dispatch(message)).toBeUndefined();
  });

  test("forwards the cold-open intent and emits the correlated check response", async () => {
    const { controller, emitted, service } = createController();

    await controller.dispatch({
      type: "distribution.update.check.request",
      requestId: "check-1",
      intent: "automatic",
    });

    expect(service.check).toHaveBeenCalledWith("automatic");
    expect(emitted).toEqual([
      {
        type: "distribution.update.check.response",
        payload: {
          requestId: "check-1",
          currentVersion: "0.5.0-paseo.38",
          update: null,
          checkedAt: "2026-08-25T00:00:00.000Z",
          source: "cache",
          error: null,
        },
      },
    ]);
  });

  test("emits apply progress before the correlated acceptance response", async () => {
    const service = createService();
    vi.mocked(service.apply).mockImplementation(async (_tag, onProgress) => {
      const status: DistributionUpdateStatus = {
        phase: "installing",
        version: "0.5.0-paseo.39",
        message: "Installer accepted",
        updatedAt: "2026-08-25T00:00:01.000Z",
        preparedBundlePath: "/tmp/prepared",
      };
      onProgress?.(status);
      return { accepted: true, version: status.version, error: null };
    });
    const { controller, emitted } = createController(service);

    await controller.dispatch({
      type: "distribution.update.apply.request",
      requestId: "apply-1",
      tag: "paseo-v0.5.0-paseo.39",
    });

    expect(emitted.map((message) => message.type)).toEqual([
      "distribution.update.progress",
      "distribution.update.apply.response",
    ]);
    expect(emitted[0]?.payload.requestId).toBe("apply-1");
    expect(emitted[1]).toEqual({
      type: "distribution.update.apply.response",
      payload: {
        requestId: "apply-1",
        accepted: true,
        version: "0.5.0-paseo.39",
        error: null,
      },
    });
  });
});
