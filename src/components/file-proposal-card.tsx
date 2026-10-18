"use client";

import { useRef, useState } from "react";
import { fileProposalSchema, type FileProposal } from "@/lib/file-assistant-types";

export function FileProposalCard({ proposal, disabled }: { proposal: FileProposal; disabled: boolean }) {
  const [status, setStatus] = useState<"pending" | "applying" | "applied">(proposal.status);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  async function apply() {
    if (disabled || status !== "pending") return;
    setStatus("applying"); setError(null);
    try {
      const response = await fetch("/api/file-assistant/apply", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposal.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Не удалось применить изменение.");
      const result = fileProposalSchema.parse(payload);
      if (result.id !== proposal.id || result.status !== "applied") throw new Error("Сервер не подтвердил запись файла.");
      setStatus("applied");
      statusRef.current?.focus();
    } catch (cause) { setStatus("pending"); setError(cause instanceof Error ? cause.message : "Не удалось применить изменение. Проверьте файл перед повтором."); statusRef.current?.focus(); }
  }
  return <section className="mt-4 min-w-0 rounded-xl border border-accent/30 bg-accent/5" aria-label={`Изменение ${proposal.path}`}>
    <div className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="min-w-0"><h3 className="break-all font-mono text-sm font-medium">{proposal.path}</h3><p ref={statusRef} tabIndex={-1} className="mt-1 text-xs text-muted" role="status">{status === "applied" ? "Файл записан на диск" : status === "applying" ? "Записываю файл…" : proposal.baseHash === null ? "Новый файл · ожидает применения" : "Обновление · ожидает применения"}</p></div>
      <button type="button" onClick={() => void apply()} disabled={disabled || status !== "pending"} className="min-h-11 min-w-11 cursor-pointer rounded-xl bg-accent-deep px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{status === "applied" ? "Применено" : status === "applying" ? "Применяю…" : "Применить"}</button>
    </div>
    <details open className="min-w-0 border-t border-line">
      <summary className="min-h-11 cursor-pointer rounded-xl px-3 py-3 text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Diff изменений</summary>
      <pre className="max-h-[32rem] overflow-auto border-t border-line p-3 font-mono text-xs leading-relaxed" tabIndex={0} aria-label={`Diff ${proposal.path}`}>{proposal.patch}</pre>
    </details>
    {error && <p role="alert" className="break-words px-3 pb-3 text-sm text-red-300">{error}</p>}
  </section>;
}
