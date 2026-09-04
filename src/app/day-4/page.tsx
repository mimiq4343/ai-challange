import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { TemperatureLab } from "@/components/temperature-lab";

export const metadata: Metadata = {
  title: "Flash Chat · Day 4",
  description:
    "Задание Day 4: один запрос при temperature 0, 0.7, 1.2 и 1.7 — точность, креативность и разнообразие ответов.",
};

export const dynamic = "force-dynamic";

export default function Day4() {
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
              AI Advent Challenge #9 · Day 4
            </p>
            <h1 className="mt-2.5 text-[clamp(1.4rem,0.9vw+1rem,2rem)] font-bold leading-tight tracking-tight">
              Одна задача при четырёх температурах
            </h1>
            <p className="mx-auto mt-1.5 max-w-[80ch] text-sm leading-relaxed text-muted">
              Один и тот же запрос уходит по три раза при{" "}
              <span className="font-mono text-foreground">temperature 0</span>,{" "}
              <span className="font-mono text-foreground">0.7</span>,{" "}
              <span className="font-mono text-foreground">1.2</span> и{" "}
              <span className="font-mono text-foreground">1.7</span>: повторы нужны, чтобы
              разнообразие можно было измерить, а не только заметить. Точность сверяется с
              эталоном, креативность и связность оценивает отдельный запрос-судья при нулевой
              температуре. Модель <span className="font-mono text-foreground">{model}</span>.
            </p>
          </div>
          <div className="rise-in-delayed">
            <TemperatureLab />
          </div>
        </main>
      </div>
    </div>
  );
}
