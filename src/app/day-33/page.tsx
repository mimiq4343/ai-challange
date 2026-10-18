import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SupportWorkspace } from "@/components/support-workspace";
import { loadSupportData } from "@/lib/support-data";

export const metadata: Metadata = { title: "Flash Support · Day 33", description: "Поддержка пользователей Flash Chat с базой знаний и контекстом обращения через MCP." };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Day33({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  const data = await loadSupportData();
  const requested = (await searchParams).ticket;
  const initialTicketId = data.tickets.find(ticket => ticket.id === requested)?.id ?? data.tickets[0].id;
  const tickets = data.tickets.map(ticket => ({ ...ticket, userName: data.users.find(user => user.id === ticket.userId)!.name }));
  return <div className="relative w-full flex-1">
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[90vh] bg-[radial-gradient(75vw_65vh_at_70%_0%,rgba(77,107,254,0.16),transparent_72%)]" />
    <div className="w-full px-[clamp(0.75rem,1.5vw,1.5rem)] pb-8">
      <SiteHeader />
      <main className="space-y-5">
        <div className="rise-in flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div className="min-w-0"><p className="inline-flex rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">AI Advent Challenge #9 · Day 33</p><h1 className="mt-2 text-[clamp(1.35rem,0.8vw+1rem,1.9rem)] font-bold leading-tight tracking-tight">Flash Support</h1><p className="mt-1 text-sm text-muted">Поддержка, которая учитывает вашу ситуацию</p></div><p className="max-w-[55ch] text-xs leading-relaxed text-muted sm:text-right">FAQ и документация плюс контекст обращения через MCP.<br />Учебные пользователи и тикеты. Ассистент только читает данные.</p></div>
        <SupportWorkspace tickets={tickets} initialTicketId={initialTicketId} />
      </main>
    </div>
  </div>;
}
