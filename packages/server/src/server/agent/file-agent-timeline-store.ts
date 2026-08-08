import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { writeJsonFileAtomic } from "../atomic-file.js";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
} from "./agent-timeline-store-types.js";

interface TimelinePaths {
  root: string;
  rows: string;
  metadata: string;
}

function parseRow(agentId: string, value: unknown): AgentTimelineRow {
  if (
    !value ||
    typeof value !== "object" ||
    !Number.isInteger(Reflect.get(value, "seq")) ||
    (Reflect.get(value, "seq") as number) < 1 ||
    typeof Reflect.get(value, "timestamp") !== "string" ||
    !Reflect.get(value, "item") ||
    typeof Reflect.get(value, "item") !== "object"
  ) {
    throw new Error(`Invalid durable timeline row for agent ${agentId}`);
  }
  return value as AgentTimelineRow;
}

export class FileAgentTimelineStore implements AgentTimelineStore {
  private readonly memory = new InMemoryAgentTimelineStore();
  private readonly loaded = new Set<string>();
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly baseDir: string,
    private readonly writeJson: typeof writeJsonFileAtomic = writeJsonFileAtomic,
  ) {}

  async appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): Promise<AgentTimelineRow> {
    return this.withAgent(agentId, async () => {
      await this.ensureLoaded(agentId);
      const fetched = this.memory.fetch(agentId, { direction: "tail", limit: 0 });
      const row: AgentTimelineRow = {
        seq: fetched.window.nextSeq,
        timestamp: options?.timestamp ?? new Date().toISOString(),
        item,
      };
      await this.persistRows(agentId, [row]);
      this.replaceMemory(agentId, fetched.epoch, [...fetched.rows, row]);
      return row;
    });
  }

  async fetchCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    return this.withAgent(agentId, async () => {
      await this.ensureLoaded(agentId);
      return this.memory.fetch(agentId, options);
    });
  }

  async getLatestCommittedSeq(agentId: string): Promise<number> {
    return this.withAgent(agentId, async () => {
      await this.ensureLoaded(agentId);
      return this.memory.fetch(agentId, { direction: "tail", limit: 0 }).window.maxSeq;
    });
  }

  async getCommittedRows(agentId: string): Promise<AgentTimelineRow[]> {
    return this.withAgent(agentId, async () => {
      await this.ensureLoaded(agentId);
      return this.memory.getRows(agentId);
    });
  }

  async getLastItem(agentId: string): Promise<AgentTimelineItem | null> {
    return this.withAgent(agentId, async () => {
      await this.ensureLoaded(agentId);
      return this.memory.getLastItem(agentId);
    });
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    return this.withAgent(agentId, async () => {
      await this.ensureLoaded(agentId);
      return this.memory.getLastAssistantMessage(agentId);
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    return this.withAgent(agentId, async () => {
      this.memory.delete(agentId);
      this.loaded.delete(agentId);
      await fs.rm(this.paths(agentId).root, { recursive: true, force: true });
    });
  }

  async bulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    if (rows.length === 0) return;
    return this.withAgent(agentId, async () => {
      await this.ensureLoaded(agentId);
      const fetched = this.memory.fetch(agentId, { direction: "tail", limit: 0 });
      const existingSeqs = new Set(fetched.rows.map((row) => row.seq));
      const additions = rows
        .filter((row) => !existingSeqs.has(row.seq))
        .toSorted((left, right) => left.seq - right.seq);
      if (additions.length === 0) return;
      await this.persistRows(agentId, additions);
      this.replaceMemory(agentId, fetched.epoch, [...fetched.rows, ...additions]);
    });
  }

  async updateCommittedRow(agentId: string, row: AgentTimelineRow): Promise<void> {
    return this.withAgent(agentId, async () => {
      await this.ensureLoaded(agentId);
      const fetched = this.memory.fetch(agentId, { direction: "tail", limit: 0 });
      const index = fetched.rows.findIndex((candidate) => candidate.seq === row.seq);
      if (index < 0) {
        throw new Error(`Durable timeline row ${row.seq} not found for agent ${agentId}`);
      }
      await this.persistRows(agentId, [row]);
      const updated = [...fetched.rows];
      updated[index] = row;
      this.replaceMemory(agentId, fetched.epoch, updated);
    });
  }

  private async withAgent<T>(agentId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(agentId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(action);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(agentId, tail);
    void tail.finally(() => {
      if (this.tails.get(agentId) === tail) this.tails.delete(agentId);
    });
    return run;
  }

  private async ensureLoaded(agentId: string): Promise<void> {
    if (this.loaded.has(agentId)) return;
    const paths = this.paths(agentId);
    const metadataText = await fs
      .readFile(paths.metadata, "utf8")
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    let epoch: string = randomUUID();
    if (metadataText) {
      const metadata: unknown = JSON.parse(metadataText);
      const storedEpoch =
        metadata && typeof metadata === "object" ? Reflect.get(metadata, "epoch") : undefined;
      if (typeof storedEpoch !== "string" || !storedEpoch) {
        throw new Error(`Invalid durable timeline metadata for agent ${agentId}`);
      }
      epoch = storedEpoch;
    }
    const entries = await fs
      .readdir(paths.rows, { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
    const rowFiles = entries
      .filter((entry) => entry.isFile() && /^\d+\.json$/.test(entry.name))
      .toSorted((left, right) => Number.parseInt(left.name) - Number.parseInt(right.name));
    const rows = await Promise.all(
      rowFiles.map(async (entry) => {
        const value: unknown = JSON.parse(
          await fs.readFile(path.join(paths.rows, entry.name), "utf8"),
        );
        return parseRow(agentId, value);
      }),
    );
    this.replaceMemory(agentId, epoch, rows);
    this.loaded.add(agentId);
  }

  private async persistRows(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    const paths = this.paths(agentId);
    await fs.mkdir(paths.rows, { recursive: true });
    await this.persistMetadata(agentId);
    await Promise.all(
      rows.map((row) => this.writeJson(path.join(paths.rows, `${row.seq}.json`), row)),
    );
  }

  private async persistMetadata(agentId: string): Promise<void> {
    const epoch = this.memory.fetch(agentId, { direction: "tail", limit: 0 }).epoch;
    await this.writeJson(this.paths(agentId).metadata, { version: 1, epoch });
  }

  private replaceMemory(agentId: string, epoch: string, rows: readonly AgentTimelineRow[]): void {
    const ordered = [...new Map(rows.map((row) => [row.seq, row])).values()].toSorted(
      (left, right) => left.seq - right.seq,
    );
    this.memory.initialize(agentId, {
      epoch,
      rows: ordered,
      nextSeq: (ordered.at(-1)?.seq ?? 0) + 1,
    });
  }

  private paths(agentId: string): TimelinePaths {
    const root = path.join(this.baseDir, encodeURIComponent(agentId));
    return {
      root,
      rows: path.join(root, "rows"),
      metadata: path.join(root, "metadata.json"),
    };
  }
}
