import { z } from "zod";

import { PaseoRoleIdSchema, RoleProfileBindingReceiptSchema } from "./role-binding.js";

const UniqueStringListSchema = z.array(z.string().min(1)).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message: "Entries must be unique" });
  }
});

export const RoleProfileLaunchDefaultsSchema = z
  .object({
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    modeId: z.string().min(1).optional(),
    thinkingOptionId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.provider && (value.model || value.modeId || value.thinkingOptionId)) {
      context.addIssue({
        code: "custom",
        message: "Model, mode, and thinking defaults require a provider",
      });
    }
    if (!value.model && value.thinkingOptionId) {
      context.addIssue({
        code: "custom",
        message: "A thinking default requires a model",
      });
    }
  });

export const RoleProfilePreferencesSchema = z
  .object({
    defaults: RoleProfileLaunchDefaultsSchema.optional(),
    allowedTools: UniqueStringListSchema.optional(),
    allowedSkills: UniqueStringListSchema.optional(),
  })
  .strict();

export const RoleProfilePreferencesMapSchema = z
  .object({
    lead: RoleProfilePreferencesSchema.optional(),
    peer: RoleProfilePreferencesSchema.optional(),
    supervisor: RoleProfilePreferencesSchema.optional(),
  })
  .strict();

export const RoleProfileDescriptorSchema = z
  .object({
    roleId: PaseoRoleIdSchema,
    label: z.string().min(1),
    description: z.string().min(1),
    definitionVersion: z.string().min(1),
    definitionDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    instructions: z.string().min(1),
    toolCeiling: UniqueStringListSchema,
    mandatoryTools: UniqueStringListSchema,
    skillCeiling: UniqueStringListSchema,
    mandatorySkills: UniqueStringListSchema,
    preferences: RoleProfilePreferencesSchema,
    effective: RoleProfileBindingReceiptSchema,
  })
  .strict();

export const RoleProfileCatalogSchema = z.object({
  profiles: z.array(RoleProfileDescriptorSchema).length(3),
});

export type RoleProfileLaunchDefaults = z.infer<typeof RoleProfileLaunchDefaultsSchema>;
export type RoleProfilePreferences = z.infer<typeof RoleProfilePreferencesSchema>;
export type RoleProfilePreferencesMap = z.infer<typeof RoleProfilePreferencesMapSchema>;
export type RoleProfileDescriptor = z.infer<typeof RoleProfileDescriptorSchema>;
export type RoleProfileCatalog = z.infer<typeof RoleProfileCatalogSchema>;
