import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { DEV_ASSISTANT_INDEX_CONFIG as CONFIG } from "../src/lib/dev-assistant-config";
import { indexDocuments } from "../src/lib/document-indexer";
import { SqliteDocumentStore } from "../src/lib/document-store";
import { createDocsSearch, projectDocumentSources } from "../src/lib/project-docs";
import { withProjectMcpTools } from "../src/lib/project-mcp-client";

let root: string;

// Детерминированный bag-of-words: одинаковые слова дают близкие векторы.
const embedder = {
  async embed(inputs: readonly string[]) {
    return {
      tokens: inputs.length,
      vectors: inputs.map((text) => {
        const vector = Array<number>(CONFIG.dimensions).fill(0);
        vector[0] = 0.01;
        for (const word of text.toLowerCase().match(/[\p{L}\d]+/gu) ?? []) {
          let hash = 0;
          for (const char of word) hash = (hash * 31 + char.codePointAt(0)!) % CONFIG.dimensions;
          vector[hash] += 1;
        }
        return vector;
      }),
    };
  },
};

before(async () => {
  root = mkdtempSync(join(tmpdir(), "project-mcp-"));
  execFileSync("git", ["-C", root, "init", "-q", "-b", "day-31"]);
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, "src/lib"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# Проект\n\n## Запуск\n\nКоманда npm run dev запускает сервер.\n");
  writeFileSync(join(root, "AGENTS.md"), "# Правила\n\nНе коммитить ключи.\n");
  writeFileSync(join(root, "docs/storage.md"), "# Хранение\n\n## SQLite\n\nИстория диалогов хранится в SQLite транзакцией.\n");
  writeFileSync(join(root, "src/lib/chat-schema.ts"), "export const SCHEMA = `CREATE TABLE messages (id INTEGER PRIMARY KEY)`;\n");
  writeFileSync(join(root, "src/lib/other.ts"), "export const unrelated = 1;\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "-m", "init"]);
});
after(() => rmSync(root, { recursive: true, force: true }));

test("the corpus contains README, AGENTS, docs and schema modules only", async () => {
  assert.deepEqual(await projectDocumentSources(root), ["AGENTS.md", "README.md", "docs/storage.md", "src/lib/chat-schema.ts"]);
});

test("stdio MCP server exposes read-only project tools and reports a missing docs index", async () => {
  await withProjectMcpTools(AbortSignal.timeout(60_000), async (session) => {
    assert.equal(session.server.name, "flash-project");
    assert.deepEqual(session.tools.map(({ name }) => name).sort(), ["git_branch", "git_diff", "git_status", "list_files", "search_docs"]);
    const branch = await session.callTool("git_branch", {});
    assert.equal(branch.isError, undefined);
    assert.equal((branch.structuredContent as { branch: string }).branch, "day-31");
    const listing = await session.callTool("list_files", { path: "docs" });
    assert.deepEqual((listing.structuredContent as { entries: unknown[] }).entries, [{ name: "storage.md", type: "file", files: 1 }]);
    const missing = await session.callTool("search_docs", { query: "Где хранится история?" });
    assert.equal(missing.isError, true);
    assert.match(JSON.stringify(missing.content), /npm run dev-assistant:index/);
    const invalid = await session.callTool("git_diff", { path: "../outside" });
    assert.equal(invalid.isError, true);
  }, root);
});

test("docs search numbers sources across calls and detects a stale index", async () => {
  const store = new SqliteDocumentStore(join(root, CONFIG.databasePath), CONFIG);
  try {
    await indexDocuments({
      root, store, client: embedder, config: CONFIG, sources: await projectDocumentSources(root),
      questions: [{ id: "storage", question: "Где хранится история диалогов?", source: "docs/storage.md", section: "SQLite", evidence: "транзакцией" }],
      countTokens: async (text) => Math.ceil(text.length / 4),
    });
  } finally { store.close(); }
  const search = createDocsSearch(root, embedder);
  const first = await search("история диалогов SQLite", 2);
  assert.equal(first.stale, false);
  assert.deepEqual(first.results.map(({ id }) => id), ["S1", "S2"]);
  assert.equal(first.results[0].source, "docs/storage.md");
  const second = await search("npm run dev", 1);
  assert.deepEqual(second.results.map(({ id, source }) => [id, source]), [["S3", "README.md"]]);
  writeFileSync(join(root, "docs/storage.md"), "# Хранение\n\nИзменённый документ.\n");
  assert.equal((await search("хранение", 1)).stale, true);
});
