import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import {
  COUNCIL_REPORT_RECEIPT_VERSION,
  COUNCIL_REPORT_RECEIPT_VERSION_LABEL,
} from "@getpaseo/protocol/council-labels";
import {
  CouncilCaseRecordSchema,
  CouncilPhaseSchema,
  CouncilSeatIntegritySchema,
  CouncilSeatReportReceiptSchema,
  CouncilSeatRoleSchema,
  CouncilTierSchema,
  type CouncilCaseRecord,
  type CouncilPhase,
  type CouncilSeatIntegrity,
  type CouncilSeatReportReceipt,
  type CouncilSeatRole,
  type CouncilTier,
} from "@getpaseo/protocol/council/types";
import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";
import { writeJsonFileAtomic } from "../atomic-file.js";
import type { StoredAgentRecord } from "../agent/agent-storage.js";

const StorePayloadSchema = z.object({
  schemaVersion: z.literal(1),
  legacyMigrationCompletedAt: z.string().nullable(),
  cases: z.array(CouncilCaseRecordSchema),
});

const PHASE_ORDER: Record<CouncilPhase, number> = {
  sealed: 0,
  review: 1,
  audit: 2,
  verdict: 3,
};

export interface CreateCouncilCaseInput {
  id: string;
  title: string;
  question: string;
  tier: CouncilTier;
  roomId: string;
  kickoffMessageId: string;
  workspaceId: string | null;
  projectId: string | null;
  parentAgentId: string;
  roles: readonly CouncilSeatRole[];
}

export interface RecordCouncilSeatInput {
  caseId: string;
  agentId: string;
  phase: CouncilPhase;
  integrity: CouncilSeatIntegrity;
  disposition?: string;
  reportReceipt?: CouncilSeatReportReceipt;
}

export interface CouncilCaseStoreOptions {
  paseoHome: string;
  logger: Logger;
  writeJson?: typeof writeJsonFileAtomic;
  onCaseUpdated?: (council: CouncilCaseRecord) => void;
}

function readLabel(labels: Readonly<Record<string, string>>, key: string): string {
  return labels[key]?.trim() ?? "";
}

function maxPhase(phases: readonly CouncilPhase[]): CouncilPhase {
  return phases.reduce<CouncilPhase>(
    (highest, phase) => (PHASE_ORDER[phase] > PHASE_ORDER[highest] ? phase : highest),
    "sealed",
  );
}

function councilStorageKey(council: Pick<CouncilCaseRecord, "id" | "scopeId">): string {
  return JSON.stringify([council.scopeId, council.id]);
}

function legacyReportReceipt(record: StoredAgentRecord): CouncilSeatReportReceipt | null {
  const labels = record.labels;
  if (readLabel(labels, COUNCIL_REPORT_RECEIPT_VERSION_LABEL) !== COUNCIL_REPORT_RECEIPT_VERSION) {
    return null;
  }
  const receipt = CouncilSeatReportReceiptSchema.safeParse({
    roomId: readLabel(labels, "council.room_id"),
    kickoffMessageId: readLabel(labels, "council.kickoff_message_id"),
    reportMessageId: readLabel(labels, "council.report_message_id"),
    reportDigest: readLabel(labels, "council.report_digest"),
    authorAgentId: record.id,
    startSentinel: readLabel(labels, "council.report_start_sentinel"),
    endSentinel: readLabel(labels, "council.report_end_sentinel"),
    createdAt: readLabel(labels, "council.report_created_at"),
  });
  return receipt.success ? receipt.data : null;
}

function legacyCouncilScope(record: StoredAgentRecord): string {
  if (record.workspaceId) return `workspace:${record.workspaceId}`;
  const parentAgentId = getParentAgentIdFromLabels(record.labels);
  if (parentAgentId) return `parent:${parentAgentId}`;
  return `agent:${record.id}`;
}

function groupLegacyCases(records: readonly StoredAgentRecord[]): StoredAgentRecord[][] {
  const grouped = new Map<string, StoredAgentRecord[]>();
  for (const record of records) {
    const caseId = readLabel(record.labels, "council.case_id");
    const role = CouncilSeatRoleSchema.safeParse(readLabel(record.labels, "council.role"));
    if (!caseId || !role.success) continue;
    const groupKey = JSON.stringify([legacyCouncilScope(record), caseId]);
    const existing = grouped.get(groupKey) ?? [];
    existing.push(record);
    grouped.set(groupKey, existing);
  }
  return Array.from(grouped.values());
}

function canonicalLegacySeats(records: readonly StoredAgentRecord[]): {
  seats: CouncilCaseRecord["seats"];
  deduplicatedSeats: number;
} {
  const seatByRole = new Map<CouncilSeatRole, CouncilCaseRecord["seats"][number]>();
  let deduplicatedSeats = 0;
  for (const record of records) {
    const role = CouncilSeatRoleSchema.safeParse(readLabel(record.labels, "council.role"));
    const phase = CouncilPhaseSchema.safeParse(readLabel(record.labels, "council.phase"));
    if (!role.success || !phase.success) continue;
    const parsedIntegrity = CouncilSeatIntegritySchema.safeParse(
      readLabel(record.labels, "council.integrity"),
    );
    const reportReceipt = legacyReportReceipt(record);
    let integrity: CouncilSeatIntegrity = parsedIntegrity.success
      ? parsedIntegrity.data
      : "unspecified";
    if (integrity === "valid" && !reportReceipt) integrity = "unspecified";
    if (seatByRole.has(role.data)) deduplicatedSeats += 1;
    seatByRole.set(role.data, {
      role: role.data,
      round: readLabel(record.labels, "council.round") || "1",
      agentId: record.id,
      phase: phase.data,
      integrity,
      disposition: readLabel(record.labels, "council.disposition") || null,
      reportReceipt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
  return { seats: Array.from(seatByRole.values()), deduplicatedSeats };
}

function migrateLegacyCase(
  caseRecords: readonly StoredAgentRecord[],
  projectIdByWorkspaceId: ReadonlyMap<string, string>,
): { council: CouncilCaseRecord | null; deduplicatedSeats: number } {
  const ordered = [...caseRecords].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const first = ordered[0];
  if (!first) return { council: null, deduplicatedSeats: 0 };
  const caseId = readLabel(first.labels, "council.case_id");
  const tier = CouncilTierSchema.safeParse(readLabel(first.labels, "council.tier"));
  const roomId = readLabel(first.labels, "council.room_id");
  const kickoffMessageId = readLabel(first.labels, "council.kickoff_message_id");
  if (!tier.success || !roomId || !kickoffMessageId) {
    return { council: null, deduplicatedSeats: 0 };
  }

  const { seats, deduplicatedSeats } = canonicalLegacySeats(ordered);
  if (seats.length === 0) return { council: null, deduplicatedSeats };
  const workspaceId = first.workspaceId ?? null;
  const candidate = CouncilCaseRecordSchema.safeParse({
    schemaVersion: 1,
    id: caseId,
    title: readLabel(first.labels, "council.title") || caseId,
    question: readLabel(first.labels, "council.title") || caseId,
    tier: tier.data,
    phase: maxPhase(seats.map((seat) => seat.phase)),
    roomId,
    kickoffMessageId,
    scopeId: legacyCouncilScope(first),
    workspaceId,
    projectId: workspaceId ? (projectIdByWorkspaceId.get(workspaceId) ?? null) : null,
    parentAgentId: getParentAgentIdFromLabels(first.labels),
    seats,
    createdAt: first.createdAt,
    updatedAt: ordered.at(-1)?.updatedAt ?? first.updatedAt,
  });
  return { council: candidate.success ? candidate.data : null, deduplicatedSeats };
}

function legacyCases(
  records: readonly StoredAgentRecord[],
  projectIdByWorkspaceId: ReadonlyMap<string, string>,
): { cases: CouncilCaseRecord[]; deduplicatedSeats: number; skippedCases: number } {
  const migrated: CouncilCaseRecord[] = [];
  let deduplicatedSeats = 0;
  let skippedCases = 0;

  for (const caseRecords of groupLegacyCases(records)) {
    const result = migrateLegacyCase(caseRecords, projectIdByWorkspaceId);
    deduplicatedSeats += result.deduplicatedSeats;
    if (result.council) {
      migrated.push(result.council);
    } else {
      skippedCases += 1;
    }
  }
  return { cases: migrated, deduplicatedSeats, skippedCases };
}

export class CouncilCaseStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private readonly writeJson: typeof writeJsonFileAtomic;
  private readonly onCaseUpdated: ((council: CouncilCaseRecord) => void) | undefined;
  private readonly cases = new Map<string, CouncilCaseRecord>();
  private loaded = false;
  private legacyMigrationCompletedAt: string | null = null;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(options: CouncilCaseStoreOptions) {
    this.filePath = path.join(options.paseoHome, "councils", "cases.json");
    this.logger = options.logger.child({ module: "council-case-store" });
    this.writeJson = options.writeJson ?? writeJsonFileAtomic;
    this.onCaseUpdated = options.onCaseUpdated;
  }

  async list(): Promise<CouncilCaseRecord[]> {
    await this.load();
    return Array.from(this.cases.values()).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async create(input: CreateCouncilCaseInput): Promise<CouncilCaseRecord> {
    return this.mutate(
      () => {
        const now = new Date().toISOString();
        const record = CouncilCaseRecordSchema.parse({
          schemaVersion: 1,
          ...input,
          scopeId: input.workspaceId
            ? `workspace:${input.workspaceId}`
            : `parent:${input.parentAgentId}`,
          phase: "sealed",
          seats: input.roles.map((role) => ({
            role,
            round: "1",
            agentId: null,
            phase: "sealed",
            integrity: "unspecified",
            disposition: null,
            reportReceipt: null,
            createdAt: now,
            updatedAt: now,
          })),
          createdAt: now,
          updatedAt: now,
        });
        const storageKey = councilStorageKey(record);
        if (this.cases.has(storageKey)) {
          throw new Error(`Council case '${input.id}' already exists in this scope`);
        }
        this.cases.set(storageKey, record);
        return record;
      },
      (council) => this.publishCaseUpdate(council),
    );
  }

  async assertSeatLaunch(
    caseId: string,
    role: CouncilSeatRole,
    parentAgentId: string,
    workspaceId: string | null,
  ): Promise<void> {
    await this.load();
    const council = this.requireCase(caseId, parentAgentId);
    if (council.workspaceId !== workspaceId) {
      throw new Error(`Council '${caseId}' seat must launch in its canonical workspace`);
    }
    const seat = council.seats.find((candidate) => candidate.role === role);
    if (!seat) throw new Error(`Council '${caseId}' has no '${role}' seat`);
    if (seat.agentId) throw new Error(`Council '${caseId}' '${role}' seat is already assigned`);
  }

  async assignSeat(input: {
    caseId: string;
    role: CouncilSeatRole;
    agentId: string;
    parentAgentId: string;
    workspaceId: string | null;
  }): Promise<CouncilCaseRecord> {
    return this.mutate(
      () => {
        const council = this.requireCase(input.caseId, input.parentAgentId);
        if (council.workspaceId !== input.workspaceId) {
          throw new Error(`Council '${input.caseId}' seat must launch in its canonical workspace`);
        }
        const seatIndex = council.seats.findIndex((seat) => seat.role === input.role);
        if (seatIndex < 0) throw new Error(`Council '${input.caseId}' has no '${input.role}' seat`);
        const seat = council.seats[seatIndex];
        if (!seat) throw new Error(`Council '${input.caseId}' seat disappeared`);
        if (seat.agentId && seat.agentId !== input.agentId) {
          throw new Error(`Council '${input.caseId}' '${input.role}' seat is already assigned`);
        }
        const now = new Date().toISOString();
        const seats = [...council.seats];
        seats[seatIndex] = { ...seat, agentId: input.agentId, updatedAt: now };
        const updated = CouncilCaseRecordSchema.parse({ ...council, seats, updatedAt: now });
        this.cases.set(councilStorageKey(updated), updated);
        return updated;
      },
      (council) => this.publishCaseUpdate(council),
    );
  }

  async recordSeat(input: RecordCouncilSeatInput): Promise<CouncilCaseRecord> {
    return this.mutate(
      () => {
        const matches = Array.from(this.cases.values()).filter(
          (candidate) =>
            candidate.id === input.caseId &&
            candidate.seats.some((seat) => seat.agentId === input.agentId),
        );
        if (matches.length !== 1) {
          throw new Error(
            matches.length === 0
              ? `Agent '${input.agentId}' is not assigned to Council '${input.caseId}'`
              : `Agent '${input.agentId}' has an ambiguous Council '${input.caseId}' assignment`,
          );
        }
        const council = matches[0]!;
        const seatIndex = council.seats.findIndex((seat) => seat.agentId === input.agentId);
        if (seatIndex < 0) {
          throw new Error(`Agent '${input.agentId}' is not assigned to Council '${input.caseId}'`);
        }
        const seat = council.seats[seatIndex];
        if (!seat) throw new Error(`Council '${input.caseId}' seat disappeared`);
        if (PHASE_ORDER[input.phase] < PHASE_ORDER[seat.phase]) {
          throw new Error(
            `Council '${input.caseId}' seat phase cannot regress from '${seat.phase}' to '${input.phase}'`,
          );
        }
        const now = new Date().toISOString();
        const seats = [...council.seats];
        seats[seatIndex] = {
          ...seat,
          phase: input.phase,
          integrity: input.integrity,
          disposition: input.disposition ?? seat.disposition,
          reportReceipt: input.reportReceipt ?? seat.reportReceipt,
          updatedAt: now,
        };
        const updated = CouncilCaseRecordSchema.parse({
          ...council,
          phase: maxPhase(seats.map((candidate) => candidate.phase)),
          seats,
          updatedAt: now,
        });
        this.cases.set(councilStorageKey(updated), updated);
        return updated;
      },
      (council) => this.publishCaseUpdate(council),
    );
  }

  async migrateLegacyAgentLabels(
    records: readonly StoredAgentRecord[],
    projectIdByWorkspaceId: ReadonlyMap<string, string>,
  ): Promise<number> {
    return this.mutate(() => {
      if (this.legacyMigrationCompletedAt) return 0;
      let imported = 0;
      const migration = legacyCases(records, projectIdByWorkspaceId);
      for (const council of migration.cases) {
        const storageKey = councilStorageKey(council);
        if (this.cases.has(storageKey)) continue;
        this.cases.set(storageKey, council);
        imported += 1;
      }
      this.legacyMigrationCompletedAt = new Date().toISOString();
      if (imported > 0) {
        this.logger.info({ imported }, "Migrated legacy Council labels into canonical cases");
      }
      if (migration.deduplicatedSeats > 0 || migration.skippedCases > 0) {
        this.logger.warn(
          {
            deduplicatedSeats: migration.deduplicatedSeats,
            skippedCases: migration.skippedCases,
          },
          "Legacy Council migration discarded non-canonical duplicate or malformed state",
        );
      }
      return imported;
    });
  }

  private requireCase(caseId: string, parentAgentId: string): CouncilCaseRecord {
    const matches = Array.from(this.cases.values()).filter(
      (council) => council.id === caseId && council.parentAgentId === parentAgentId,
    );
    if (matches.length === 0) throw new Error(`Council case '${caseId}' is unavailable`);
    if (matches.length > 1) {
      throw new Error(`Council case '${caseId}' is ambiguous for Lead '${parentAgentId}'`);
    }
    return matches[0]!;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const parsed = StorePayloadSchema.parse(
        JSON.parse(await fs.readFile(this.filePath, "utf8")) as unknown,
      );
      this.cases.clear();
      for (const council of parsed.cases) this.cases.set(councilStorageKey(council), council);
      this.legacyMigrationCompletedAt = parsed.legacyMigrationCompletedAt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  private async mutate<TResult>(
    mutation: () => TResult,
    afterCommit?: (result: TResult) => void,
  ): Promise<TResult> {
    await this.load();
    const previousTail = this.writeTail;
    let release!: () => void;
    this.writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previousTail;
    const casesBeforeMutation = new Map(this.cases);
    const migrationBeforeMutation = this.legacyMigrationCompletedAt;
    try {
      const result = mutation();
      await this.writeJson(this.filePath, {
        schemaVersion: 1,
        legacyMigrationCompletedAt: this.legacyMigrationCompletedAt,
        cases: Array.from(this.cases.values()),
      });
      if (afterCommit) {
        try {
          afterCommit(result);
        } catch (error) {
          this.logger.warn({ error }, "Failed to publish canonical Council case update");
        }
      }
      return result;
    } catch (error) {
      this.cases.clear();
      for (const [caseId, council] of casesBeforeMutation) {
        this.cases.set(caseId, council);
      }
      this.legacyMigrationCompletedAt = migrationBeforeMutation;
      throw error;
    } finally {
      release();
    }
  }

  private publishCaseUpdate(council: CouncilCaseRecord): void {
    this.onCaseUpdated?.(council);
  }
}
