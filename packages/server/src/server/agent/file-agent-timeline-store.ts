import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { writeFileAtomic, writeJsonFileAtomic } from "../atomic-file.js";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
} from "./agent-timeline-store-types.js";

interface TimelinePaths {
  rows: string;
  metadata: string;
}

function parseRow(agentId: string, line: string): AgentTimelineRow {
  const value: unknown = JSON.parse(line);
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

  constructor(private readonly baseDir: string) {}

  async appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): Promise<AgentTimelineRow> {
    return this.withAgent(agentId, async () => {
      await this.ensureLoaded(agentId);
      const row = this.memory.append(agentId, item, options);
      await this.appendRows(agentId, [row]);
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
      const paths = this.paths(agentId);
      await Promise.all([
        fs.rm(paths.rows, { force: true }),
        fs.rm(paths.metadata, { force: true }),
      ]);
    });
  }

  async bulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    if (rows.length === 0) return;
    return this.withAgent(agentId, async () => {
      await this.ensureLoaded(agentId);
      const current = this.memory.getRows(agentId);
      const existingSeqs = new Set(current.map((row) => row.seq));
      const additions = rows
        .filter((row) => !existingSeqs.has(row.seq))
        .toSorted((left, right) => left.seq - right.seq);
      if (additions.length === 0) return;
      const fetched = this.memory.fetch(agentId, { direction: "tail", limit: 0 });
      const merged = [...current, ...additions].toSorted((left, right) => left.seq - right.seq);
      this.memory.initialize(agentId, {
        epoch: fetched.epoch,
        rows: merged,
        nextSeq: (merged.at(-1)?.seq ?? 0) + 1,
      });
      await this.appendRows(agentId, additions);
    });
  }

  async updateCommittedRow(agentId: string, row: AgentTimelineRow): Promise<void> {
    return this.withAgent(agentId, async () => {
      await this.ensureLoaded(agentId);
      const current = this.memory.getRows(agentId);
      const index = current.findIndex((candidate) => candidate.seq === row.seq);
      if (index < 0) {
        throw new Error(`Durable timeline row ${row.seq} not found for agent ${agentId}`);
      }
      current[index] = row;
      const fetched = this.memory.fetch(agentId, { direction: "tail", limit: 0 });
      this.memory.initialize(agentId, {
        epoch: fetched.epoch,
        rows: current,
        nextSeq: fetched.window.nextSeq,
      });
      await this.writeRows(agentId, current);
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
    const [metadataText, rowsText] = await Promise.all([
      fs.readFile(paths.metadata, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
      fs.readFile(paths.rows, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      }),
    ]);
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
    const rows = rowsText
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => parseRow(agentId, line));
    const deduplicated = [...new Map(rows.map((row) => [row.seq, row])).values()].toSorted(
      (left, right) => left.seq - right.seq,
    );
    this.memory.initialize(agentId, {
      epoch,
      rows: deduplicated,
      nextSeq: (deduplicated.at(-1)?.seq ?? 0) + 1,
    });
    this.loaded.add(agentId);
  }

  private async appendRows(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    const paths = this.paths(agentId);
    await fs.mkdir(this.baseDir, { recursive: true });
    await this.persistMetadata(agentId);
    await fs.appendFile(
      paths.rows,
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      "utf8",
    );
  }

  private async writeRows(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await this.persistMetadata(agentId);
    await writeFileAtomic(
      this.paths(agentId).rows,
      rows.length > 0 ? rows.map((row) => JSON.stringify(row)).join("\n") + "\n" : "",
    );
  }

  private async persistMetadata(agentId: string): Promise<void> {
    const epoch = this.memory.fetch(agentId, { direction: "tail", limit: 0 }).epoch;
    await writeJsonFileAtomic(this.paths(agentId).metadata, { version: 1, epoch });
  }

  private paths(agentId: string): TimelinePaths {
    const filename = encodeURIComponent(agentId);
    return {
      rows: path.join(this.baseDir, `${filename}.jsonl`),
      metadata: path.join(this.baseDir, `${filename}.meta.json`),
    };
  }
}
