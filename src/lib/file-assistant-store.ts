import { randomUUID } from "node:crypto";
import { safeFilePath } from "./file-assistant-io";
import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";
import { FILE_ASSISTANT_CONFIG as CONFIG } from "./file-assistant-config";
import { FileAssistantError, fileProposalSchema, type FileProposal } from "./file-assistant-types";

export type StoredFileProposal = FileProposal & { content: string; root: string; branch: string; head: string };

export class FileProposalStore {
  private readonly path;
  readonly database;
  constructor(root: string) {
    this.path = safeFilePath(root, CONFIG.databasePath, true);
    this.database = openChatDatabase(this.path);
    this.database.exec(`CREATE TABLE IF NOT EXISTS file_proposals (
      id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload))
    ) STRICT;`);
  }
  save(input: Omit<StoredFileProposal, "id" | "status" | "createdAt" | "expiresAt">): FileProposal {
    const now = Date.now();
    const proposal: StoredFileProposal = { ...input, id: randomUUID(), status: "pending", createdAt: new Date(now).toISOString(), expiresAt: new Date(now + CONFIG.proposalLifetimeMs).toISOString() };
    this.database.prepare("INSERT INTO file_proposals(id, payload) VALUES (?, ?)").run(proposal.id, JSON.stringify(proposal));
    return fileProposalSchema.parse(proposal);
  }
  read(id: string): StoredFileProposal {
    const row = this.database.prepare("SELECT payload FROM file_proposals WHERE id = ?").get(id);
    if (!row) throw new FileAssistantError("Предложение не найдено.", 404);
    return JSON.parse(String(row.payload)) as StoredFileProposal;
  }
  markApplied(proposal: StoredFileProposal): FileProposal {
    const applied = { ...proposal, status: "applied" as const };
    this.database.prepare("UPDATE file_proposals SET payload = ? WHERE id = ?").run(JSON.stringify(applied), proposal.id);
    return fileProposalSchema.parse(applied);
  }
  close(): void { releaseChatDatabase(this.path); }
}
