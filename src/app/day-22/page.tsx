import type { Metadata } from "next";
import { RagWorkspace } from "@/components/rag-workspace";
import { SiteHeader } from "@/components/site-header";
import { RAG_EMBEDDING_CONFIG } from "@/lib/rag-embedding-config";
import { SqliteDocumentStore } from "@/lib/document-store";
import { readRagBenchmark } from "@/lib/rag-benchmark";

export const metadata: Metadata = { title: "Flash Chat · Day 22", description: "Агент с RAG и без RAG: свои вопросы, источники и сравнение на десяти контрольных вопросах." };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Day22() {
  const store = new SqliteDocumentStore(RAG_EMBEDDING_CONFIG.databasePath, RAG_EMBEDDING_CONFIG);
  let index;
  try { index = store.latestReport(); } finally { store.close(); }
  const report = await readRagBenchmark();
  return (
    <div className="relative w-full flex-1">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[90vh] bg-[radial-gradient(75vw_65vh_at_70%_0%,rgba(77,107,254,0.16),transparent_72%)]" />
      <div className="w-full px-[clamp(0.75rem,1.5vw,1.5rem)] pb-8">
        <SiteHeader />
        <main className="space-y-5">
          <div className="rise-in flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0"><p className="inline-flex rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">AI Advent Challenge #9 · Day 22</p><h1 className="mt-2 text-[clamp(1.35rem,0.8vw+1rem,1.9rem)] font-bold leading-tight tracking-tight">Первый RAG-запрос</h1></div>
            <p className="max-w-[65ch] text-xs leading-relaxed text-muted sm:text-right">{index ? `Локальная база: ${index.corpus.files} файлов, ${index.comparison.find((item) => item.strategy === "structural")?.chunks ?? 0} структурных чанков. Вопрос, поиск, контекст, ответ с источниками.` : "Сравните ответы агента с базой документов и без неё."}</p>
          </div>
          <RagWorkspace initialReport={report} indexId={index?.id ?? null} model={process.env.OPENAI_MODEL ?? null} />
        </main>
      </div>
    </div>
  );
}
