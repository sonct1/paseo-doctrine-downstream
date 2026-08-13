import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import type {
  WorkspaceProtocolIssue,
  WorkspaceProtocolRevision,
  WorkspaceProtocolRpcError,
  WorkspaceProtocolSnapshot,
} from "@getpaseo/protocol/workspace-protocol-schema";

export const WORKSPACE_PROTOCOL_FILE_NAME = "WORKSPACE_PROTOCOL.md";
export const WORKSPACE_PROTOCOL_VERSION = 3;
const MAX_WORKSPACE_PROTOCOL_BYTES = 64 * 1024;

/**
 * Schema evolves additively: a new version may only add optional clauses, so any version this
 * build has not seen is still readable — unknown clauses are ignored rather than fatal. The
 * version is a capability hint, never an admission gate, so an older daemon meeting a newer
 * file degrades instead of refusing the repository. Rollout order across machines is not
 * something we control, and a build that refuses the future locks its own users out.
 * Only a malformed marker is rejected, because that is corruption rather than a version.
 */
const WELL_FORMED_MARKER = /^<!--\s*PASEO_WORKSPACE_PROTOCOL_VERSION:\s*([1-9]\d{0,3})\s*-->$/u;
const IDENTITY_CATEGORIES: readonly (readonly RegExp[])[] = [
  [/\bowner\b/iu, /chủ sở hữu/iu, /\bauthority\b/iu, /thẩm quyền/iu],
  [/\bapplies_to\b/iu, /áp dụng/iu, /phạm vi/iu, /\brepository\b/iu, /\bproject\b/iu],
  [/\bversion\b/iu, /\blast_reviewed\b/iu, /trạng thái/iu, /\bstatus\b/iu, /\breview/iu],
];
const REQUIRED_TRACKER_TERMS = [
  "beads central",
  "lead",
  "peer",
  "supervisor",
  "beads_status",
  "blocked",
  "read-only",
] as const;

export type WriteWorkspaceProtocolResult =
  | { ok: true; snapshot: WorkspaceProtocolSnapshot }
  | { ok: false; error: WorkspaceProtocolRpcError };

export function resolveWorkspaceProtocolPath(repoRoot: string): string {
  return join(repoRoot, WORKSPACE_PROTOCOL_FILE_NAME);
}

export function buildWorkspaceProtocolTemplate(repoRoot: string, now = new Date()): string {
  const projectName = sanitizeInlineLiteral(basename(repoRoot) || "repository");
  const appliesTo = sanitizeInlineLiteral(repoRoot);
  const reviewed = now.toISOString().slice(0, 10);
  return `# Workspace Protocol — ${projectName}

<!-- PASEO_WORKSPACE_PROTOCOL_VERSION: ${WORKSPACE_PROTOCOL_VERSION} -->

- identity: owner \`Human\`; version \`1\`; last_reviewed \`${reviewed}\`; applies_to \`${appliesTo}\`
- project risk/protected areas: risk class \`unclassified\`; chưa ghi nhận protected area riêng; Lead phải đọc current repository instructions và current bytes trước mutation.
- default topology: Lead-direct cho exact tiny task; chỉ thêm smallest useful Peer/Supervisor khi uncertainty, risk hoặc independent judgment thật sự cần.
- ownership/hotspots: mỗi moving/coupled scope có một write Owner; assignment phải nêu shared hoặc coupled surfaces trước delegation.
- routing defaults: discover rồi pin provider/model/effort trong bounded assignment; không silent fallback; route phải có reason, scope và expiry.
- issue tracker: Beads Central là durable issue/work graph bắt buộc cho Lead, Peer và Supervisor. Mỗi role phải gọi \`beads_status\` khi bắt đầu assignment, dùng đúng project do Paseo bind, đọc issue liên quan trước action và ghi authoritative readback ở material handoff; nếu Central unavailable thì mutation \`BLOCKED\` và issue state giữ \`UNKNOWN\`, việc inspect không mutation vẫn tiếp tục, không fallback sang native \`bd\` hoặc tracker thứ hai. Lead create/update graph và chỉ close sau verdict; Peer claim/update đúng granted issue và tạo discovered work bằng \`discoveredFrom\`; Supervisor read-only.
- existing harness: chưa khảo sát. Ghi ra những gì đã cai trị repository này (\`AGENTS.md\`, \`CONTRIBUTING\`, CI gates, review conventions) và protocol này nhường cái nào; chỉ ghi \`none\` sau khi đã thực sự nhìn.
- project policy: \`none\`; chỉ activate exact package + version + scope + authority + conflict rule bằng Human decision hoặc protocol revision mới.
- review/evidence: focused checks và current diff là mặc định; independent review theo material risk; Lead/Human giữ acceptance authority.
- escalation/Human decisions: dùng \`REOPEN\`, \`DEPENDENCY\` hoặc \`BLOCKED\` với evidence và exact decision cần Human chốt.
- repository exceptions/anti-patterns: chưa ghi nhận exception riêng; không dựng control plane thứ hai, self-approve hoặc mở rộng lease từ tool/runtime capability.
`;
}

function hasMandatoryIssueTrackerClause(content: string): boolean {
  const trackerClauses = content.match(/^- issue tracker:[^\n]+$/gimu) ?? [];
  if (trackerClauses.length !== 1) return false;
  const trackerClause = trackerClauses[0]?.toLowerCase() ?? "";
  const marksMandatory = trackerClause.includes("bắt buộc") || trackerClause.includes("mandatory");
  return marksMandatory && REQUIRED_TRACKER_TERMS.every((term) => trackerClause.includes(term));
}

function canonicalIdentityPath(value: string): string {
  let canonical: string;
  try {
    canonical = realpathSync.native(value);
  } catch {
    canonical = resolve(value);
  }
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function hasMismatchedIdentityScope(content: string, repoRoot: string): boolean {
  const explicitScope = content.match(/\bapplies_to\s*(?:[:=]\s*|\s+)`([^`\r\n]+)`/iu)?.[1]?.trim();
  return Boolean(
    explicitScope &&
    isAbsolute(explicitScope) &&
    canonicalIdentityPath(explicitScope) !== canonicalIdentityPath(repoRoot),
  );
}

export function validateWorkspaceProtocol(
  content: string,
  repoRoot?: string,
): WorkspaceProtocolIssue[] {
  const issues: WorkspaceProtocolIssue[] = [];
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength === 0 || content.trim().length === 0) issues.push("empty");
  if (byteLength > MAX_WORKSPACE_PROTOCOL_BYTES) issues.push("too_large");
  if (!/^#\s+Workspace Protocol\b/mu.test(content)) issues.push("missing_title");
  const markerMentions = content.match(/<!--[^>]*PASEO_WORKSPACE_PROTOCOL_VERSION[^>]*-->/gu) ?? [];
  if (markerMentions.length === 0) issues.push("missing_version_marker");
  if (markerMentions.length > 1) issues.push("duplicate_version_marker");
  if (markerMentions.some((marker) => !WELL_FORMED_MARKER.test(marker.trim()))) {
    issues.push("unsupported_version");
  }
  if (/\{\{REQUIRED:[^{}]+\}\}/u.test(content)) issues.push("unresolved_placeholder");
  if (/^(?:<{7}|={7}|>{7})(?:\s|$)/mu.test(content)) issues.push("conflict_marker");

  const identityCategoryCount = IDENTITY_CATEGORIES.filter((patterns) =>
    patterns.some((pattern) => pattern.test(content)),
  ).length;
  if (identityCategoryCount < 2) issues.push("missing_identity");
  if (repoRoot && hasMismatchedIdentityScope(content, repoRoot)) {
    issues.push("mismatched_identity_scope");
  }
  if (!hasMandatoryIssueTrackerClause(content)) issues.push("missing_issue_tracker");
  return issues;
}

export function inspectWorkspaceProtocol(repoRoot: string): WorkspaceProtocolSnapshot {
  const protocolPath = resolveWorkspaceProtocolPath(repoRoot);
  try {
    const content = readFileSync(protocolPath, "utf8");
    const revision = revisionFor(protocolPath, content);
    const issues = validateWorkspaceProtocol(content, repoRoot);
    return {
      status: issues.length === 0 ? "valid" : "invalid",
      repoRoot,
      path: protocolPath,
      content,
      revision,
      issues,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        status: "missing",
        repoRoot,
        path: protocolPath,
        suggestedContent: buildWorkspaceProtocolTemplate(repoRoot),
        revision: null,
        issues: [],
      };
    }
    return {
      status: "unreadable",
      repoRoot,
      path: protocolPath,
      revision: null,
      issues: [],
    };
  }
}

export function writeWorkspaceProtocol(input: {
  repoRoot: string;
  content: string;
  expectedRevision: WorkspaceProtocolRevision | null;
}): WriteWorkspaceProtocolResult {
  const issues = validateWorkspaceProtocol(input.content, input.repoRoot);
  if (issues.length > 0) {
    return { ok: false, error: { code: "invalid_content", issues } };
  }

  const protocolPath = resolveWorkspaceProtocolPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${WORKSPACE_PROTOCOL_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );
  const normalizedContent = input.content.endsWith("\n") ? input.content : `${input.content}\n`;

  try {
    const current = inspectWorkspaceProtocol(input.repoRoot);
    if (!revisionMatches(snapshotRevision(current), input.expectedRevision)) {
      return { ok: false, error: { code: "stale_workspace_protocol", current } };
    }
    if (current.status === "unreadable" || isSymbolicLink(protocolPath)) {
      return { ok: false, error: { code: "write_failed" } };
    }

    writeFileSync(tempPath, normalizedContent, { encoding: "utf8", mode: 0o644 });
    if (current.status === "valid" || current.status === "invalid") {
      chmodSync(tempPath, statSync(protocolPath).mode & 0o777);
    }
    renameSync(tempPath, protocolPath);

    const snapshot = inspectWorkspaceProtocol(input.repoRoot);
    if (snapshot.status !== "valid") {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, snapshot };
  } catch {
    removeTemporaryFile(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function revisionFor(path: string, content: string): WorkspaceProtocolRevision {
  const stats = statSync(path);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function snapshotRevision(snapshot: WorkspaceProtocolSnapshot): WorkspaceProtocolRevision | null {
  return snapshot.status === "valid" || snapshot.status === "invalid" ? snapshot.revision : null;
}

function revisionMatches(
  left: WorkspaceProtocolRevision | null,
  right: WorkspaceProtocolRevision | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.mtimeMs === right.mtimeMs && left.size === right.size && left.sha256 === right.sha256;
}

function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function sanitizeInlineLiteral(value: string): string {
  return value.replaceAll("`", "'").replaceAll("\n", " ").replaceAll("\r", " ");
}

function removeTemporaryFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Preserve the original write result; temp cleanup is best effort.
  }
}
