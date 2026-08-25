import { describe, expect, test } from "vitest";
import {
  COUNCIL_REPORT_RECEIPT_VERSION_LABEL,
  councilLabelKeys,
  validateCouncilSeatBootstrapLabels,
} from "./council-labels.js";

const bootstrapLabels = {
  "council.case_id": "case-1",
  "council.title": "Review the boundary",
  "council.tier": "debate-with-proof",
  "council.phase": "sealed",
  "council.role": "scout",
  "council.round": "1",
  "council.integrity": "unspecified",
  "council.room_id": "room-1",
  "council.kickoff_message_id": "kickoff-1",
  "council.report_start_sentinel": "SCOUT_COUNCIL_REPORT_V1",
  "council.report_end_sentinel": "SCOUT_COUNCIL_REPORT_END",
};

describe("Council label authority", () => {
  test("accepts the sealed bootstrap labels returned by start_council", () => {
    expect(validateCouncilSeatBootstrapLabels(bootstrapLabels)).toBeNull();
  });

  test("rejects caller-supplied Council lifecycle and receipt transitions", () => {
    expect(
      validateCouncilSeatBootstrapLabels({
        ...bootstrapLabels,
        "council.phase": "verdict",
      }),
    ).toBe("Council seat creation requires council.phase=sealed");
    expect(
      validateCouncilSeatBootstrapLabels({
        ...bootstrapLabels,
        [COUNCIL_REPORT_RECEIPT_VERSION_LABEL]: "1",
      }),
    ).toContain("is daemon-managed");
    expect(
      validateCouncilSeatBootstrapLabels({
        ...bootstrapLabels,
        "council.role": "auditor",
      }),
    ).toBe("Council seat creation requires council.role=scout|architect|reviewer");
  });

  test("finds only Council-owned labels", () => {
    expect(councilLabelKeys({ team: "infra", "council.role": "reviewer" })).toEqual([
      "council.role",
    ]);
  });
});
