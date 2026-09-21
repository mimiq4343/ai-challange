import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";

import type {
  Invariant,
  InvariantCategory,
  InvariantEvent,
  InvariantEventKind,
  InvariantInput,
  InvariantOrigin,
  InvariantProposal,
  InvariantSnapshot,
  InvariantStatus,
} from "./invariant-types";
import { ensureMemorySchema } from "./memory-schema";
import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";

const EVENT_LOG_LIMIT = 40;

type InvariantRow = {
  id: number;
  profile_id: number;
  category: InvariantCategory;
  statement: string;
  rationale: string | null;
  status: InvariantStatus;
  blocked_count: number;
  origin: InvariantOrigin;
  created_at: string;
  updated_at: string;
};

type ProposalRow = {
  id: number;
  profile_id: number;
  category: InvariantCategory;
  statement: string;
  rationale: string | null;
  conversation_id: string | null;
  created_at: string;
};

type EventRow = {
  id: number;
  profile_id: number;
  invariant_id: number | null;
  kind: InvariantEventKind;
  origin: InvariantOrigin;
  statement: string | null;
  detail: string | null;
  conversation_id: string | null;
  created_at: string;
};

export class InvariantNotFoundError extends Error {
  constructor(readonly invariantId: number) {
    super(`Инвариант ${invariantId} не найден.`);
    this.name = "InvariantNotFoundError";
  }
}

export class DuplicateInvariantError extends Error {
  constructor() {
    super("Такой инвариант уже есть.");
    this.name = "DuplicateInvariantError";
  }
}

function toInvariant(row: InvariantRow): Invariant {
  return {
    id: row.id,
    profileId: row.profile_id,
    category: row.category,
    statement: row.statement,
    rationale: row.rationale,
    status: row.status,
    blockedCount: row.blocked_count,
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toProposal(row: ProposalRow): InvariantProposal {
  return {
    id: row.id,
    profileId: row.profile_id,
    category: row.category,
    statement: row.statement,
    rationale: row.rationale,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
  };
}

export class SqliteInvariantStore {
  private readonly database: DatabaseSync;
  private readonly databasePath: string;
  private readonly listStatement: StatementSync;
  private readonly listActiveStatement: StatementSync;
  private readonly getStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly updateStatement: StatementSync;
  private readonly setStatusStatement: StatementSync;
  private readonly incrementBlockedStatement: StatementSync;
  private readonly listProposalsStatement: StatementSync;
  private readonly getProposalStatement: StatementSync;
  private readonly insertProposalStatement: StatementSync;
  private readonly deleteProposalStatement: StatementSync;
  private readonly insertEventStatement: StatementSync;
  private readonly listEventsStatement: StatementSync;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.database = openChatDatabase(databasePath);
    ensureMemorySchema(this.database);

    const columns = `id, profile_id, category, statement, rationale, status,
                     blocked_count, origin, created_at, updated_at`;
    this.listStatement = this.database.prepare(`
      SELECT ${columns} FROM memory_invariants
      WHERE profile_id = ?
      ORDER BY status ASC, category ASC, id ASC
    `);
    this.listActiveStatement = this.database.prepare(`
      SELECT ${columns} FROM memory_invariants
      WHERE profile_id = ? AND status = 'active'
      ORDER BY category ASC, id ASC
    `);
    this.getStatement = this.database.prepare(`
      SELECT ${columns} FROM memory_invariants WHERE id = ?
    `);
    this.insertStatement = this.database.prepare(`
      INSERT INTO memory_invariants (
        profile_id, category, statement, rationale, status, blocked_count, origin,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', 0, ?, ?, ?)
      ON CONFLICT (profile_id, statement) DO NOTHING
      RETURNING ${columns}
    `);
    this.updateStatement = this.database.prepare(`
      UPDATE memory_invariants
      SET category = ?, statement = ?, rationale = ?, updated_at = ?
      WHERE id = ?
      RETURNING ${columns}
    `);
    this.setStatusStatement = this.database.prepare(`
      UPDATE memory_invariants SET status = ?, updated_at = ? WHERE id = ?
      RETURNING ${columns}
    `);
    this.incrementBlockedStatement = this.database.prepare(`
      UPDATE memory_invariants
      SET blocked_count = blocked_count + 1, updated_at = ?
      WHERE id = ?
    `);
    this.listProposalsStatement = this.database.prepare(`
      SELECT id, profile_id, category, statement, rationale, conversation_id, created_at
      FROM memory_invariant_proposals
      WHERE profile_id = ?
      ORDER BY id ASC
    `);
    this.getProposalStatement = this.database.prepare(`
      SELECT id, profile_id, category, statement, rationale, conversation_id, created_at
      FROM memory_invariant_proposals WHERE id = ?
    `);
    this.insertProposalStatement = this.database.prepare(`
      INSERT INTO memory_invariant_proposals (
        profile_id, category, statement, rationale, conversation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (profile_id, statement) DO NOTHING
    `);
    this.deleteProposalStatement = this.database.prepare(`
      DELETE FROM memory_invariant_proposals WHERE id = ?
    `);
    this.insertEventStatement = this.database.prepare(`
      INSERT INTO memory_invariant_events (
        profile_id, invariant_id, kind, origin, statement, detail, conversation_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.listEventsStatement = this.database.prepare(`
      SELECT id, profile_id, invariant_id, kind, origin, statement, detail,
             conversation_id, created_at
      FROM memory_invariant_events
      WHERE profile_id = ?
      ORDER BY id DESC
      LIMIT ?
    `);
  }

  listInvariants(profileId: number): Invariant[] {
    return (this.listStatement.all(profileId) as InvariantRow[]).map(toInvariant);
  }

  listActive(profileId: number): Invariant[] {
    return (this.listActiveStatement.all(profileId) as InvariantRow[]).map(toInvariant);
  }

  getInvariant(id: number): Invariant | null {
    const row = this.getStatement.get(id) as InvariantRow | undefined;
    return row ? toInvariant(row) : null;
  }

  listProposals(profileId: number): InvariantProposal[] {
    return (this.listProposalsStatement.all(profileId) as ProposalRow[]).map(toProposal);
  }

  listEvents(profileId: number, limit: number = EVENT_LOG_LIMIT): InvariantEvent[] {
    return (this.listEventsStatement.all(profileId, limit) as EventRow[]).map((row) => ({
      id: row.id,
      profileId: row.profile_id,
      invariantId: row.invariant_id,
      kind: row.kind,
      origin: row.origin,
      statement: row.statement,
      detail: row.detail,
      conversationId: row.conversation_id,
      createdAt: row.created_at,
    }));
  }

  getSnapshot(profileId: number): InvariantSnapshot {
    return {
      invariants: this.listInvariants(profileId),
      proposals: this.listProposals(profileId),
      events: this.listEvents(profileId),
    };
  }

  private recordEvent(input: {
    profileId: number;
    invariantId: number | null;
    kind: InvariantEventKind;
    origin: InvariantOrigin;
    statement: string | null;
    detail: string | null;
    conversationId: string | null;
  }): void {
    this.insertEventStatement.run(
      input.profileId,
      input.invariantId,
      input.kind,
      input.origin,
      input.statement,
      input.detail,
      input.conversationId,
      new Date().toISOString(),
    );
  }

  create(
    profileId: number,
    input: InvariantInput,
    origin: InvariantOrigin,
    conversationId: string | null = null,
  ): Invariant {
    const timestamp = new Date().toISOString();
    const row = this.insertStatement.get(
      profileId,
      input.category,
      input.statement,
      input.rationale,
      origin,
      timestamp,
      timestamp,
    ) as InvariantRow | undefined;
    if (!row) throw new DuplicateInvariantError();

    this.recordEvent({
      profileId,
      invariantId: row.id,
      kind: "created",
      origin,
      statement: input.statement,
      detail: input.rationale,
      conversationId,
    });
    return toInvariant(row);
  }

  update(id: number, input: InvariantInput): Invariant {
    const existing = this.getInvariant(id);
    if (!existing) throw new InvariantNotFoundError(id);

    const row = this.updateStatement.get(
      input.category,
      input.statement,
      input.rationale,
      new Date().toISOString(),
      id,
    ) as InvariantRow;
    this.recordEvent({
      profileId: existing.profileId,
      invariantId: id,
      kind: "updated",
      origin: "user",
      statement: input.statement,
      detail: `было: ${existing.statement}`,
      conversationId: null,
    });
    return toInvariant(row);
  }

  /** Снимает или восстанавливает правило, сохраняя его в истории. */
  setStatus(id: number, status: InvariantStatus): Invariant {
    const existing = this.getInvariant(id);
    if (!existing) throw new InvariantNotFoundError(id);

    const row = this.setStatusStatement.get(
      status,
      new Date().toISOString(),
      id,
    ) as InvariantRow;
    this.recordEvent({
      profileId: existing.profileId,
      invariantId: id,
      kind: status === "retired" ? "retired" : "restored",
      origin: "user",
      statement: existing.statement,
      detail: null,
      conversationId: null,
    });
    return toInvariant(row);
  }

  /**
   * Сохраняет предложения агента. Дубликаты действующих правил и уже
   * предложенных формулировок отбрасываются.
   */
  saveProposals(
    profileId: number,
    proposals: readonly InvariantInput[],
    conversationId: string | null,
  ): number {
    if (proposals.length === 0) return 0;

    const known = new Set(
      this.listInvariants(profileId).map((invariant) => invariant.statement),
    );
    const timestamp = new Date().toISOString();
    let saved = 0;
    for (const proposal of proposals) {
      if (known.has(proposal.statement)) continue;
      const result = this.insertProposalStatement.run(
        profileId,
        proposal.category,
        proposal.statement,
        proposal.rationale,
        conversationId,
        timestamp,
      );
      if (result.changes > 0) saved += 1;
    }

    return saved;
  }

  acceptProposal(proposalId: number): Invariant {
    const row = this.getProposalStatement.get(proposalId) as ProposalRow | undefined;
    if (!row) throw new InvariantNotFoundError(proposalId);

    const proposal = toProposal(row);
    const invariant = this.create(
      proposal.profileId,
      {
        category: proposal.category,
        statement: proposal.statement,
        rationale: proposal.rationale,
      },
      "agent",
      proposal.conversationId,
    );
    this.deleteProposalStatement.run(proposalId);
    this.recordEvent({
      profileId: proposal.profileId,
      invariantId: invariant.id,
      kind: "proposal_accepted",
      origin: "user",
      statement: proposal.statement,
      detail: null,
      conversationId: proposal.conversationId,
    });
    return invariant;
  }

  discardProposal(proposalId: number): boolean {
    const row = this.getProposalStatement.get(proposalId) as ProposalRow | undefined;
    if (!row) return false;

    this.deleteProposalStatement.run(proposalId);
    this.recordEvent({
      profileId: row.profile_id,
      invariantId: null,
      kind: "proposal_rejected",
      origin: "user",
      statement: row.statement,
      detail: null,
      conversationId: row.conversation_id,
    });
    return true;
  }

  /** Фиксирует заблокированный запрос и поднимает счётчик у сработавших правил. */
  recordViolation(input: {
    profileId: number;
    invariantIds: readonly number[];
    request: string;
    explanation: string;
    conversationId: string | null;
  }): void {
    const timestamp = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const invariantId of input.invariantIds) {
        this.incrementBlockedStatement.run(timestamp, invariantId);
        this.recordEvent({
          profileId: input.profileId,
          invariantId,
          kind: "violation_blocked",
          origin: "agent",
          statement: input.request,
          detail: input.explanation,
          conversationId: input.conversationId,
        });
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    releaseChatDatabase(this.databasePath);
  }
}

const globalForInvariantStore = globalThis as typeof globalThis & {
  invariantStore?: SqliteInvariantStore;
};

export function getInvariantStore(): SqliteInvariantStore {
  globalForInvariantStore.invariantStore ??= new SqliteInvariantStore(
    join(process.cwd(), "data", "chat.sqlite"),
  );
  return globalForInvariantStore.invariantStore;
}
