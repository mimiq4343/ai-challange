"use client";

import { useState } from "react";
import { SupportChat } from "@/components/support-chat";
import { SUPPORT_STATUS } from "@/components/support-context";
import type { SupportTicket } from "@/lib/support-types";

type Ticket = SupportTicket & { userName: string };

function TicketList({ tickets, selected, onSelect }: { tickets: Ticket[]; selected: string; onSelect: (id: string) => void }) {
  return <ul className="space-y-2 p-2">{tickets.map(ticket => <li key={ticket.id}><button type="button" onClick={() => onSelect(ticket.id)} aria-current={ticket.id === selected ? "true" : undefined} className={`min-h-11 w-full cursor-pointer rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${ticket.id === selected ? "border-accent/40 bg-accent/10" : "border-transparent hover:border-line hover:bg-white/5"}`}>
    <span className="flex flex-wrap justify-between gap-2 text-[11px]"><span className="font-mono text-accent">{ticket.id}</span><span className="text-muted">{SUPPORT_STATUS[ticket.status]}</span></span>
    <span className="mt-2 block text-sm font-medium leading-relaxed">{ticket.title}</span><span className="mt-1 block text-xs text-muted">{ticket.userName}</span>
  </button></li>)}</ul>;
}

export function SupportWorkspace({ tickets, initialTicketId }: { tickets: Ticket[]; initialTicketId: string }) {
  const [selected, setSelected] = useState(initialTicketId);
  function select(id: string) {
    setSelected(id);
    const url = new URL(window.location.href); url.searchParams.set("ticket", id);
    window.history.replaceState(null, "", url);
    const picker = document.querySelector<HTMLDetailsElement>("#support-mobile-tickets");
    if (picker?.open) { picker.open = false; picker.querySelector("summary")?.focus(); }
  }
  return <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(15rem,20vw)_minmax(0,1fr)]">
    <aside className="hidden min-w-0 rounded-2xl border border-line bg-surface lg:block" aria-label="Тикеты поддержки"><h2 className="border-b border-line p-4 text-sm font-semibold">Обращения <span className="ml-2 text-muted">{tickets.length}</span></h2><TicketList tickets={tickets} selected={selected} onSelect={select} /></aside>
    <details id="support-mobile-tickets" className="min-w-0 rounded-2xl border border-line bg-surface lg:hidden"><summary className="min-h-11 cursor-pointer p-3 text-sm focus-visible:outline-2 focus-visible:outline-accent">Выбрать обращение · {selected}</summary><TicketList tickets={tickets} selected={selected} onSelect={select} /></details>
    <SupportChat key={selected} ticketId={selected} />
  </div>;
}
