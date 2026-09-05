import type { Metadata } from "next";
import { Day5Lab } from "@/components/day5-lab";
import { SiteHeader } from "@/components/site-header";
import { DAY5_MODELS } from "@/lib/day5";

export const metadata: Metadata = {
  title: "Flash Chat · Day 5",
  description:
    "Задание Day 5: один запрос на слабой, средней и сильной модели — время ответа, токены, стоимость и качество.",
};

export const dynamic = "force-dynamic";

export default function Day5() {
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
              AI Advent Challenge #9 · Day 5
            </p>
            <h1 className="mt-2.5 text-[clamp(1.4rem,0.9vw+1rem,2rem)] font-bold leading-tight tracking-tight">
              Один запрос на трёх моделях разного класса
            </h1>
            <p className="mx-auto mt-1.5 max-w-[80ch] text-sm leading-relaxed text-muted">
              Слабая, средняя и сильная модели получают одинаковый запрос при одинаковых настройках и
              отвечают параллельно. Сервер замеряет время до первого токена и до конца ответа, забирает
              у провайдера точное число токенов и считает стоимость по его тарифу. Качество проверяется
              дважды: сверкой с эталоном там, где верный ответ один, и слепым судьёй, который видит
              ответы под метками A, B и C и не знает, какая модель что написала.
            </p>
            <p className="mx-auto mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
              {DAY5_MODELS.map((spec) => (
                <span key={spec.id}>
                  {spec.tierLabel}: <span className="text-foreground">{spec.model}</span>
                </span>
              ))}
            </p>
          </div>
          <div className="rise-in-delayed">
            <Day5Lab />
          </div>
        </main>
      </div>
    </div>
  );
}
