import type { Metadata } from "next";
import { ReasoningLab } from "@/components/reasoning-lab";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Flash Chat · Day 3",
  description:
    "Задание Day 3: одна задача решается четырьмя способами рассуждения, ответы сверяются с эталоном.",
};

export const dynamic = "force-dynamic";

export default function Day3() {
  const model = process.env.OPENAI_MODEL ?? "не задана";

  return (
    <div className="relative w-full flex-1">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[85vh] bg-[radial-gradient(70vw_60vh_at_50%_0%,rgba(77,107,254,0.12),transparent_70%)]"
      />
      <div className="w-full px-[clamp(1rem,3vw,4rem)] pb-10">
        <SiteHeader />
        <main className="flex flex-col gap-5">
          <div className="rise-in mx-auto pt-2 text-center">
            <p className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">
              AI Advent Challenge #9 · Day 3
            </p>
            <h1 className="mt-2.5 text-[clamp(1.4rem,0.9vw+1rem,2rem)] font-bold leading-tight tracking-tight">
              Четыре способа рассуждения над одной задачей
            </h1>
            <p className="mx-auto mt-1.5 max-w-[80ch] text-sm leading-relaxed text-muted">
              Прямой ответ, пошаговое решение, промпт, составленный самой моделью, и
              группа экспертов. Одинаковая задача, одинаковые параметры сэмплинга
              (temperature 0, thinking отключён), модель{" "}
              <span className="font-mono text-foreground">{model}</span>. Финальная
              строка каждого способа сверяется с эталоном автоматически.
            </p>
          </div>
          <div className="rise-in-delayed">
            <ReasoningLab />
          </div>
        </main>
      </div>
    </div>
  );
}
