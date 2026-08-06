import { z } from "zod";
import { PaseoRoleIdSchema } from "./role-binding.js";

export const PASEO_LAUNCH_CONTRACT_VERSION = 1 as const;

export const ProviderRouteKindSchema = z.enum([
  "codex-subscription",
  "openai-compatible",
  "provider-native",
]);
export type ProviderRouteKind = z.infer<typeof ProviderRouteKindSchema>;

export const ProviderAuthMethodSchema = z.enum([
  "codex-native",
  "credential-command",
  "provider-native",
]);
export type ProviderAuthMethod = z.infer<typeof ProviderAuthMethodSchema>;

const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

/** Secret-safe receipt for one immutable role and provider launch route. */
export const LaunchContractReceiptSchema = z.object({
  version: z.literal(PASEO_LAUNCH_CONTRACT_VERSION),
  contractDigest: Sha256DigestSchema,
  roleId: PaseoRoleIdSchema,
  providerId: z.string().min(1),
  providerFamily: z.string().min(1),
  model: z.string().min(1),
  routeKind: ProviderRouteKindSchema,
  modelProviderId: z.string().min(1).nullable(),
  authMethod: ProviderAuthMethodSchema,
  credentialConfigured: z.boolean().nullable(),
  createdAt: z.string(),
});

export type LaunchContractReceipt = z.infer<typeof LaunchContractReceiptSchema>;
