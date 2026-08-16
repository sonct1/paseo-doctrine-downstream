import equal from "fast-deep-equal";
import { ChevronDown, ChevronRight, LockKeyhole, RotateCcw, Save } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PASEO_ROLE_SUMMARIES, type PaseoRoleId } from "@getpaseo/protocol/role-binding";
import type {
  RoleProfileDescriptor,
  RoleProfilePreferences,
  RoleProfilePreferencesMap,
} from "@getpaseo/protocol/role-profile";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useRoleProfiles } from "@/hooks/use-role-profiles";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";

const ROLE_OPTIONS = PASEO_ROLE_SUMMARIES.map((role) => ({
  value: role.id,
  label: role.label,
  testID: `role-profile-tab-${role.id}`,
}));
const ThemedLockKeyhole = withUnistyles(LockKeyhole);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function ToggleRow({
  name,
  enabled,
  mandatory,
  onToggle,
  testID,
}: {
  name: string;
  enabled: boolean;
  mandatory: boolean;
  onToggle: (name: string, enabled: boolean) => void;
  testID: string;
}) {
  const handleChange = useCallback((next: boolean) => onToggle(name, next), [name, onToggle]);
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleName}>{name}</Text>
        {mandatory ? <Text style={styles.requiredLabel}>Required</Text> : null}
      </View>
      <Switch
        value={enabled}
        disabled={mandatory}
        onValueChange={handleChange}
        accessibilityLabel={`${enabled ? "Disable" : "Enable"} ${name}`}
        testID={testID}
      />
    </View>
  );
}

function CapabilityGroup({
  title,
  hint,
  ceiling,
  selected,
  mandatory,
  onToggle,
  testPrefix,
}: {
  title: string;
  hint: string;
  ceiling: readonly string[];
  selected: readonly string[];
  mandatory: readonly string[];
  onToggle: (name: string, enabled: boolean) => void;
  testPrefix: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const mandatorySet = useMemo(() => new Set(mandatory), [mandatory]);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const handleDisclosurePress = useCallback(() => setExpanded((current) => !current), []);
  return (
    <View style={styles.capabilityGroup}>
      <Pressable
        style={styles.disclosureHeader}
        onPress={handleDisclosurePress}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${title}`}
        testID={`${testPrefix}-disclosure`}
      >
        <View style={styles.disclosureTitle}>
          {expanded ? (
            <ThemedChevronDown size={16} uniProps={mutedIconMapping} />
          ) : (
            <ThemedChevronRight size={16} uniProps={mutedIconMapping} />
          )}
          <Text style={styles.groupTitle}>{title}</Text>
        </View>
        <Text style={styles.groupCount}>{selected.length} enabled</Text>
      </Pressable>
      <Text style={styles.groupHint}>{hint}</Text>
      {expanded ? (
        <View style={styles.toggleList}>
          {ceiling.map((name) => (
            <ToggleRow
              key={name}
              name={name}
              enabled={selectedSet.has(name)}
              mandatory={mandatorySet.has(name)}
              onToggle={onToggle}
              testID={`${testPrefix}-${name}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ProfileEditor({
  descriptor,
  draft,
  setDraft,
}: {
  descriptor: RoleProfileDescriptor;
  draft: RoleProfilePreferences;
  setDraft: React.Dispatch<React.SetStateAction<RoleProfilePreferences>>;
}) {
  const selectedTools = draft.allowedTools ?? descriptor.effective.allowedTools;
  const selectedSkills = draft.allowedSkills ?? descriptor.effective.allowedSkills;

  const toggleList = useCallback(
    (kind: "allowedTools" | "allowedSkills", name: string, enabled: boolean) => {
      setDraft((current) => {
        const baseline =
          kind === "allowedTools"
            ? (current.allowedTools ?? descriptor.effective.allowedTools)
            : (current.allowedSkills ?? descriptor.effective.allowedSkills);
        const nextSet = new Set(baseline);
        if (enabled) nextSet.add(name);
        else nextSet.delete(name);
        const ceiling = kind === "allowedTools" ? descriptor.toolCeiling : descriptor.skillCeiling;
        return { ...current, [kind]: ceiling.filter((entry) => nextSet.has(entry)) };
      });
    },
    [descriptor, setDraft],
  );
  const handleToolToggle = useCallback(
    (name: string, enabled: boolean) => toggleList("allowedTools", name, enabled),
    [toggleList],
  );
  const handleSkillToggle = useCallback(
    (name: string, enabled: boolean) => toggleList("allowedSkills", name, enabled),
    [toggleList],
  );

  return (
    <View style={styles.editorBody}>
      <View style={styles.lockedBlock}>
        <View style={styles.lockedTitleRow}>
          <ThemedLockKeyhole size={15} uniProps={mutedIconMapping} />
          <Text style={styles.lockedTitle}>Foundation baseline · locked</Text>
        </View>
        <Text style={styles.roleDescription}>{descriptor.description}</Text>
        <Text style={styles.digestText}>
          {descriptor.definitionVersion} · sha256:{descriptor.definitionDigest.slice(0, 12)}
        </Text>
      </View>

      <View style={styles.sectionBlock}>
        <Text style={styles.groupTitle}>Launch routing</Text>
        <Text style={styles.groupHint}>
          Configure reusable provider, model, mode, thinking, and feature presets under Agent
          profiles. Legacy role defaults migrate there automatically; standing roles keep only
          authority and capability policy.
        </Text>
      </View>

      <CapabilityGroup
        title="Paseo tools"
        hint="Daemon-enforced allowlist. A profile can narrow the Foundation ceiling, never expand it."
        ceiling={descriptor.toolCeiling}
        selected={selectedTools}
        mandatory={descriptor.mandatoryTools}
        onToggle={handleToolToggle}
        testPrefix={`role-profile-${descriptor.roleId}-tool`}
      />
      <CapabilityGroup
        title="Foundation skills"
        hint="Provider-native skill bundle projected at launch. Required coordination skills stay on."
        ceiling={descriptor.skillCeiling}
        selected={selectedSkills}
        mandatory={descriptor.mandatorySkills}
        onToggle={handleSkillToggle}
        testPrefix={`role-profile-${descriptor.roleId}-skill`}
      />

      <View style={styles.previewBlock} testID={`role-profile-${descriptor.roleId}-preview`}>
        <Text style={styles.previewTitle}>Effective profile for new agents</Text>
        <Text style={styles.previewText}>
          Foundation baseline → host capability policy → Workspace Protocol → bounded assignment
        </Text>
        <Text style={styles.previewMeta}>
          {selectedTools.length} tools · {selectedSkills.length} skills · existing agents unchanged
        </Text>
      </View>
    </View>
  );
}

export function RoleProfilesCard({ serverId }: { serverId: string }) {
  const roleProfiles = useRoleProfiles(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  const [selectedRole, setSelectedRole] = useState<PaseoRoleId>("lead");
  const [draft, setDraft] = useState<RoleProfilePreferences>({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descriptor = roleProfiles.catalog?.profiles.find(
    (profile) => profile.roleId === selectedRole,
  );

  useEffect(() => {
    setDraft(descriptor?.preferences ?? {});
    setError(null);
  }, [descriptor]);

  const isDirty = descriptor ? !equal(draft, descriptor.preferences) : false;

  const handleSave = useCallback(() => {
    if (!descriptor) return;
    setIsSaving(true);
    setError(null);
    const roleProfilesPatch = { [selectedRole]: draft } as RoleProfilePreferencesMap;
    void patchConfig({ roleProfiles: roleProfilesPatch })
      .then(() => roleProfiles.refetch())
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setIsSaving(false));
  }, [descriptor, draft, patchConfig, roleProfiles, selectedRole]);

  const handleReset = useCallback(() => {
    setIsSaving(true);
    setError(null);
    void patchConfig({ resetRoleProfiles: [selectedRole] })
      .then(() => roleProfiles.refetch())
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setIsSaving(false));
  }, [patchConfig, roleProfiles, selectedRole]);

  if (!roleProfiles.supported) {
    return (
      <View style={settingsStyles.card} testID="host-role-profiles-update-required">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Role profiles</Text>
            <Text style={settingsStyles.rowHint}>
              Update this daemon to configure Lead, Peer, and Supervisor profiles.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  let profileContent: ReactNode;
  if (roleProfiles.isLoading) {
    profileContent = (
      <View style={styles.stateBlock}>
        <Text style={styles.stateText}>Loading Foundation profiles…</Text>
      </View>
    );
  } else if (descriptor) {
    profileContent = <ProfileEditor descriptor={descriptor} draft={draft} setDraft={setDraft} />;
  } else {
    profileContent = (
      <View style={styles.stateBlock}>
        <Text style={styles.errorText}>{roleProfiles.error ?? "Role profiles unavailable"}</Text>
      </View>
    );
  }

  return (
    <View style={settingsStyles.card} testID="host-role-profiles-card">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={settingsStyles.rowTitle}>Role profiles</Text>
          <Text style={settingsStyles.rowHint}>
            Narrow tools and skills without editing the Foundation contract. Configure launch
            routing under Agent profiles.
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={RotateCcw}
            onPress={handleReset}
            disabled={isSaving || !descriptor || equal(descriptor.preferences, {})}
            testID="role-profile-reset"
          >
            Reset
          </Button>
          <Button
            variant="default"
            size="sm"
            leftIcon={Save}
            onPress={handleSave}
            disabled={isSaving || !isDirty}
            loading={isSaving}
            testID="role-profile-save"
          >
            Save
          </Button>
        </View>
      </View>
      <View style={styles.roleTabs}>
        <SegmentedControl
          options={ROLE_OPTIONS}
          value={selectedRole}
          onValueChange={setSelectedRole}
          size="sm"
          testID="role-profile-tabs"
        />
      </View>
      {profileContent}
      {error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
  },
  headerCopy: { flex: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  roleTabs: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  editorBody: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  lockedBlock: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    backgroundColor: theme.colors.surface2,
  },
  lockedTitleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  lockedTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  roleDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    marginTop: theme.spacing[2],
  },
  digestText: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[2],
  },
  sectionBlock: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  capabilityGroup: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  disclosureHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 30,
  },
  disclosureTitle: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  groupTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  groupCount: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  groupHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    marginTop: theme.spacing[1],
  },
  toggleList: {
    marginTop: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  toggleRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing[3],
  },
  toggleCopy: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], flex: 1 },
  toggleName: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
  },
  requiredLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
  },
  previewBlock: {
    margin: theme.spacing[4],
    padding: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  previewTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  previewText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs, marginTop: 4 },
  previewMeta: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[2],
  },
  stateBlock: { padding: theme.spacing[4] },
  stateText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  errorBlock: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  errorText: { color: theme.colors.statusDanger, fontSize: theme.fontSize.xs },
}));
