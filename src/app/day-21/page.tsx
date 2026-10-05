import type { Metadata } from "next";
import { DocumentIndexPanel } from "@/components/document-index-panel";
import { SiteHeader } from "@/components/site-header";
import { DOCUMENT_INDEX_CONFIG } from "@/lib/document-config";
import { SqliteDocumentStore } from "@/lib/document-store";

export const metadata: Metadata = { title: "Flash Chat · Day 21", description: "Локальный индекс документов с эмбеддингами и сравнение двух стратегий чанкинга." };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LABELS = { fixed: "Фиксированный размер", structural: "По структуре" };
const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
const percent = (value: number) => `${number(value * 100)}%`;
const cardStyle = "min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-6";

export default function Day21() {
  const store = new SqliteDocumentStore(DOCUMENT_INDEX_CONFIG.databasePath);
  try {
    const { report, sources, page: initialPage } = store.readIndexPage("fixed", { source: null, offset: 0, limit: DOCUMENT_INDEX_CONFIG.chunkPageSize });
    return (
      <div className="relative w-full flex-1">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[90vh] bg-[radial-gradient(75vw_65vh_at_70%_0%,rgba(77,107,254,0.16),transparent_72%)]" />
        <div className="w-full px-[clamp(0.75rem,2vw,2rem)] pb-10">
          <SiteHeader />
          <main className="min-w-0 space-y-5">
            <div className="rise-in">
              <p className="inline-flex rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">AI Advent Challenge #9 · Day 21</p>
              <h1 className="mt-3 text-[clamp(1.5rem,2vw,2.4rem)] font-bold tracking-tight">Индексация документов</h1>
              <p className="mt-2 max-w-[80ch] text-sm leading-relaxed text-muted">README и исходный код проекта: два способа разбиения, настоящие эмбеддинги и локальный индекс SQLite. Один корпус, одна модель, одинаковые контрольные вопросы.</p>
            </div>
            {!report ? <section className={cardStyle}>
              <h2 className="font-semibold">Индекс ещё не создан</h2>
              <p className="mt-2 text-sm text-muted">Добавьте ключ OpenRouter в серверный <code>.env.local</code> как <code>OPENROUTER_API_KEY</code>, затем выполните:</p>
              <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-background p-4 font-mono text-sm">npm run documents:index</pre>
              <p className="mt-2 text-sm text-muted">После завершения обновите страницу. Предыдущий готовый индекс сохраняется, если новый запуск завершается ошибкой.</p>
            </section> : <>
              <section className={cardStyle} aria-labelledby="corpus-heading">
                <h2 id="corpus-heading" className="text-lg font-semibold">Локальный индекс готов</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[["Документов", number(report.corpus.files)], ["Символов", number(report.corpus.characters)], ["Условных страниц", `~${report.corpus.estimatedPages}`], ["Измерений вектора", number(report.dimensions)]].map(([label, value]) => <div key={label}><p className="text-xs text-muted">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}
                </div>
                <p className="mt-4 break-words text-xs leading-relaxed text-muted">Модель: <span className="text-foreground">{report.model}</span>. OpenRouter подтвердил стоимость 0 для всех запросов. Страница здесь — {number(report.corpus.charactersPerPage)} символов текста.</p>
                <p className="mt-2 break-words text-xs leading-relaxed text-muted">Сохранён {new Date(report.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg" })} (Екатеринбург). {number(report.providerRequests)} запросов, {number(report.providerTokens)} токенов по данным провайдера.</p>
                <p className="mt-2 break-all font-mono text-xs text-muted">data/documents.sqlite · SHA-256 корпуса: {report.corpus.hash}</p>
              </section>
              <section aria-labelledby="comparison-heading" className="space-y-3">
                <h2 id="comparison-heading" className="text-lg font-semibold">Сравнение стратегий</h2>
                <p className="max-w-[100ch] text-sm leading-relaxed text-muted">Размер ограничен {report.chunking.maxTokens} токенами. Перекрытие до {report.chunking.overlapTokens} токенов; у структурных чанков — только внутри длинного раздела. Структура определяется заголовками Markdown и объявлениями TypeScript, включая методы классов.</p>
                <div className="grid gap-4 md:grid-cols-2">
                  {report.comparison.map((item) => <article key={item.strategy} className={cardStyle}>
                    <h3 className="font-semibold text-accent">{LABELS[item.strategy]}</h3>
                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      {[["Чанков", number(item.chunks)], ["Токены: min / среднее / max", `${item.tokens.min} / ${number(item.tokens.mean)} / ${item.tokens.max}`], ["Токенов с перекрытием", number(item.tokens.total)], ["Пересекают границы разделов", `${item.boundaryCrossingChunks} (${percent(item.boundaryCrossingChunks / item.chunks)})`], ["Время эмбеддингов", `${number(item.embeddingMs / 1000)} с`], ["Векторы Float32", `${number(item.vectorBytes / 1024 / 1024)} МиБ`], ["HitRate@5", percent(item.hitRateAt5)], ["MRR@5", item.mrrAt5.toFixed(3)]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
                    </dl>
                  </article>)}
                </div>
                <p className="text-xs leading-relaxed text-muted">HitRate@5 — доля вопросов с нужным фрагментом среди пяти первых результатов; MRR@5 — среднее обратное место первого подходящего чанка, 0 при промахе. Релевантность требует совпадения файла и контрольной цитаты. Время включает сеть, вычисление эмбеддингов и ожидание лимита запросов; стратегии выполняются отдельно, без кеша.</p>
              </section>
              <section className={cardStyle} aria-labelledby="retrieval-heading">
                <h2 id="retrieval-heading" className="text-lg font-semibold">Контрольные вопросы и top-5</h2>
                <p className="mt-2 text-sm text-muted">Поиск по косинусному сходству сохранённых Float32-векторов. Этот небольшой набор проверяет корпус проекта и не даёт универсальной оценки модели.</p>
                <div className="mt-4 space-y-2">
                  {report.comparison[0].retrieval.map((question, index) => <details key={question.questionId} className="rounded-xl border border-line bg-background">
                    <summary className="min-h-11 cursor-pointer rounded-xl p-3 text-sm focus-visible:outline-2 focus-visible:outline-accent">{question.question}</summary>
                    <div className="space-y-3 border-t border-line p-3">
                      <p className="break-words text-xs text-muted">Ожидаемый файл: {question.expectedSource}, раздел: {question.expectedSection}. Цитата: <code className="break-all text-foreground">{question.expectedEvidence}</code></p>
                      <div className="grid gap-4 md:grid-cols-2">{report.comparison.map((item) => <div key={item.strategy} className="min-w-0">
                        <h3 className="text-sm font-medium">{LABELS[item.strategy]}: {item.retrieval[index].rank === null ? "промах" : `место ${item.retrieval[index].rank}`}</h3>
                        <ol className="mt-2 space-y-2">{item.retrieval[index].hits.map((hit, position) => <li key={hit.chunkId} className="break-words text-xs leading-relaxed text-muted">
                          <span className={hit.relevant ? "text-green-300" : ""}>{position + 1}. {hit.source} · {hit.score.toFixed(3)} {hit.relevant && "· совпадение"}</span>
                          <span className="block">{hit.section}</span>
                        </li>)}</ol>
                      </div>)}</div>
                    </div>
                  </details>)}
                </div>
              </section>
              <DocumentIndexPanel key={report.id} indexId={report.id} sources={sources} initialPage={initialPage} pageSize={DOCUMENT_INDEX_CONFIG.chunkPageSize} />
            </>}
          </main>
        </div>
      </div>
    );
  } finally {
    store.close();
  }
}
