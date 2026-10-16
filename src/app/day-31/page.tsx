import type { Metadata } from "next";
import { resolve } from "node:path";
import { DevAssistantWorkspace, type DocsIndexSummary } from "@/components/dev-assistant-workspace";
import { SiteHeader } from "@/components/site-header";
import { DEV_ASSISTANT_INDEX_CONFIG as CONFIG } from "@/lib/dev-assistant-config";
import { loadDocumentCorpus } from "@/lib/document-corpus";
import { SqliteDocumentStore } from "@/lib/document-store";
import { projectDocumentSources } from "@/lib/project-docs";

export const metadata: Metadata = { title: "Flash Chat · Day 31", description: "Ассистент разработчика: /help по документации проекта и git-контексту через MCP." };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readIndexSummary(): Promise<DocsIndexSummary> {
  const store = new SqliteDocumentStore(CONFIG.databasePath, CONFIG);
  let report;
  try { report = store.latestReport(); } finally { store.close(); }
  if (!report) return null;
  const root = resolve(".");
  const current = await loadDocumentCorpus(root, await projectDocumentSources(root));
  const structural = report.comparison.find((item) => item.strategy === CONFIG.strategy);
  return {
    files: report.corpus.files,
    chunks: structural?.chunks ?? 0,
    hitRate: structural?.hitRateAt5 ?? 0,
    // Явный часовой пояс: строка формируется на сервере и не зависит от браузера.
    createdAt: `${new Date(report.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg", dateStyle: "short", timeStyle: "short" })} (Екатеринбург)`,
    stale: current.hash !== report.corpus.hash,
  };
}

export default async function Day31() {
  const index = await readIndexSummary();
  return (
    <div className="relative w-full flex-1">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[90vh] bg-[radial-gradient(75vw_65vh_at_70%_0%,rgba(77,107,254,0.16),transparent_72%)]" />
      <div className="w-full px-[clamp(0.75rem,1.5vw,1.5rem)] pb-8">
        <SiteHeader />
        <main className="space-y-5">
          <div className="rise-in flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0"><p className="inline-flex rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">AI Advent Challenge #9 · Day 31</p><h1 className="mt-2 text-[clamp(1.35rem,0.8vw+1rem,1.9rem)] font-bold leading-tight tracking-tight">Ассистент разработчика</h1></div>
            <p className="max-w-[65ch] text-xs leading-relaxed text-muted sm:text-right">RAG по README, docs и схемам данных плюс git-контекст через MCP. Модель сама решает, какие инструменты вызвать.</p>
          </div>
          <DevAssistantWorkspace model={process.env.OPENAI_MODEL ?? null} index={index} />
        </main>
      </div>
    </div>
  );
}
