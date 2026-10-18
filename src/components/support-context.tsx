import type { SupportTicketState } from "@/lib/support-types";

export const SUPPORT_STATUS = { open: "Открыт", pending: "Ожидает уточнения", resolved: "Решён" } as const;

export function SupportContext({ state }: { state: SupportTicketState }) {
  const { user, ticket } = state;
  return <aside className="min-w-0 space-y-4" aria-label="Контекст обращения">
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="font-semibold">Пользователь</h2>
      <p className="mt-3 text-sm">{user.name}</p>
      <p className="mt-1 text-xs text-muted">{user.organization}</p>
      <p className="mt-3 text-sm leading-relaxed text-muted">{user.environment}</p>
    </section>
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="font-semibold">Что известно</h2>
      <p className="mt-3 text-sm leading-relaxed">{ticket.description}</p>
      <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">{ticket.diagnostics.map(item => <li key={item} className="border-l-2 border-accent/30 pl-3">{item}</li>)}</ul>
      <h3 className="mt-5 text-sm font-medium">Предыдущие действия</h3>
      <ul className="mt-2 space-y-2 text-sm leading-relaxed text-muted">{ticket.history.map(item => <li key={item.at}>{item.text}</li>)}</ul>
    </section>
  </aside>;
}
