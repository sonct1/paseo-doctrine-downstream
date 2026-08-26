import { describe, expect, it } from "vitest";
import { resolveChatAuthorAgentId } from "./shared.js";

describe("resolveChatAuthorAgentId", () => {
  it("uses the explicit unprivileged manual identity for human CLI posts", () => {
    expect(resolveChatAuthorAgentId({})).toBe("manual");
    expect(resolveChatAuthorAgentId({ PASEO_AGENT_ID: "   " })).toBe("manual");
  });

  it("fails closed when an agent attempts to claim identity through chat RPC", () => {
    expect(() => resolveChatAuthorAgentId({ PASEO_AGENT_ID: " peer-seat " })).toThrow(
      expect.objectContaining({ code: "CHAT_AGENT_AUTHOR_UNTRUSTED" }),
    );
  });
});
