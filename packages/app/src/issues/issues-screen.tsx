import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { router } from "expo-router";
import { ListChecks, Plus, RotateCw, ShieldCheck } from "lucide-react-native";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  BeadsIssue,
  BeadsIssueStatus,
  BeadsIssueType,
} from "@getpaseo/protocol/beads/rpc-schemas";
import { BackHeader } from "@/components/headers/back-header";
import { MenuHeader } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { buildHostProjectIssueRoute, buildHostProjectIssuesRoute } from "@/utils/host-routes";
import { buildIssueBoard } from "./issue-board-model";
import { useIssueMutations, useIssueQuery, useIssuesQuery, type IssueStatusFilter } from "./data";

interface IssuesScreenProps {
  serverId: string;
  projectId: string;
  selectedIssueId: string | null;
}

const STATUS_FILTERS: { value: IssueStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "deferred", label: "Deferred" },
  { value: "closed", label: "Closed" },
];

const ISSUE_TYPES: { value: BeadsIssueType; label: string }[] = [
  { value: "task", label: "Task" },
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature" },
  { value: "chore", label: "Chore" },
  { value: "decision", label: "Decision" },
  { value: "epic", label: "Epic" },
];

const PRIORITIES = [0, 1, 2, 3, 4] as const;
const EMPTY_ISSUES: BeadsIssue[] = [];

const ThemedListChecks = withUnistyles(ListChecks);
const ThemedShieldCheck = withUnistyles(ShieldCheck);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const foregroundExtraMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundExtraMuted,
});

function mutationKey(operation: string): string {
  return `web-${operation}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusLabel(status: BeadsIssueStatus): string {
  if (status === "in_progress") return "In progress";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function typeLabel(type: BeadsIssueType): string {
  return ISSUE_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function IssuesScreen({ serverId, projectId, selectedIssueId }: IssuesScreenProps) {
  const isCompact = useIsCompactFormFactor();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsIssues = useHostFeature(serverId, "beadsIssues");
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<IssueStatusFilter>("all");
  const issuesQuery = useIssuesQuery(serverId, projectId, filter, supportsIssues);
  const issues = issuesQuery.data?.issues ?? EMPTY_ISSUES;

  const handleCreate = useCallback(() => setCreating(true), []);
  const handleCancelCreate = useCallback(() => setCreating(false), []);
  const handleCreated = useCallback(
    (issue: BeadsIssue) => {
      setCreating(false);
      router.push(buildHostProjectIssueRoute(serverId, projectId, issue.id));
    },
    [projectId, serverId],
  );
  const handleRetry = useCallback(() => {
    void issuesQuery.refetch();
  }, [issuesQuery]);
  const headerAction = useMemo(
    () => (
      <View style={styles.headerActions}>
        <Button
          size="sm"
          variant="default"
          leftIcon={Plus}
          onPress={handleCreate}
          testID="issues-create-button"
        >
          New issue
        </Button>
      </View>
    ),
    [handleCreate],
  );

  let content: ReactNode;
  if (!isConnected) {
    content = <CenteredLoading />;
  } else if (!supportsIssues) {
    content = (
      <IssuesEmpty
        title="Update this host to use Issues"
        description="This Paseo daemon does not advertise the Beads Central issue capability."
      />
    );
  } else {
    content = (
      <AvailableIssuesSurface
        compact={isCompact}
        creating={creating}
        selectedIssueId={selectedIssueId}
        serverId={serverId}
        projectId={projectId}
        issues={issues}
        truncated={issuesQuery.data?.truncated ?? false}
        filter={filter}
        onFilterChange={setFilter}
        isLoading={issuesQuery.isLoading}
        error={issuesQuery.error}
        runtimeVersion={issuesQuery.data?.runtime.version ?? null}
        onRetry={handleRetry}
        onCreate={handleCreate}
        onCancelCreate={handleCancelCreate}
        onCreated={handleCreated}
      />
    );
  }

  return (
    <View style={styles.container} testID="issues-screen">
      {isConnected && supportsIssues && isCompact && (creating || selectedIssueId) ? null : (
        <MenuHeader
          title="Issues"
          rightContent={isConnected && supportsIssues ? headerAction : null}
        />
      )}
      {content}
    </View>
  );
}

interface AvailableIssuesSurfaceProps {
  compact: boolean;
  creating: boolean;
  selectedIssueId: string | null;
  serverId: string;
  projectId: string;
  issues: BeadsIssue[];
  truncated: boolean;
  filter: IssueStatusFilter;
  onFilterChange: (filter: IssueStatusFilter) => void;
  isLoading: boolean;
  error: unknown;
  runtimeVersion: string | null;
  onRetry: () => void;
  onCreate: () => void;
  onCancelCreate: () => void;
  onCreated: (issue: BeadsIssue) => void;
}

function AvailableIssuesSurface(props: AvailableIssuesSurfaceProps) {
  if (props.compact) return <CompactIssuesSurface {...props} />;
  return <DesktopIssuesSurface {...props} />;
}

function CompactIssuesSurface(props: AvailableIssuesSurfaceProps) {
  if (props.creating) {
    return (
      <CreateIssuePanel
        serverId={props.serverId}
        projectId={props.projectId}
        compact
        onCancel={props.onCancelCreate}
        onCreated={props.onCreated}
      />
    );
  }
  if (props.selectedIssueId) {
    return (
      <IssueDetail
        serverId={props.serverId}
        projectId={props.projectId}
        issueId={props.selectedIssueId}
        compact
      />
    );
  }
  return <IssuesList {...props} selectedIssueId={null} />;
}

function DesktopIssuesSurface(props: AvailableIssuesSurfaceProps) {
  let emptyTitle = "Select an issue";
  if (props.issues.length === 0) {
    emptyTitle = props.filter === "all" ? "No issues yet" : "No matching issues";
  }

  let detail: ReactNode;
  if (props.creating) {
    detail = (
      <CreateIssuePanel
        serverId={props.serverId}
        projectId={props.projectId}
        compact={false}
        onCancel={props.onCancelCreate}
        onCreated={props.onCreated}
      />
    );
  } else if (props.selectedIssueId) {
    detail = (
      <IssueDetail
        serverId={props.serverId}
        projectId={props.projectId}
        issueId={props.selectedIssueId}
        compact={false}
      />
    );
  } else {
    detail = (
      <IssuesEmpty
        title={emptyTitle}
        description="This is the durable project work graph shared across Paseo workspaces."
      />
    );
  }

  return (
    <View style={styles.desktopBody}>
      <View style={styles.desktopListPane}>
        <IssuesList {...props} selectedIssueId={props.creating ? null : props.selectedIssueId} />
      </View>
      <View style={styles.desktopDetailPane}>{detail}</View>
    </View>
  );
}

function IssuesList({
  issues,
  truncated,
  filter,
  onFilterChange,
  selectedIssueId,
  serverId,
  projectId,
  isLoading,
  error,
  runtimeVersion,
  onRetry,
  onCreate,
}: {
  issues: BeadsIssue[];
  truncated: boolean;
  filter: IssueStatusFilter;
  onFilterChange: (filter: IssueStatusFilter) => void;
  selectedIssueId: string | null;
  serverId: string;
  projectId: string;
  isLoading: boolean;
  error: unknown;
  runtimeVersion: string | null;
  onRetry: () => void;
  onCreate: () => void;
}) {
  const board = useMemo(() => buildIssueBoard(issues, filter), [filter, issues]);
  if (isLoading) return <CenteredLoading />;
  if (error) {
    return (
      <IssuesEmpty title="Issue graph unavailable" description={errorText(error)}>
        <View style={styles.errorActions}>
          <Button size="sm" leftIcon={RotateCw} onPress={onRetry} testID="issues-retry-button">
            Retry
          </Button>
        </View>
      </IssuesEmpty>
    );
  }

  return (
    <View style={styles.listContainer}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <View style={styles.filters}>
          {STATUS_FILTERS.map((entry) => (
            <FilterButton
              key={entry.value}
              value={entry.value}
              label={entry.label}
              selected={filter === entry.value}
              onSelect={onFilterChange}
            />
          ))}
        </View>
      </ScrollView>
      {truncated ? (
        <View style={styles.truncationNotice} testID="issues-truncation-notice">
          <Text style={styles.truncationText}>
            Showing the first {issues.length} matching issues. Refine the status filter to narrow
            the list.
          </Text>
        </View>
      ) : null}
      {issues.length === 0 ? (
        <IssuesEmpty
          title={filter === "all" ? "No issues yet" : "No matching issues"}
          description={
            filter === "all"
              ? "Create the first durable work item for this project."
              : "Try another status filter."
          }
        >
          {filter === "all" ? (
            <Button size="sm" variant="default" leftIcon={Plus} onPress={onCreate}>
              New issue
            </Button>
          ) : null}
        </IssuesEmpty>
      ) : (
        <ScrollView
          horizontal
          style={styles.issuesBoardScroll}
          contentContainerStyle={styles.issuesBoard}
          showsHorizontalScrollIndicator
          testID="issues-list"
        >
          {board.map((column) => (
            <View
              key={column.status}
              style={styles.issueColumn}
              testID={`issue-kanban-column-${column.status}`}
            >
              <View style={styles.issueColumnHeader}>
                <StatusBadge status={column.status} />
                <Text style={styles.issueColumnCount}>{column.issues.length}</Text>
              </View>
              <ScrollView style={styles.issueColumnScroll} contentContainerStyle={styles.issueList}>
                {column.issues.length === 0 ? (
                  <View style={styles.issueColumnEmpty}>
                    <Text style={styles.issueColumnEmptyText}>No issues in this state</Text>
                  </View>
                ) : (
                  column.issues.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      selected={issue.id === selectedIssueId}
                      serverId={serverId}
                      projectId={projectId}
                    />
                  ))
                )}
              </ScrollView>
            </View>
          ))}
        </ScrollView>
      )}
      {runtimeVersion ? (
        <Text style={styles.runtimeLabel}>Beads Central v{runtimeVersion} · project scoped</Text>
      ) : null}
    </View>
  );
}

function FilterButton({
  value,
  label,
  selected,
  onSelect,
}: {
  value: IssueStatusFilter;
  label: string;
  selected: boolean;
  onSelect: (value: IssueStatusFilter) => void;
}) {
  const handlePress = useCallback(() => onSelect(value), [onSelect, value]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.filterButton,
      selected && styles.filterButtonSelected,
      (hovered || pressed) && styles.filterButtonHovered,
    ],
    [selected],
  );
  return (
    <Pressable
      onPress={handlePress}
      style={style}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
    >
      <Text style={[styles.filterText, selected && styles.filterTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function IssueRow({
  issue,
  selected,
  serverId,
  projectId,
}: {
  issue: BeadsIssue;
  selected: boolean;
  serverId: string;
  projectId: string;
}) {
  const handlePress = useCallback(() => {
    router.push(buildHostProjectIssueRoute(serverId, projectId, issue.id));
  }, [issue.id, projectId, serverId]);
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.issueRow,
      selected && styles.issueRowSelected,
      (hovered || pressed) && styles.issueRowHovered,
    ],
    [selected],
  );

  return (
    <Pressable
      onPress={handlePress}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={`${issue.title}, ${statusLabel(
        issue.status,
      )}, priority ${issue.priority}`}
      testID={`issue-row-${issue.id}`}
    >
      <View style={styles.issueRowTopline}>
        <Text style={styles.issueId}>{issue.id}</Text>
        <StatusBadge status={issue.status} />
      </View>
      <Text style={styles.issueRowTitle} numberOfLines={2}>
        {issue.title}
      </Text>
      <View style={styles.issueRowMeta}>
        <Text style={styles.issueMetaText}>P{issue.priority}</Text>
        <Text style={styles.issueMetaDivider}>·</Text>
        <Text style={styles.issueMetaText}>{typeLabel(issue.issue_type)}</Text>
        {issue.assignee ? (
          <>
            <Text style={styles.issueMetaDivider}>·</Text>
            <Text style={styles.issueMetaText} numberOfLines={1}>
              {issue.assignee}
            </Text>
          </>
        ) : null}
      </View>
    </Pressable>
  );
}

function StatusBadge({ status }: { status: BeadsIssueStatus }) {
  return (
    <View style={[styles.statusBadge, statusBadgeStyle(status)]} testID={`issue-status-${status}`}>
      <View style={[styles.statusDot, statusDotStyle(status)]} />
      <Text style={styles.statusBadgeText}>{statusLabel(status)}</Text>
    </View>
  );
}

function statusBadgeStyle(status: BeadsIssueStatus) {
  if (status === "blocked") return styles.statusBlocked;
  if (status === "in_progress") return styles.statusActive;
  if (status === "closed") return styles.statusClosed;
  if (status === "deferred") return styles.statusDeferred;
  return styles.statusOpen;
}

function statusDotStyle(status: BeadsIssueStatus) {
  if (status === "blocked") return styles.statusDotBlocked;
  if (status === "in_progress") return styles.statusDotActive;
  if (status === "closed") return styles.statusDotClosed;
  if (status === "deferred") return styles.statusDotDeferred;
  return styles.statusDotOpen;
}

function IssueDetail({
  serverId,
  projectId,
  issueId,
  compact,
}: {
  serverId: string;
  projectId: string;
  issueId: string;
  compact: boolean;
}) {
  const issueQuery = useIssueQuery(serverId, projectId, issueId);
  const handleBack = useCallback(() => {
    router.replace(buildHostProjectIssuesRoute(serverId, projectId));
  }, [projectId, serverId]);
  const handleRetry = useCallback(() => {
    void issueQuery.refetch();
  }, [issueQuery]);

  if (issueQuery.isLoading) {
    return (
      <View style={styles.detail}>
        {compact ? <BackHeader title={issueId} onBack={handleBack} /> : <DetailHeader />}
        <CenteredLoading />
      </View>
    );
  }
  if (issueQuery.error || !issueQuery.data) {
    return (
      <View style={styles.detail}>
        {compact ? <BackHeader title="Issue unavailable" onBack={handleBack} /> : <DetailHeader />}
        <IssuesEmpty
          title="Issue unavailable"
          description={
            issueQuery.error ? errorText(issueQuery.error) : `Issue ${issueId} was not found`
          }
        >
          <Button size="sm" leftIcon={RotateCw} onPress={handleRetry}>
            Retry
          </Button>
        </IssuesEmpty>
      </View>
    );
  }

  return (
    <View style={styles.detail} testID={`issue-detail-${issueId}`}>
      {compact ? <BackHeader title={issueId} onBack={handleBack} /> : <DetailHeader />}
      <IssueDetailContent
        key={JSON.stringify([serverId, projectId, issueQuery.data.id])}
        issue={issueQuery.data}
        serverId={serverId}
        projectId={projectId}
        compact={compact}
      />
    </View>
  );
}

function DetailHeader() {
  const title = useMemo(() => <ScreenTitle>Issue</ScreenTitle>, []);
  return <ScreenHeader left={title} />;
}

function IssueDetailContent({
  issue,
  serverId,
  projectId,
  compact,
}: {
  issue: BeadsIssue;
  serverId: string;
  projectId: string;
  compact: boolean;
}) {
  const { closeIssue, isClosing, closeError, resetClose } = useIssueMutations(serverId, projectId);
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");
  const [closeKey, setCloseKey] = useState(() => mutationKey("close"));
  const createdAt = formatTimestamp(issue.created_at);
  const updatedAt = formatTimestamp(issue.updated_at);
  const closedAt = formatTimestamp(issue.closed_at);

  const handleReasonChange = useCallback(
    (value: string) => {
      setReason(value);
      setCloseKey(mutationKey("close"));
      resetClose();
    },
    [resetClose],
  );
  const handleClose = useCallback(async () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) return;
    try {
      await closeIssue({
        issueId: issue.id,
        reason: trimmedReason,
        idempotencyKey: closeKey,
      });
      setClosing(false);
      setReason("");
      setCloseKey(mutationKey("close"));
    } catch {
      // Keep the key: the daemon may have committed even when the response was lost.
    }
  }, [closeIssue, closeKey, issue.id, reason]);
  const handleClosePress = useCallback(() => {
    void handleClose();
  }, [handleClose]);
  const handleCancelClose = useCallback(() => {
    resetClose();
    setClosing(false);
    setCloseKey(mutationKey("close"));
  }, [resetClose]);
  const handleOpenClose = useCallback(() => setClosing(true), []);

  let closeControl: ReactNode;
  if (issue.status === "closed") {
    closeControl = (
      <View style={styles.closeReceipt}>
        <Text style={styles.sectionLabel}>Close receipt</Text>
        <Text style={styles.sectionValue}>{issue.close_reason || "No reason recorded."}</Text>
      </View>
    );
  } else if (closing) {
    closeControl = (
      <View style={styles.closePanel} testID="issue-close-form">
        <Text style={styles.closeTitle}>Close issue</Text>
        <Text style={styles.closeDescription}>
          Record why the work state can close. This does not grant engineering acceptance.
        </Text>
        <Field label="Reason" error={closeError ? errorText(closeError) : null}>
          <FormTextInput
            initialValue={reason}
            onChangeText={handleReasonChange}
            placeholder="Evidence, verdict, or resolution"
            multiline
            numberOfLines={4}
            style={styles.multilineInput}
            editable={!isClosing}
            testID="issue-close-reason"
          />
        </Field>
        <View style={styles.formActions}>
          <Button variant="ghost" onPress={handleCancelClose} disabled={isClosing}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onPress={handleClosePress}
            disabled={!reason.trim()}
            loading={isClosing}
            testID="issue-close-confirm"
          >
            Close issue
          </Button>
        </View>
      </View>
    );
  } else {
    closeControl = (
      <View style={styles.detailActions}>
        <Button variant="outline" onPress={handleOpenClose} testID="issue-close-button">
          Close issue
        </Button>
      </View>
    );
  }

  return (
    <ScrollView style={styles.detailScroll}>
      <View style={[styles.detailContent, compact && styles.detailContentCompact]}>
        <View style={styles.detailHero}>
          <View style={styles.detailBadges}>
            <StatusBadge status={issue.status} />
            <View style={styles.neutralBadge}>
              <Text style={styles.neutralBadgeText}>P{issue.priority}</Text>
            </View>
            <View style={styles.neutralBadge}>
              <Text style={styles.neutralBadgeText}>{typeLabel(issue.issue_type)}</Text>
            </View>
          </View>
          <Text style={styles.detailId}>{issue.id}</Text>
          <Text style={styles.detailTitle}>{issue.title}</Text>
          {issue.assignee ? (
            <Text style={styles.detailAssignee}>Owned by {issue.assignee}</Text>
          ) : null}
        </View>

        <View style={styles.acceptanceNotice}>
          <ThemedShieldCheck size={18} uniProps={foregroundMutedMapping} />
          <View style={styles.noticeCopy}>
            <Text style={styles.noticeTitle}>Work state, not acceptance</Text>
            <Text style={styles.noticeText}>
              Closing this issue records workflow completion. Engineering acceptance still belongs
              to the accountable Lead or Human.
            </Text>
          </View>
        </View>

        <IssueSection
          title="Description"
          value={issue.description}
          empty="No description recorded."
        />
        <IssueSection
          title="Acceptance criteria"
          value={issue.acceptance_criteria}
          empty="No acceptance criteria recorded."
        />
        <IssueSection title="Notes" value={issue.notes} empty="No notes recorded." />

        <View style={styles.metadataGrid}>
          {createdAt ? <Metadata label="Created" value={createdAt} /> : null}
          {updatedAt ? <Metadata label="Updated" value={updatedAt} /> : null}
          {closedAt ? <Metadata label="Closed" value={closedAt} /> : null}
        </View>

        {closeControl}
      </View>
    </ScrollView>
  );
}

function IssueSection({
  title,
  value,
  empty,
}: {
  title: string;
  value?: string | null;
  empty: string;
}) {
  return (
    <View style={styles.issueSection}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <Text style={[styles.sectionValue, !value && styles.sectionValueEmpty]}>
        {value || empty}
      </Text>
    </View>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metadataItem}>
      <Text style={styles.metadataLabel}>{label}</Text>
      <Text style={styles.metadataValue}>{value}</Text>
    </View>
  );
}

interface CreateDraft {
  title: string;
  description: string;
  acceptance: string;
  issueType: BeadsIssueType;
  priority: number;
}

const EMPTY_DRAFT: CreateDraft = {
  title: "",
  description: "",
  acceptance: "",
  issueType: "task",
  priority: 2,
};

function CreateIssuePanel({
  serverId,
  projectId,
  compact,
  onCancel,
  onCreated,
}: {
  serverId: string;
  projectId: string;
  compact: boolean;
  onCancel: () => void;
  onCreated: (issue: BeadsIssue) => void;
}) {
  const { createIssue, isCreating, createError, resetCreate } = useIssueMutations(
    serverId,
    projectId,
  );
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const [submissionKey, setSubmissionKey] = useState(() => mutationKey("create"));
  const mountedRef = useRef(true);
  const activeScopeRef = useRef("");
  activeScopeRef.current = `${serverId}\u0000${projectId}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const updateDraft = useCallback(
    (patch: Partial<CreateDraft>) => {
      setDraft((current) => ({ ...current, ...patch }));
      setSubmissionKey(mutationKey("create"));
      resetCreate();
    },
    [resetCreate],
  );
  const handleSubmit = useCallback(async () => {
    const title = draft.title.trim();
    if (!title) return;
    const submittedScope = `${serverId}\u0000${projectId}`;
    try {
      const issue = await createIssue({
        title,
        description: draft.description.trim() || undefined,
        acceptance: draft.acceptance.trim() || undefined,
        issueType: draft.issueType,
        priority: draft.priority,
        idempotencyKey: submissionKey,
      });
      if (mountedRef.current && activeScopeRef.current === submittedScope) onCreated(issue);
    } catch {
      // Keep the key: retrying the same draft must replay an uncertain prior attempt.
    }
  }, [createIssue, draft, onCreated, projectId, serverId, submissionKey]);
  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);
  const handleTitleChange = useCallback((title: string) => updateDraft({ title }), [updateDraft]);
  const handleDescriptionChange = useCallback(
    (description: string) => updateDraft({ description }),
    [updateDraft],
  );
  const handleAcceptanceChange = useCallback(
    (acceptance: string) => updateDraft({ acceptance }),
    [updateDraft],
  );
  const handleIssueTypeChange = useCallback(
    (issueType: BeadsIssueType) => updateDraft({ issueType }),
    [updateDraft],
  );
  const handlePriorityChange = useCallback(
    (priority: number) => updateDraft({ priority }),
    [updateDraft],
  );

  return (
    <View style={styles.detail} testID="issue-create-form">
      {compact ? <BackHeader title="New issue" onBack={onCancel} /> : <DetailHeader />}
      <ScrollView style={styles.detailScroll}>
        <View style={[styles.formContent, compact && styles.detailContentCompact]}>
          <View style={styles.formHero}>
            <Text style={styles.formEyebrow}>DURABLE PROJECT WORK</Text>
            <Text style={styles.formTitle}>Create an issue</Text>
            <Text style={styles.formDescription}>
              This record is shared across every Paseo workspace for the project.
            </Text>
          </View>
          <Field label="Title" error={createError ? errorText(createError) : null}>
            <FormTextInput
              initialValue={draft.title}
              onChangeText={handleTitleChange}
              placeholder="A bounded, decision-useful outcome"
              autoFocus
              editable={!isCreating}
              testID="issue-create-title"
            />
          </Field>
          <Field label="Type">
            <View style={styles.optionGrid}>
              {ISSUE_TYPES.map((entry) => (
                <OptionButton
                  key={entry.value}
                  value={entry.value}
                  label={entry.label}
                  selected={draft.issueType === entry.value}
                  onSelect={handleIssueTypeChange}
                />
              ))}
            </View>
          </Field>
          <Field label="Priority" hint="P0 is urgent; P4 is lowest priority.">
            <View style={styles.optionGrid}>
              {PRIORITIES.map((priority) => (
                <OptionButton
                  key={priority}
                  value={priority}
                  label={`P${priority}`}
                  selected={draft.priority === priority}
                  onSelect={handlePriorityChange}
                />
              ))}
            </View>
          </Field>
          <Field label="Description">
            <FormTextInput
              initialValue={draft.description}
              onChangeText={handleDescriptionChange}
              placeholder="Problem, context, and bounded scope"
              multiline
              numberOfLines={5}
              style={styles.multilineInput}
              editable={!isCreating}
              testID="issue-create-description"
            />
          </Field>
          <Field
            label="Acceptance criteria"
            hint="Evidence required before the work can be accepted."
          >
            <FormTextInput
              initialValue={draft.acceptance}
              onChangeText={handleAcceptanceChange}
              placeholder="Observable checks and handback evidence"
              multiline
              numberOfLines={5}
              style={styles.multilineInput}
              editable={!isCreating}
              testID="issue-create-acceptance"
            />
          </Field>
          <View style={styles.formActions}>
            <Button variant="ghost" onPress={onCancel} disabled={isCreating}>
              Cancel
            </Button>
            <Button
              variant="default"
              leftIcon={Plus}
              onPress={handleSubmitPress}
              disabled={!draft.title.trim()}
              loading={isCreating}
              testID="issue-create-submit"
            >
              Create issue
            </Button>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function OptionButton<TValue extends string | number>({
  value,
  label,
  selected,
  onSelect,
}: {
  value: TValue;
  label: string;
  selected: boolean;
  onSelect: (value: TValue) => void;
}) {
  const handlePress = useCallback(() => onSelect(value), [onSelect, value]);
  const accessibilityState = useMemo(() => ({ checked: selected }), [selected]);
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.optionButton,
      selected && styles.optionButtonSelected,
      (hovered || pressed) && styles.optionButtonHovered,
    ],
    [selected],
  );
  return (
    <Pressable
      style={style}
      onPress={handlePress}
      accessibilityRole="radio"
      accessibilityState={accessibilityState}
    >
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function CenteredLoading() {
  return (
    <View style={styles.centered}>
      <ThemedLoadingSpinner size="large" uniProps={foregroundMutedMapping} />
    </View>
  );
}

function IssuesEmpty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.centered}>
      <View style={styles.emptyIcon}>
        <ThemedListChecks size={21} uniProps={foregroundExtraMutedMapping} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {children ? <View style={styles.emptyAction}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  errorActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  desktopBody: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
  },
  desktopListPane: {
    flex: 1.7,
    minWidth: 420,
    minHeight: 0,
    backgroundColor: theme.colors.surfaceSidebar,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  desktopDetailPane: {
    flex: 1,
    minWidth: 360,
    minHeight: 0,
  },
  centered: {
    flex: 1,
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
    gap: theme.spacing[2],
  },
  emptyIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing[2],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  emptyDescription: {
    maxWidth: 380,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    textAlign: "center",
  },
  emptyAction: {
    marginTop: theme.spacing[3],
  },
  listContainer: {
    flex: 1,
    minHeight: 0,
  },
  filtersScroll: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  filters: {
    flexDirection: "row",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  truncationNotice: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  truncationText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
  },
  filterButton: {
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
  },
  filterButtonSelected: {
    backgroundColor: theme.colors.surface3,
  },
  filterButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  filterText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  filterTextSelected: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  issuesBoardScroll: {
    flex: 1,
    minHeight: 0,
  },
  issuesBoard: {
    alignItems: "stretch",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  issueColumn: {
    width: 286,
    minHeight: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
  issueColumnHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  issueColumnCount: {
    minWidth: 24,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textAlign: "right",
  },
  issueColumnScroll: {
    flex: 1,
    minHeight: 0,
  },
  issueColumnEmpty: {
    minHeight: 96,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[3],
  },
  issueColumnEmptyText: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    textAlign: "center",
  },
  issueList: {
    padding: theme.spacing[2],
    gap: theme.spacing[2],
  },
  issueRow: {
    minHeight: 104,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  issueRowSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  issueRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  issueRowTopline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  issueId: {
    flex: 1,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  issueRowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 20,
  },
  issueRowMeta: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    gap: theme.spacing[1],
  },
  issueMetaText: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  issueMetaDivider: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
  },
  runtimeLabel: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
  },
  statusBadge: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
  },
  statusOpen: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.border,
  },
  statusActive: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  statusBlocked: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.statusDanger,
  },
  statusDeferred: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.statusWarning,
  },
  statusClosed: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.statusSuccess,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
  },
  statusDotOpen: { backgroundColor: theme.colors.foregroundMuted },
  statusDotActive: { backgroundColor: theme.colors.accent },
  statusDotBlocked: { backgroundColor: theme.colors.statusDanger },
  statusDotDeferred: { backgroundColor: theme.colors.statusWarning },
  statusDotClosed: { backgroundColor: theme.colors.statusSuccess },
  statusBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  detail: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  detailScroll: {
    flex: 1,
    minHeight: 0,
  },
  detailContent: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[8],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[12],
    gap: theme.spacing[6],
  },
  detailContentCompact: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[8],
  },
  detailHero: {
    paddingBottom: theme.spacing[6],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing[3],
  },
  detailBadges: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  neutralBadge: {
    minHeight: 24,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  neutralBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  detailId: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: 0.5,
  },
  detailTitle: {
    maxWidth: 760,
    color: theme.colors.foreground,
    fontSize: theme.fontSize["3xl"],
    fontWeight: theme.fontWeight.semibold,
    lineHeight: 38,
  },
  detailAssignee: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  acceptanceNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  noticeCopy: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  noticeTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  noticeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  issueSection: {
    gap: theme.spacing[2],
  },
  sectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  sectionValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 24,
  },
  sectionValueEmpty: {
    color: theme.colors.foregroundExtraMuted,
    fontStyle: "italic",
  },
  metadataGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[4],
    paddingTop: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  metadataItem: {
    minWidth: 160,
    flex: 1,
    gap: theme.spacing[1],
  },
  metadataLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
  },
  metadataValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  closeReceipt: {
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.statusSuccess,
    backgroundColor: theme.colors.surface1,
  },
  closePanel: {
    gap: theme.spacing[4],
    padding: theme.spacing[6],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  closeTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  closeDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  detailActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingTop: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  formContent: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[8],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[12],
    gap: theme.spacing[6],
  },
  formHero: {
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[6],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  formEyebrow: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: 0.8,
  },
  formTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
  },
  formDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  optionButton: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  optionButtonSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface3,
  },
  optionButtonHovered: {
    borderColor: theme.colors.borderAccent,
  },
  optionText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  optionTextSelected: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  multilineInput: {
    minHeight: 112,
    textAlignVertical: "top",
  },
  formActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
}));
