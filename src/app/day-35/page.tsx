import type { Metadata } from "next";
import { ReleaseWorkspace } from "@/components/release-workspace";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Flash Release · Day 35", description: "Подготовка релиза по реальным Git-изменениям: AI release notes, риски и результаты CI." };

export default function Day35() {
  return <div className="relative w-full flex-1">
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[90vh] bg-[radial-gradient(75vw_65vh_at_70%_0%,rgba(77,107,254,0.16),transparent_72%)]" />
    <div className="w-full px-[clamp(0.75rem,1.5vw,1.5rem)] pb-8">
      <SiteHeader />
      <main className="space-y-5">
        <div className="rise-in flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0"><p className="inline-flex rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">AI Advent Challenge #9 · Day 35</p><h1 className="mt-2 text-[clamp(1.35rem,0.8vw+1rem,1.9rem)] font-bold leading-tight tracking-tight">Подготовка релиза с AI</h1></div>
          <p className="max-w-[55ch] text-xs leading-relaxed text-muted sm:text-right">Реальные изменения. Проверяемые источники.<br />Release notes, риски и CI в одном процессе.</p>
        </div>
        <ReleaseWorkspace />
      </main>
    </div>
  </div>;
}
