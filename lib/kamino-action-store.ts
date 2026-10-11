import "server-only";

import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertUuid(id: string) {
  if (!UUID_PATTERN.test(id)) {
    throw new Error("Kamino action id must be a UUID.");
  }
}

function isReadableUuidFile(name: string) {
  return name.endsWith(".json") && UUID_PATTERN.test(name.slice(0, -5));
}

function createdAtValue(record: Record<string, unknown>) {
  return typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : null;
}

/**
 * Single-process in-memory queue only. It is enough for route bundles inside
 * one Node process, but it does not coordinate across workers or hosts.
 */
export class KaminoActionStore<T extends { id: string; walletAddress: string; action: string; status: string }> {
  private readonly directory: string;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(filePath: string) {
    this.directory = `${filePath}.d`;
  }

  private recordPath(id: string) {
    return path.join(this.directory, `${id}.json`);
  }

  private tempPath(id: string) {
    return path.join(
      this.directory,
      `${id}.${process.pid}.${Date.now()}.${randomUUID().replaceAll("-", "")}.tmp`,
    );
  }

  async get(id: string): Promise<T | null> {
    assertUuid(id);
    try {
      const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ this.recordPath(id), "utf8")) as unknown;
      if (!isObject(parsed) || parsed.id !== id) {
        throw new Error("Stored Kamino action record is invalid.");
      }
      return parsed as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async put(record: T): Promise<void> {
    assertUuid(record.id);
    await mkdir(/* turbopackIgnore: true */ this.directory, { recursive: true, mode: 0o700 });
    const temporaryPath = this.tempPath(record.id);
    const finalPath = this.recordPath(record.id);
    try {
      await writeFile(/* turbopackIgnore: true */ temporaryPath, JSON.stringify(record, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(/* turbopackIgnore: true */ temporaryPath, /* turbopackIgnore: true */ finalPath);
    } catch (error) {
      await import("node:fs/promises").then(({ unlink }) => unlink(temporaryPath)).catch(() => undefined);
      throw error;
    }
  }

  async list(walletAddress: string): Promise<T[]> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(/* turbopackIgnore: true */ this.directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const records = await Promise.all(entries
      .filter((entry) => entry.isFile() && isReadableUuidFile(entry.name))
      .map(async (entry) => {
        const id = entry.name.slice(0, -5);
        const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ path.join(this.directory, entry.name), "utf8")) as unknown;
        if (!isObject(parsed) || parsed.id !== id) {
          throw new Error("Stored Kamino action record is invalid.");
        }
        return parsed as T;
      }));

    return records
      .filter((record) => record.walletAddress === walletAddress)
      .sort((left, right) => {
        const leftCreatedAt = createdAtValue(left as Record<string, unknown>);
        const rightCreatedAt = createdAtValue(right as Record<string, unknown>);
        if (leftCreatedAt !== null && rightCreatedAt !== null && leftCreatedAt !== rightCreatedAt) {
          return rightCreatedAt - leftCreatedAt;
        }
        if (leftCreatedAt !== null && rightCreatedAt === null) return -1;
        if (leftCreatedAt === null && rightCreatedAt !== null) return 1;
        return left.id.localeCompare(right.id);
      });
  }

  async withLock<R>(key: string, operation: () => Promise<R>): Promise<R> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === current) {
        this.locks.delete(key);
      }
    }
  }
}
