import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatMessage } from "../../src/lib/chat-agent";
import type { CompressionLlmResponder } from "../../src/lib/compression-llm";
import type { ChatRequestOptions } from "../../src/lib/conversation-types";
import { indexDocuments } from "../../src/lib/document-indexer";
import { SqliteDocumentStore } from "../../src/lib/document-store";
import { RAG_EMBEDDING_CONFIG } from "../../src/lib/rag-embedding-config";
import type { RefinementQuestion } from "../../src/lib/rag-refinement-types";

export const testUsage = { promptTokens: 40, completionTokens: 10, totalTokens: 50, cacheHitTokens: null, cacheMissTokens: null };
export const testSettings = { candidateK: 3, contextK: 1, minRelevance: 6 };
const vector = (first: number, second: number) => [first, second, ...Array<number>(382).fill(0)];
export const testEmbedder = { async embed(inputs: readonly string[]) { return { vectors: inputs.map(() => vector(1, 0)), tokens: 5 }; } };

export async function refinementIndex(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "flash-refinement-"));
  const store = new SqliteDocumentStore(join(root, "index.sqlite"), RAG_EMBEDDING_CONFIG);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, "guide.md"), "# Transactions\nAtomic transactions commit both messages.\n# Cascade\nForeign keys delete child rows.\n");
  await writeFile(join(root, "noise.md"), "# Noise\nGardening advice unrelated to conversations.\n");
  await indexDocuments({ root, store, config: RAG_EMBEDDING_CONFIG, countTokens: async (text) => text.length,
    sources: ["guide.md", "noise.md"], questions: [{ id: "atomic", question: "Как сохранять?", source: "guide.md", section: "Transactions", evidence: "Atomic" }],
    client: { async embed(inputs) { return { vectors: inputs.map((text) => text.includes("Gardening") ? vector(1, 0) : text.includes("Atomic") ? vector(0.8, 0.6) : vector(0.6, 0.8)), tokens: 5 }; } },
  });
  return store.readIndexVectors("structural");
}

export function refinementQuestions(): RefinementQuestion[] {
  return Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, question: `Как сохранять ${i}?`, expectedFacts: ["Judge-only expectation"],
    source: i < 10 ? "guide.md" : null, section: i < 10 ? "Transactions" : null, evidence: i < 10 ? "Atomic" : null }));
}

export function refinementLlm(handler?: (prompt: string, payload: string, messages: readonly ChatMessage[], options?: ChatRequestOptions) => string | undefined,
  finish = "stop"): CompressionLlmResponder {
  return { model: "deepseek-v4-flash", async respond(messages, signal, options) {
    signal.throwIfAborted();
    const prompt = options!.systemMessages!.join("\n");
    const payload = messages[0].content;
    let text = handler?.(prompt, payload, messages, options);
    if (text === undefined && prompt.includes("QUERY_REWRITE")) text = JSON.stringify({ query: "Atomic transactions commit conversation messages" });
    else if (text === undefined && prompt.includes("RELEVANCE_RERANK")) {
      const input = JSON.parse(payload);
      text = JSON.stringify({ results: input.candidates.map((item: { id: string; text: string }) => ({ id: item.id,
        score: item.text.includes("Atomic") ? 10 : item.text.includes("Gardening") ? 0 : 4, reason: item.text.includes("Atomic") ? "Описывает сохранение сообщений." : "Не отвечает на вопрос." })) });
    } else if (text === undefined && prompt.includes("BLIND_REFINEMENT_JUDGE")) {
      const score = { factualAccuracy: 8, completeness: 8, instructionFollowing: 8, overall: 8 };
      text = JSON.stringify({ a: score, b: score, c: score, winner: "tie", rationale: "Оценки по эталону." });
    } else if (text === undefined) text = payload.includes("Atomic") ? "Atomic transactions [S1]." : "В найденных источниках нет ответа.";
    return { stream: new Response(text).body!, usage: Promise.resolve(testUsage), finishReason: Promise.resolve(finish) };
  } };
}
