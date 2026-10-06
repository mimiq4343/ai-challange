import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { LocalDocumentEmbeddingClient } from "../src/lib/local-document-embeddings";
import { RAG_EMBEDDING_CONFIG } from "../src/lib/rag-embedding-config";

test("local embedding validation and cancellation fail before loading a model", async () => {
  const client = new LocalDocumentEmbeddingClient("/missing-model");
  for (const inputs of [[], [" "], Array<string>(9).fill("text")]) await assert.rejects(client.embed(inputs, "search_query"), /пакета/);
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(client.embed(["question"], "search_query", controller.signal), /cancelled/);
});

test("the installed E5 model produces normalized multilingual retrieval vectors offline", {
  skip: !existsSync(resolve(RAG_EMBEDDING_CONFIG.modelPath, "onnx/model_quantized.onnx")) && "Run npm run rag:index to install the pinned local model",
}, async () => {
  const client = new LocalDocumentEmbeddingClient();
  const passages = await client.embed(["SQLite closes the connection after the last reference is released.", "The weather is sunny and warm."], "search_document");
  const query = await client.embed(["Когда SQLite закрывает соединение?"], "search_query");
  const vector = query.vectors[0];
  assert.equal(vector.length, 384);
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 0.001);
  const similarity = (passage: number[]) => passage.reduce((sum, value, i) => sum + value * vector[i], 0);
  assert.ok(similarity(passages.vectors[0]) > similarity(passages.vectors[1]));
  assert.ok(query.tokens > 0);
  await assert.rejects(client.embed(["SQLite ".repeat(600)], "search_document"), /превышает контекст/);
  const longQuery = await client.embed(["SQLite ".repeat(600)], "search_query");
  assert.equal(longQuery.tokens, RAG_EMBEDDING_CONFIG.contextTokens);
});
