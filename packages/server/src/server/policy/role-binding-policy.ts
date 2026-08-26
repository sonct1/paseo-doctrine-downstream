import type { AssignmentEnvelope } from "@getpaseo/protocol/assignment-contract";
import type {
  PaseoRoleId,
  RoleProfileBindingReceipt,
  WorkspaceProtocolBindingReceipt,
} from "@getpaseo/protocol/role-binding";
import type { RoleProfilePreferences } from "@getpaseo/protocol/role-profile";

import type { PersistedAssignmentContract } from "../agent/assignment-contract.js";
export interface RolePolicyRoleDefinition {
  id: PaseoRoleId;
  version: string;
  instructions: string;
}

export interface RolePolicyExecutionProfileDefinition<TId extends string = string> {
  id: TId;
  version: string;
  authorityRoleId: PaseoRoleId;
  instructions: string;
}

export interface RoleBindingInstructionCompositionInput<
  TExecutionProfileId extends string = string,
> {
  definition: RolePolicyRoleDefinition;
  executionProfile: RolePolicyExecutionProfileDefinition<TExecutionProfileId> | null;
  workspaceProtocol: WorkspaceProtocolBindingReceipt;
  hasProtocolException: boolean;
  assignmentContract: PersistedAssignmentContract;
  roleProfile: RoleProfileBindingReceipt;
}

/**
 * Generic kernel extension seam for one immutable role-policy generation.
 *
 * The contribution owns semantic selection and exact instruction composition.
 * The kernel owns transport qualification, workspace inspection, immutable
 * persistence, provider-native injection, resume validation, and receipts.
 */
export interface RoleBindingPolicyContribution<TExecutionProfileId extends string = string> {
  getRoleDefinition(roleId: PaseoRoleId): RolePolicyRoleDefinition;
  getExecutionProfile(
    profileId: TExecutionProfileId,
  ): RolePolicyExecutionProfileDefinition<TExecutionProfileId>;
  executionProfileDefinitionDigest(
    profile: RolePolicyExecutionProfileDefinition<TExecutionProfileId>,
  ): string;
  materializeRoleProfile(
    roleId: PaseoRoleId,
    preferences: RoleProfilePreferences | undefined,
    assignmentEffectClass: AssignmentEnvelope["effectClass"],
  ): RoleProfileBindingReceipt;
  workspaceProtocolReadership(roleId: PaseoRoleId): WorkspaceProtocolBindingReceipt["readership"];
  composeInstructions(input: RoleBindingInstructionCompositionInput<TExecutionProfileId>): string;
  preflight(input: {
    roleId: PaseoRoleId;
    executionProfileId?: TExecutionProfileId;
    assignment?: AssignmentEnvelope;
    createdAt?: Date;
  }): AssignmentEnvelope;
}
