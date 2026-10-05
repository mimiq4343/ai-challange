import type { DatabaseSync } from "node:sqlite";
import { DOCUMENT_INDEX_CONFIG } from "./document-config";
import { validateEmbedding } from "./document-embeddings";
import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";
import type { ChunkStrategy, DocumentChunk, DocumentIndexReport, EmbeddedChunk } from "./document-types";

type ChunkRow = {
  chunk_id: string; strategy: ChunkStrategy; source: string; title: string; section: string; text: string;
  source_hash: string; content_hash: string; start_offset: number; end_offset: number;
  start_line: number; end_line: number; token_count: number; boundary_crossings: number;
  embedding: Uint8Array; dimensions: number;
};

type ChunkPageOptions = { source: string | null; offset: number; limit: number };
type ChunkPage = { total: number; chunks: DocumentChunk[] };

function chunkFromRow(row: ChunkRow): DocumentChunk {
  return {
    chunkId: row.chunk_id, strategy: row.strategy, source: row.source, title: row.title, section: row.section,
    text: row.text, sourceHash: row.source_hash, contentHash: row.content_hash,
    start: row.start_offset, end: row.end_offset, startLine: row.start_line, endLine: row.end_line,
    tokenCount: row.token_count, boundaryCrossings: row.boundary_crossings,
  };
}

function assertStrategy(strategy: string): asserts strategy is ChunkStrategy {
  if (strategy !== "fixed" && strategy !== "structural") throw new Error("Неизвестная стратегия индекса.");
}

export class SqliteDocumentStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(private readonly databasePath: string, private readonly embeddingProfile: { model: string; dimensions: number } = DOCUMENT_INDEX_CONFIG) {
    this.database = openChatDatabase(databasePath);
    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS document_index (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          report_json TEXT NOT NULL CHECK (json_valid(report_json))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS document_chunks (
          chunk_id TEXT PRIMARY KEY,
          index_id INTEGER NOT NULL REFERENCES document_index(singleton) ON DELETE CASCADE,
          strategy TEXT NOT NULL CHECK (strategy IN ('fixed', 'structural')),
          source TEXT NOT NULL, title TEXT NOT NULL, section TEXT NOT NULL, text TEXT NOT NULL,
          source_hash TEXT NOT NULL, content_hash TEXT NOT NULL,
          start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
          end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
          start_line INTEGER NOT NULL CHECK (start_line > 0),
          end_line INTEGER NOT NULL CHECK (end_line >= start_line),
          token_count INTEGER NOT NULL CHECK (token_count >= 0),
          boundary_crossings INTEGER NOT NULL CHECK (boundary_crossings >= 0),
          dimensions INTEGER NOT NULL CHECK (dimensions > 0),
          embedding BLOB NOT NULL CHECK (length(embedding) = dimensions * 4)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS document_chunks_strategy_source ON document_chunks(strategy, source, start_offset);
      `);
    } catch (cause) {
      releaseChatDatabase(databasePath);
      throw cause;
    }
  }

  replaceIndex(report: DocumentIndexReport, chunks: readonly EmbeddedChunk[]): void {
    if (!report.id || report.model !== this.embeddingProfile.model || report.dimensions !== this.embeddingProfile.dimensions || !chunks.length) {
      throw new Error("Нельзя сохранить неполный индекс документов.");
    }
    for (const strategy of ["fixed", "structural"] as const) {
      const comparison = report.comparison.find((item) => item.strategy === strategy);
      const count = chunks.filter((chunk) => chunk.strategy === strategy).length;
      if (!comparison || !count || comparison.chunks !== count) throw new Error("Индекс и сравнение должны содержать обе полные стратегии.");
    }
    for (const chunk of chunks) validateEmbedding(chunk.embedding, report.dimensions);
    const insert = this.database.prepare(`INSERT INTO document_chunks (
      chunk_id, index_id, strategy, source, title, section, text, source_hash, content_hash,
      start_offset, end_offset, start_line, end_line, token_count, boundary_crossings, dimensions, embedding
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("DELETE FROM document_index").run();
      this.database.prepare("INSERT INTO document_index (singleton, report_json) VALUES (1, ?)").run(JSON.stringify(report));
      for (const chunk of chunks) {
        const bytes = Buffer.alloc(report.dimensions * 4);
        chunk.embedding.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
        insert.run(chunk.chunkId, chunk.strategy, chunk.source, chunk.title, chunk.section, chunk.text, chunk.sourceHash, chunk.contentHash,
          chunk.start, chunk.end, chunk.startLine, chunk.endLine, chunk.tokenCount, chunk.boundaryCrossings, report.dimensions, bytes);
      }
      this.database.exec("COMMIT");
    } catch (cause) {
      this.database.exec("ROLLBACK");
      throw cause;
    }
  }

  latestReport(): DocumentIndexReport | null {
    const row = this.database.prepare("SELECT report_json FROM document_index WHERE singleton = 1").get() as { report_json: string } | undefined;
    return row ? JSON.parse(row.report_json) as DocumentIndexReport : null;
  }

  listSources(): string[] {
    return (this.database.prepare("SELECT DISTINCT source FROM document_chunks ORDER BY source").all() as { source: string }[]).map((row) => row.source);
  }

  private readSnapshot<T>(read: () => T): T {
    this.database.exec("BEGIN");
    try {
      const result = read();
      this.database.exec("COMMIT");
      return result;
    } catch (cause) {
      this.database.exec("ROLLBACK");
      throw cause;
    }
  }

  readIndexPage(strategy: ChunkStrategy, options: ChunkPageOptions): { report: DocumentIndexReport | null; sources: string[]; page: ChunkPage } {
    return this.readSnapshot(() => ({ report: this.latestReport(), sources: this.listSources(), page: this.selectChunks(strategy, options) }));
  }

  listChunks(strategy: ChunkStrategy, options: ChunkPageOptions): ChunkPage {
    return this.readSnapshot(() => this.selectChunks(strategy, options));
  }

  private selectChunks(strategy: ChunkStrategy, options: ChunkPageOptions): ChunkPage {
    assertStrategy(strategy);
    const { source, offset, limit } = options;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Недопустимая страница чанков.");
    const where = "strategy = ? AND (? IS NULL OR source = ?)";
    const count = this.database.prepare(`SELECT count(*) AS total FROM document_chunks WHERE ${where}`).get(strategy, source, source) as { total: number };
    const rows = this.database.prepare(`SELECT chunk_id, strategy, source, title, section, text, source_hash, content_hash,
      start_offset, end_offset, start_line, end_line, token_count, boundary_crossings
      FROM document_chunks WHERE ${where} ORDER BY source, start_offset LIMIT ? OFFSET ?`).all(strategy, source, source, limit, offset) as ChunkRow[];
    return { total: count.total, chunks: rows.map(chunkFromRow) };
  }

  readVectors(strategy: ChunkStrategy): EmbeddedChunk[] {
    assertStrategy(strategy);
    const rows = this.database.prepare("SELECT * FROM document_chunks WHERE strategy = ? ORDER BY source, start_offset").all(strategy) as ChunkRow[];
    return rows.map((row) => {
      const bytes = Buffer.from(row.embedding);
      if (bytes.length !== row.dimensions * 4) throw new Error("Повреждён вектор локального индекса.");
      const embedding = Array.from({ length: row.dimensions }, (_, index) => bytes.readFloatLE(index * 4));
      validateEmbedding(embedding, row.dimensions);
      return { ...chunkFromRow(row), embedding };
    });
  }

  readIndexVectors(strategy: ChunkStrategy): { report: DocumentIndexReport | null; chunks: EmbeddedChunk[] } {
    return this.readSnapshot(() => ({ report: this.latestReport(), chunks: this.readVectors(strategy) }));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    releaseChatDatabase(this.databasePath);
  }
}
