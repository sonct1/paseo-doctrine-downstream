import { z } from "zod";
import { CouncilCaseRecordSchema } from "./types.js";

export const CouncilCaseListRequestSchema = z.object({
  type: z.literal("council.case.list.request"),
  requestId: z.string(),
});

export const CouncilCaseListResponseSchema = z.object({
  type: z.literal("council.case.list.response"),
  payload: z.object({
    requestId: z.string(),
    cases: z.array(CouncilCaseRecordSchema),
    error: z.string().nullable(),
  }),
});
