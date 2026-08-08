import { z } from "zod";

export const LeadHandoffStatusSchema = z.enum([
  "packet_ready",
  "successor_authorized",
  "successor_acknowledged",
  "predecessor_released",
  "rejected",
]);

export const LeadHandoffTransitionSchema = z.enum([
  "successor_authorized",
  "successor_acknowledged",
  "predecessor_released",
  "rejected",
]);

const BoundedTextSchema = z.string().trim().min(1).max(2_000);
const BoundedTextListSchema = z.array(BoundedTextSchema).max(50);

export const LeadHandoffEvidenceEntrySchema = z.object({
  ref: z.string().trim().min(1).max(500),
  claim: BoundedTextSchema,
});

export const LeadHandoffReceiptSchema = z.object({
  transition: LeadHandoffTransitionSchema,
  actorAgentId: z.string().min(1).nullable(),
  note: z.string().trim().min(1).max(1_000),
  at: z.string().datetime(),
});

export const LeadHandoffPacketSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  predecessorAgentId: z.string().min(1),
  successorAgentId: z.string().min(1).nullable(),
  currentWriteOwnerAgentId: z.string().min(1),
  objective: BoundedTextSchema,
  scope: z.array(BoundedTextSchema).min(1).max(50),
  currentState: BoundedTextSchema,
  decisions: BoundedTextListSchema,
  failedApproaches: BoundedTextListSchema,
  successfulPatterns: BoundedTextListSchema,
  evidenceIndex: z.array(LeadHandoffEvidenceEntrySchema).min(1).max(100),
  activeRisksAndBlockers: BoundedTextListSchema,
  exactResumePoint: BoundedTextSchema,
  stopCondition: BoundedTextSchema,
  status: LeadHandoffStatusSchema,
  createdAt: z.string().datetime(),
  receipts: z.array(LeadHandoffReceiptSchema),
});

export const PrepareLeadHandoffInputSchema = LeadHandoffPacketSchema.pick({
  predecessorAgentId: true,
  currentWriteOwnerAgentId: true,
  objective: true,
  scope: true,
  currentState: true,
  decisions: true,
  failedApproaches: true,
  successfulPatterns: true,
  evidenceIndex: true,
  activeRisksAndBlockers: true,
  exactResumePoint: true,
  stopCondition: true,
}).extend({
  proposedSuccessorAgentId: z.string().min(1).optional(),
});

export type LeadHandoffPacket = z.infer<typeof LeadHandoffPacketSchema>;
export type LeadHandoffTransition = z.infer<typeof LeadHandoffTransitionSchema>;
export type PrepareLeadHandoffInput = z.infer<typeof PrepareLeadHandoffInputSchema>;
