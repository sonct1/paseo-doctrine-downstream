import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  BeadsIssue,
  BeadsIssueStatus,
  BeadsIssueType,
} from "@getpaseo/protocol/beads/rpc-schemas";
import {
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import { useFetchQuery } from "@/data/query";

const ISSUE_LIST_LIMIT = 100;

export const issueQueryKeys = {
  project: (serverId: string, projectId: string) => ["beadsIssues", serverId, projectId] as const,
  detail: (serverId: string, projectId: string, issueId: string) =>
    ["beadsIssue", serverId, projectId, issueId] as const,
};

export function useIssuesQuery(
  serverId: string,
  projectId: string,
  status: IssueStatusFilter,
  enabled = true,
) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);

  return useFetchQuery({
    queryKey: [
      ...issueQueryKeys.project(serverId, projectId),
      status,
      runtimeSnapshot?.clientGeneration ?? 0,
    ],
    queryFn: async () => {
      if (!client) throw new Error("Host client unavailable");
      const response = await client.listBeadsIssues({
        projectId,
        limit: ISSUE_LIST_LIMIT,
        ...(status === "all" ? {} : { status: [status] }),
      });
      if (response.error) throw new Error(response.error);
      return response;
    },
    enabled: Boolean(enabled && serverId && projectId && client && isConnected),
    retry: false,
    dataShape: "list",
    staleTimeMs: 2_000,
  });
}

export function useIssueQuery(serverId: string, projectId: string, issueId: string | null) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);

  return useFetchQuery({
    queryKey: [
      ...issueQueryKeys.detail(serverId, projectId, issueId ?? ""),
      runtimeSnapshot?.clientGeneration ?? 0,
    ],
    queryFn: async () => {
      if (!client || !issueId) throw new Error("Issue client unavailable");
      const response = await client.getBeadsIssue({ projectId, issueId });
      if (response.error || !response.issue) {
        throw new Error(response.error ?? `Issue ${issueId} was not found`);
      }
      return response.issue;
    },
    enabled: Boolean(serverId && projectId && issueId && client && isConnected),
    retry: false,
    dataShape: "value",
    staleTimeMs: 2_000,
  });
}

interface CreateIssueInput {
  title: string;
  description?: string;
  issueType: BeadsIssueType;
  priority: number;
  acceptance?: string;
  idempotencyKey: string;
}

interface CloseIssueInput {
  issueId: string;
  reason: string;
  idempotencyKey: string;
}

export function useIssueMutations(serverId: string, projectId: string) {
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();

  const invalidate = useCallback(
    async (issue?: BeadsIssue | null) => {
      await queryClient.invalidateQueries({
        queryKey: issueQueryKeys.project(serverId, projectId),
      });
      if (issue) {
        queryClient.setQueriesData(
          { queryKey: issueQueryKeys.detail(serverId, projectId, issue.id) },
          issue,
        );
      }
    },
    [projectId, queryClient, serverId],
  );

  const createMutation = useMutation({
    mutationFn: async (input: CreateIssueInput): Promise<BeadsIssue> => {
      if (!client) throw new Error("Host client unavailable");
      const response = await client.createBeadsIssue({ projectId, ...input });
      if (response.error || !response.issue) {
        throw new Error(response.error ?? "Beads did not return the created issue");
      }
      return response.issue;
    },
    onSuccess: (issue) => invalidate(issue),
  });

  const closeMutation = useMutation({
    mutationFn: async (input: CloseIssueInput): Promise<BeadsIssue> => {
      if (!client) throw new Error("Host client unavailable");
      const response = await client.closeBeadsIssue({ projectId, ...input });
      if (response.error || !response.issue) {
        throw new Error(response.error ?? "Beads did not return the closed issue");
      }
      return response.issue;
    },
    onSuccess: (issue) => invalidate(issue),
  });

  return {
    createIssue: createMutation.mutateAsync,
    closeIssue: closeMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isClosing: closeMutation.isPending,
    createError: createMutation.error,
    closeError: closeMutation.error,
    resetCreate: createMutation.reset,
    resetClose: closeMutation.reset,
  };
}

export type IssueStatusFilter = "all" | BeadsIssueStatus;
