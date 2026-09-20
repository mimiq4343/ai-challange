import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

type SharedConnection = {
  database: DatabaseSync;
  references: number;
};

const globalForDatabase = globalThis as typeof globalThis & {
  chatDatabases?: Map<string, SharedConnection>;
};

/**
 * Возвращает общее соединение для файла базы: несколько хранилищ работают с
 * одним WAL-файлом через одно соединение, поэтому второй writer не появляется.
 */
export function openChatDatabase(databasePath: string): DatabaseSync {
  const pool = (globalForDatabase.chatDatabases ??= new Map<string, SharedConnection>());
  const key = resolve(databasePath);
  const existing = pool.get(key);
  if (existing) {
    existing.references += 1;
    return existing.database;
  }

  mkdirSync(dirname(key), { recursive: true });
  const database = new DatabaseSync(key, { timeout: 5_000 });
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
  `);
  pool.set(key, { database, references: 1 });
  return database;
}

/**
 * Освобождает ссылку на соединение и закрывает его, когда владельцев не
 * осталось.
 */
export function releaseChatDatabase(databasePath: string): void {
  const pool = globalForDatabase.chatDatabases;
  const key = resolve(databasePath);
  const shared = pool?.get(key);
  if (!pool || !shared) return;

  shared.references -= 1;
  if (shared.references > 0) return;

  pool.delete(key);
  shared.database.close();
}
