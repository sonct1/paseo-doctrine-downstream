import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import type {
  WorkspaceProtocolIssue,
  WorkspaceProtocolRevision,
  WorkspaceProtocolRpcError,
  WorkspaceProtocolSnapshot,
} from "@getpaseo/protocol/workspace-protocol-schema";

export const WORKSPACE_PROTOCOL_FILE_NAME = "WORKSPACE_PROTOCOL.md";
export const WORKSPACE_PROTOCOL_VERSION = 2;
const MAX_WORKSPACE_PROTOCOL_BYTES = 64 * 1024;

const REQUIRED_CLAUSES: ReadonlyArray<{
  issue: WorkspaceProtocolIssue;
  pattern: RegExp;
}> = [
  { issue: "missing_identity", pattern: /^- identity:/mu },
  { issue: "missing_risk", pattern: /^- project risk\/protected areas:/mu },
  { issue: "missing_topology", pattern: /^- default topology:/mu },
  { issue: "missing_ownership", pattern: /^- ownership\/hotspots:/mu },
  { issue: "missing_routing", pattern: /^- routing defaults:/mu },
  { issue: "missing_project_policy", pattern: /^- project policy:/mu },
  { issue: "missing_review_evidence", pattern: /^- review\/evidence:/mu },
  { issue: "missing_escalation", pattern: /^- escalation\/Human decisions:/mu },
  {
    issue: "missing_exceptions",
    pattern: /^- repository exceptions\/anti-patterns:/mu,
  },
];

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
- project policy: \`none\`; chỉ activate exact package + version + scope + authority + conflict rule bằng Human decision hoặc protocol revision mới.
- review/evidence: focused checks và current diff là mặc định; independent review theo material risk; Lead/Human giữ acceptance authority.
- escalation/Human decisions: dùng \`REOPEN\`, \`DEPENDENCY\` hoặc \`BLOCKED\` với evidence và exact decision cần Human chốt.
- repository exceptions/anti-patterns: chưa ghi nhận exception riêng; không dựng control plane thứ hai, self-approve hoặc mở rộng lease từ tool/runtime capability.
`;
}

export function validateWorkspaceProtocol(content: string): WorkspaceProtocolIssue[] {
  const issues: WorkspaceProtocolIssue[] = [];
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength === 0 || content.trim().length === 0) issues.push("empty");
  if (byteLength > MAX_WORKSPACE_PROTOCOL_BYTES) issues.push("too_large");
  if (!/^# Workspace Protocol(?:\s|—|-)/u.test(content)) issues.push("missing_title");

  const marker = content.match(/<!--\s*PASEO_WORKSPACE_PROTOCOL_VERSION:\s*(\d+)\s*-->/u);
  if (!marker) {
    issues.push("missing_version_marker");
  } else if (Number(marker[1]) !== WORKSPACE_PROTOCOL_VERSION) {
    issues.push("unsupported_version");
  }
  if (/\{\{\s*REQUIRED(?::|_)/u.test(content)) issues.push("unresolved_placeholder");
  if (/^(?:<{7}|={7}|>{7})(?:\s|$)/mu.test(content)) issues.push("conflict_marker");

  for (const clause of REQUIRED_CLAUSES) {
    if (!clause.pattern.test(content)) issues.push(clause.issue);
  }
  return issues;
}

export function inspectWorkspaceProtocol(repoRoot: string): WorkspaceProtocolSnapshot {
  const protocolPath = resolveWorkspaceProtocolPath(repoRoot);
  try {
    const content = readFileSync(protocolPath, "utf8");
    const revision = revisionFor(protocolPath, content);
    const issues = validateWorkspaceProtocol(content);
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
  const issues = validateWorkspaceProtocol(input.content);
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
