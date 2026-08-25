import { z } from "zod";

export const COUNCIL_TIERS = ["lens", "debate", "debate-with-proof", "high-risk"] as const;
export const CouncilTierSchema = z.enum(COUNCIL_TIERS);
export type CouncilTier = z.infer<typeof CouncilTierSchema>;

export const COUNCIL_PHASES = ["sealed", "review", "audit", "verdict"] as const;
export const CouncilPhaseSchema = z.enum(COUNCIL_PHASES);
export type CouncilPhase = z.infer<typeof CouncilPhaseSchema>;

export const COUNCIL_SEAT_ROLES = ["scout", "architect", "reviewer"] as const;
export const CouncilSeatRoleSchema = z.enum(COUNCIL_SEAT_ROLES);
export type CouncilSeatRole = z.infer<typeof CouncilSeatRoleSchema>;

export const COUNCIL_SEAT_INTEGRITIES = [
  "unspecified",
  "valid",
  "compromised",
  "missing",
  "redundant",
] as const;
export const CouncilSeatIntegritySchema = z.enum(COUNCIL_SEAT_INTEGRITIES);
export type CouncilSeatIntegrity = z.infer<typeof CouncilSeatIntegritySchema>;

export const CouncilSeatReportReceiptSchema = z.object({
  roomId: z.string().min(1),
  kickoffMessageId: z.string().min(1),
  reportMessageId: z.string().min(1),
  reportDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  authorAgentId: z.string().min(1),
  startSentinel: z.string().min(1),
  endSentinel: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type CouncilSeatReportReceipt = z.infer<typeof CouncilSeatReportReceiptSchema>;

export const CouncilCaseSeatSchema = z.object({
  role: CouncilSeatRoleSchema,
  round: z.string().min(1),
  agentId: z.string().nullable(),
  phase: CouncilPhaseSchema,
  integrity: CouncilSeatIntegritySchema,
  disposition: z.string().nullable(),
  reportReceipt: CouncilSeatReportReceiptSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CouncilCaseSeat = z.infer<typeof CouncilCaseSeatSchema>;

export const CouncilCaseRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    title: z.string().min(1),
    question: z.string().min(1),
    tier: CouncilTierSchema,
    phase: CouncilPhaseSchema,
    roomId: z.string().min(1),
    kickoffMessageId: z.string().min(1),
    scopeId: z.string().min(1),
    workspaceId: z.string().nullable(),
    projectId: z.string().nullable(),
    parentAgentId: z.string().nullable(),
    seats: z.array(CouncilCaseSeatSchema).min(1).max(COUNCIL_SEAT_ROLES.length),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((council, context) => {
    const roles = new Set<CouncilSeatRole>();
    const phaseOrder: Record<CouncilPhase, number> = {
      sealed: 0,
      review: 1,
      audit: 2,
      verdict: 3,
    };
    let highestSeatPhase: CouncilPhase = "sealed";
    for (const [index, seat] of council.seats.entries()) {
      if (roles.has(seat.role)) {
        context.addIssue({
          code: "custom",
          path: ["seats", index, "role"],
          message: `Duplicate Council seat role '${seat.role}'`,
        });
      }
      roles.add(seat.role);
      if (phaseOrder[seat.phase] > phaseOrder[highestSeatPhase]) {
        highestSeatPhase = seat.phase;
      }
      if (seat.integrity === "valid" && !seat.reportReceipt) {
        context.addIssue({
          code: "custom",
          path: ["seats", index, "reportReceipt"],
          message: "A valid Council seat requires a canonical report receipt",
        });
      }
      if (
        seat.reportReceipt &&
        (seat.reportReceipt.authorAgentId !== seat.agentId ||
          seat.reportReceipt.roomId !== council.roomId ||
          seat.reportReceipt.kickoffMessageId !== council.kickoffMessageId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["seats", index, "reportReceipt"],
          message: "Council report receipt does not match its seat or case",
        });
      }
    }
    if (council.phase !== highestSeatPhase) {
      context.addIssue({
        code: "custom",
        path: ["phase"],
        message: "Council case phase must match the highest canonical seat phase",
      });
    }
  });
export type CouncilCaseRecord = z.infer<typeof CouncilCaseRecordSchema>;
