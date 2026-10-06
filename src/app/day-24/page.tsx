import { RagGroundingWorkspace } from "@/components/rag-grounding-workspace";
import { SiteHeader } from "@/components/site-header";
import { SqliteDocumentStore } from "@/lib/document-store";
import { RAG_EMBEDDING_CONFIG } from "@/lib/rag-embedding-config";
import { readGroundingBenchmark } from "@/lib/rag-grounding-benchmark";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Day24Page() {
  const store = new SqliteDocumentStore(RAG_EMBEDDING_CONFIG.databasePath, RAG_EMBEDDING_CONFIG);
  let index;
  try { index = store.latestReport(); } finally { store.close(); }
  const report = await readGroundingBenchmark();
  return <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(99,102,241,0.12),transparent_65%),radial-gradient(ellipse_at_90%_80%,rgba(139,92,246,0.08),transparent_72%)]" />
    <div className="relative w-full px-[clamp(0.75rem,1.5vw,1.5rem)] pb-8"><SiteHeader /><main className="space-y-5">
      <div className="rise-in flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div className="min-w-0"><p className="inline-flex rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">AI Advent Challenge #9 · Day 24</p><h1 className="mt-2 text-[clamp(1.35rem,0.8vw+1rem,1.9rem)] font-bold leading-tight tracking-tight">Цитаты и источники</h1></div><p className="max-w-[65ch] text-xs leading-relaxed text-muted sm:text-right">Ответ по найденным фрагментам, проверенные цитаты и честное «Не знаю», когда подтверждений недостаточно.</p></div>
      <RagGroundingWorkspace initialReport={report} indexId={index?.id ?? null} model={process.env.OPENAI_MODEL ?? null} />
    </main></div>
  </div>;
}
