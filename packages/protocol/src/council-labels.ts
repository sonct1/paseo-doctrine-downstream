import { CouncilSeatRoleSchema } from "./council/types.js";

export const COUNCIL_LABEL_PREFIX = "council.";

export const COUNCIL_REPORT_RECEIPT_VERSION_LABEL = "council.report_receipt_version";
export const COUNCIL_REPORT_RECEIPT_VERSION = "1";

const COUNCIL_BOOTSTRAP_LABELS = new Set([
  "council.case_id",
  "council.title",
  "council.tier",
  "council.phase",
  "council.role",
  "council.round",
  "council.integrity",
  "council.room_id",
  "council.kickoff_message_id",
  "council.report_start_sentinel",
  "council.report_end_sentinel",
]);

export function councilLabelKeys(labels: Readonly<Record<string, string>> | undefined): string[] {
  return Object.keys(labels ?? {})
    .filter((key) => key.startsWith(COUNCIL_LABEL_PREFIX))
    .sort();
}

/**
 * Council seats are bootstrapped from the exact labels returned by start_council.
 * Receipt and lifecycle transitions are daemon-managed by record_council_seat.
 */
export function validateCouncilSeatBootstrapLabels(
  labels: Readonly<Record<string, string>> | undefined,
): string | null {
  const keys = councilLabelKeys(labels);
  if (keys.length === 0) return null;

  const unsupported = keys.find((key) => !COUNCIL_BOOTSTRAP_LABELS.has(key));
  if (unsupported) {
    return `Council label '${unsupported}' is daemon-managed and cannot be supplied at agent creation`;
  }
  if (labels?.["council.phase"] !== "sealed") {
    return "Council seat creation requires council.phase=sealed";
  }
  if (labels?.["council.integrity"] !== "unspecified") {
    return "Council seat creation requires council.integrity=unspecified";
  }
  if (!CouncilSeatRoleSchema.safeParse(labels?.["council.role"]).success) {
    return "Council seat creation requires council.role=scout|architect|reviewer";
  }
  return null;
}
