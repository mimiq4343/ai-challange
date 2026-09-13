import type { Metadata } from "next";
import { Chat } from "@/components/chat";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Flash Chat · Day 6",
  description:
    "Первый AI-агент: отдельная серверная сущность принимает сообщения, вызывает LLM и возвращает ответ в чат.",
};

export const dynamic = "force-dynamic";

const FLOW = [
  { step: "01", title: "Запрос", text: "Интерфейс передаёт историю диалога агенту." },
  { step: "02", title: "Агент", text: "ChatAgent добавляет роль и вызывает LLM через API." },
  { step: "03", title: "Ответ", text: "Агент разбирает поток и возвращает текст в чат." },
];

export default function Day6() {
  const model = process.env.OPENAI_MODEL ?? null;

  return (
    <div className="relative w-full flex-1">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[85vh] bg-[radial-gradient(70vw_60vh_at_50%_0%,rgba(77,107,254,0.14),transparent_70%)]"
      />
      <div className="w-full px-[clamp(1rem,3vw,4rem)] pb-8">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-5">
          <div className="rise-in pt-2 text-center">
            <p className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">
              AI Advent Challenge #9 · Day 6
            </p>
            <h1 className="mt-2.5 text-[clamp(1.5rem,1vw+1rem,2.25rem)] font-bold leading-tight tracking-tight">
              Первый агент: <span className="text-accent">Flash</span>
            </h1>
            <p className="mx-auto mt-1.5 max-w-[70ch] text-sm leading-relaxed text-muted">
              Не прямой вызов API, а отдельная серверная сущность: агент задаёт роль,
              управляет запросом к модели и преобразует её ответ для интерфейса.
            </p>
          </div>

          <ol className="rise-in grid gap-2 sm:grid-cols-3">
            {FLOW.map((item) => (
              <li key={item.step} className="rounded-xl border border-line bg-surface/80 px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] text-accent">{item.step}</span>
                  <h2 className="text-sm font-semibold">{item.title}</h2>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{item.text}</p>
              </li>
            ))}
          </ol>

          <div className="rise-in-delayed h-[min(620px,calc(100dvh-20rem))] min-h-[460px]">
            <Chat model={model} agentName="Flash Agent" />
          </div>
        </main>
      </div>
    </div>
  );
}
