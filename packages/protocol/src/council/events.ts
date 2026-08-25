import { z } from "zod";
import { CouncilCaseRecordSchema } from "./types.js";

export const CouncilCaseUpdatedSchema = z.object({
  type: z.literal("council.case.updated"),
  payload: z.object({
    case: CouncilCaseRecordSchema,
  }),
});
