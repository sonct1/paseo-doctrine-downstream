import { z } from "zod";

export const PolicyPluginIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/u, "Policy plugin ID must be a lowercase Paseo plugin ID");

export const PolicyGenerationDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const PolicyOwnerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("legacy-core"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("plugin"),
      pluginId: PolicyPluginIdSchema,
      generationDigest: PolicyGenerationDigestSchema,
      policyVersion: z.string().trim().min(1),
    })
    .strict(),
]);

export type PolicyOwner = z.infer<typeof PolicyOwnerSchema>;

export const LEGACY_CORE_POLICY_OWNER = { kind: "legacy-core" } as const satisfies PolicyOwner;
