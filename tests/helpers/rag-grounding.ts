import type { CompressionLlmResponder } from "../../src/lib/compression-llm";
import { refinementLlm, refinementQuestions, testUsage } from "./rag-refinement";

export function groundingQuestions() {
  return refinementQuestions().map((item, i) => i < 10 ? item : { ...item, question: `Вопрос вне корпуса ${i}?` });
}

export function groundingLlm(handler?: (prompt: string, payload: string) => string | undefined): CompressionLlmResponder {
  const stages = refinementLlm();
  return { model: stages.model, async respond(messages, signal, options) {
    signal.throwIfAborted();
    const prompt = options!.systemMessages!.join("\n");
    const payload = messages[0].content;
    let text = handler?.(prompt, payload);
    if (text === undefined && prompt.includes("GROUNDED_RAG_ANSWER")) {
      const source = JSON.parse(payload).context[0];
      text = JSON.stringify({ status: "answered", answer: "Оба сообщения сохраняются атомарно [S1].", clarification: null,
        sources: [{ id: source.id, source: source.source, section: source.section, chunkId: source.chunkId }],
        quotes: [source.quoteOptions ? { sourceId: source.id, quoteId: source.quoteOptions.find((option: { text: string }) => option.text.includes("Atomic transactions commit both messages.")).id } : { sourceId: source.id, text: "Atomic transactions commit both messages." }] });
    }
    if (text === undefined && prompt.includes("GROUNDING_JUDGE")) text = JSON.stringify({ supported: true, rationale: "Цитата подтверждает атомарное сохранение обоих сообщений.", unsupportedClaims: [] });
    if (text === undefined) return stages.respond(messages, signal, options);
    return { stream: new Response(text).body!, usage: Promise.resolve(testUsage), finishReason: Promise.resolve("stop") };
  } };
}
