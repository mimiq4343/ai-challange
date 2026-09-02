import type { Metadata } from "next";
import { Compare } from "@/components/compare";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Flash Chat · Day 2",
  description:
    "Задание Day 2: один запрос с контролем формата, длины и завершения ответа против запроса без ограничений.",
};

export const dynamic = "force-dynamic";

export default function Day2() {
  return (
    <div className="relative w-full flex-1">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[85vh] bg-[radial-gradient(70vw_60vh_at_50%_0%,rgba(77,107,254,0.12),transparent_70%)]"
      />
      <div className="flex min-h-[100dvh] w-full flex-col px-[clamp(1rem,3vw,4rem)] pb-5">
        <SiteHeader />
        <main className="flex min-h-0 flex-1 flex-col">
          <div className="rise-in mx-auto pb-4 text-center">
            <p className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">
              AI Advent Challenge #9 · Day 2
            </p>
            <h1 className="mt-2.5 text-[clamp(1.4rem,0.9vw+1rem,2rem)] font-bold leading-tight tracking-tight">
              Формат ответа: свободный против строгого
            </h1>
            <p className="mx-auto mt-1.5 max-w-[72ch] text-sm leading-relaxed text-muted">
              Один и тот же запрос уходит дважды: без ограничений и через агента с
              жёстким форматом JSON, лимитом длины и стоп-условием.
            </p>
          </div>
          <div className="rise-in-delayed flex min-h-0 flex-1 flex-col">
            <Compare />
          </div>
        </main>
      </div>
    </div>
  );
}
