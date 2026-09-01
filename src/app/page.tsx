import { Chat } from "@/components/chat";

// Имя модели читается из env на каждый запрос, без пересборки страницы.
export const dynamic = "force-dynamic";

export default function Home() {
  const model = process.env.OPENAI_MODEL ?? null;

  return (
    <div className="relative w-full flex-1">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[85vh] bg-[radial-gradient(70vw_60vh_at_68%_10%,rgba(77,107,254,0.14),transparent_70%)]"
      />
      <div className="w-full px-[clamp(1rem,3vw,4rem)]">
        <header className="flex h-16 items-center justify-between">
          <a href="#" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent-deep text-sm font-bold text-white">
              F
            </span>
            Flash Chat
          </a>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <a href="#features" className="transition-colors hover:text-foreground">
              Возможности
            </a>
          </nav>
        </header>

        <main>
          <section className="flex h-[calc(100dvh-4rem)] min-h-[560px] flex-col pb-5">
            <div className="rise-in mx-auto text-center">
              <p className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">
                AI Advent Challenge #9 · Day 1
              </p>
              <h1 className="mt-2.5 text-[clamp(1.4rem,0.9vw+1rem,2rem)] font-bold leading-tight tracking-tight">
                Чат с моделью{" "}
                <span className="break-words font-mono text-[0.9em] text-accent">
                  {model ?? "не задана"}
                </span>
              </h1>
              <p className="mx-auto mt-1.5 text-sm leading-relaxed text-muted">
                Задавайте вопросы и получайте ответы в реальном времени. Подключение
                любой OpenAI совместимой модели.
              </p>
            </div>
            <div id="chat" className="rise-in-delayed mx-auto mt-4 min-h-0 w-full max-w-[1000px] flex-1 scroll-mt-24">
              <Chat model={model} />
            </div>
          </section>

          <section
            id="features"
            className="scroll-mt-16 border-t border-line py-[clamp(3.5rem,9vh,7rem)]"
          >
            <h2 className="text-[clamp(1.5rem,1.4vw+1rem,2.5rem)] font-bold tracking-tight">
              Что под капотом
            </h2>
            <div className="mt-8 grid gap-[clamp(1rem,1.2vw,1.75rem)] md:grid-cols-5">
              <article className="rounded-2xl border border-line bg-gradient-to-br from-accent/15 via-surface to-surface p-[clamp(1.5rem,1.8vw,2.5rem)] md:col-span-3">
                <h3 className="font-semibold">Стриминг без ожидания</h3>
                <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-muted">
                  Ответ приходит токен за токеном по SSE, генерацию можно остановить
                  в один клик, а частичный текст остаётся в диалоге.
                </p>
              </article>
              <article className="rounded-2xl border border-accent/20 bg-accent/5 p-[clamp(1.5rem,1.8vw,2.5rem)] md:col-span-2">
                <p className="font-mono text-3xl font-semibold tracking-tight">.env</p>
                <h3 className="mt-2 font-semibold">весь конфиг в одном месте</h3>
                <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-muted">
                  Базовый URL, имя модели и ключ задаются переменными окружения,
                  смена провайдера не требует правок кода.
                </p>
              </article>
              <article className="rounded-2xl border border-line bg-surface p-[clamp(1.5rem,1.8vw,2.5rem)] md:col-span-2">
                <h3 className="font-semibold">Ключ только на сервере</h3>
                <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-muted">
                  OPENAI_API_KEY лежит в .env.local, а браузер общается лишь с
                  серверным маршрутом приложения.
                </p>
              </article>
              <article className="rounded-2xl border border-line bg-surface p-[clamp(1.5rem,1.8vw,2.5rem)] md:col-span-3">
                <h3 className="font-semibold">Любой OpenAI-совместимый API</h3>
                <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-muted">
                  DeepSeek, OpenAI, OpenRouter, локальный Ollama: подойдёт любой
                  сервер с форматом chat completions.
                </p>
                <code className="mt-4 inline-block rounded-xl border border-line bg-background px-3 py-1.5 font-mono text-xs text-muted">
                  POST /api/chat
                </code>
              </article>
            </div>
          </section>
        </main>

        <footer className="flex flex-col items-start justify-between gap-2 border-t border-line py-8 text-sm text-muted sm:flex-row sm:items-center">
          <span>Flash Chat, 2026</span>
          <span>Автор: Roman Sukhin (@mimiq43)</span>
          <span>Сделано для AI Advent Challenge #9 · задание Day 1</span>
          <span>Next.js 16 · OpenAI-совместимый API</span>
        </footer>
      </div>
    </div>
  );
}
