import { describe, expect, it } from "vitest";
import { resolveComposerInputMode } from "./input-mode";

describe("resolveComposerInputMode", () => {
  it("hides attachments, voice, and agent autocomplete for a Room/Council message", () => {
    const presentation = resolveComposerInputMode("room");
    expect(presentation).toMatchObject({
      showAttachments: false,
      showVoice: false,
      showAutocomplete: false,
      showAgentControls: false,
      isMonospace: false,
    });
  });
});
