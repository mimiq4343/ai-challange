import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";

import { ensureMemorySchema } from "./memory-schema";
import { parseMcpUrl } from "./mcp-network";
import type { McpServerConfig, McpServerInput } from "./mcp-types";
import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";

const MAX_SERVER_NAME_LENGTH = 120;

type McpServerRow = {
  id: number;
  profile_id: number;
  name: string;
  url: string;
  created_at: string;
};

export class DuplicateMcpServerError extends Error {
  constructor() {
    super("MCP-сервер с таким URL уже добавлен в этот профиль.");
    this.name = "DuplicateMcpServerError";
  }
}

export class McpServerValidationError extends Error {
  constructor() {
    super(`Название MCP-сервера: от 1 до ${MAX_SERVER_NAME_LENGTH} символов.`);
    this.name = "McpServerValidationError";
  }
}

function toServer(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    url: row.url,
    createdAt: row.created_at,
  };
}

export class SqliteMcpServerStore {
  private readonly database: DatabaseSync;
  private readonly databasePath: string;
  private readonly listStatement: StatementSync;
  private readonly getStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly deleteStatement: StatementSync;
  private closed = false;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.database = openChatDatabase(databasePath);
    try {
      ensureMemorySchema(this.database);
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS mcp_servers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES memory_profiles(id) ON DELETE CASCADE,
          name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND ${MAX_SERVER_NAME_LENGTH}),
          url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (profile_id, url)
        ) STRICT;
      `);

      const columns = "id, profile_id, name, url, created_at";
      this.listStatement = this.database.prepare(`
        SELECT ${columns} FROM mcp_servers WHERE profile_id = ? ORDER BY id ASC
      `);
      this.getStatement = this.database.prepare(`
        SELECT ${columns} FROM mcp_servers WHERE profile_id = ? AND id = ?
      `);
      this.insertStatement = this.database.prepare(`
        INSERT INTO mcp_servers (profile_id, name, url, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (profile_id, url) DO NOTHING
        RETURNING ${columns}
      `);
      this.deleteStatement = this.database.prepare(`
        DELETE FROM mcp_servers WHERE profile_id = ? AND id = ?
      `);
    } catch (error) {
      releaseChatDatabase(databasePath);
      throw error;
    }
  }

  listServers(profileId: number): McpServerConfig[] {
    return (this.listStatement.all(profileId) as McpServerRow[]).map(toServer);
  }

  getServer(profileId: number, id: number): McpServerConfig | null {
    const row = this.getStatement.get(profileId, id) as McpServerRow | undefined;
    return row ? toServer(row) : null;
  }

  create(profileId: number, input: McpServerInput): McpServerConfig {
    const name = input.name.trim();
    if (name.length === 0 || name.length > MAX_SERVER_NAME_LENGTH) {
      throw new McpServerValidationError();
    }
    const url = parseMcpUrl(input.url).href;
    const row = this.insertStatement.get(
      profileId,
      name,
      url,
      new Date().toISOString(),
    ) as McpServerRow | undefined;
    if (!row) throw new DuplicateMcpServerError();
    return toServer(row);
  }

  delete(profileId: number, id: number): boolean {
    return this.deleteStatement.run(profileId, id).changes > 0;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    releaseChatDatabase(this.databasePath);
  }
}

const globalForMcpStore = globalThis as typeof globalThis & {
  mcpServerStore?: SqliteMcpServerStore;
};

export function getMcpServerStore(): SqliteMcpServerStore {
  globalForMcpStore.mcpServerStore ??= new SqliteMcpServerStore(
    join(process.cwd(), "data", "chat.sqlite"),
  );
  return globalForMcpStore.mcpServerStore;
}
