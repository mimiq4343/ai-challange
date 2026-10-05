"use client";

import { useEffect, useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GraphIcon } from "@phosphor-icons/react";

import type { OrchestrationServerAuth, OrchestrationServerId } from "@/lib/orchestration-config";
import type { McpServerStatus, OrchestrationCall, OrchestrationRun } from "@/lib/orchestration-types";

export type RegisteredServerView = {
  id: OrchestrationServerId;
  name: string;
  url: string;
  auth: OrchestrationServerAuth;
  role: string;
  allowedTools: string[];
};

const BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-xs font-medium transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-40";
const DETAILS_SUMMARY_CLASS =
  "min-h-11 cursor-pointer rounded-lg py-3 text-xs font-medium text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const AUTH_LABEL: Record<OrchestrationServerAuth, string> = {
  none: "без авторизации",
  scheduler: "токен планировщика и профиль",
  pipeline: "токен пайплайна и профиль",
};

const RUN_STATUS: Record<OrchestrationRun["status"], { label: string; className: string }> = {
  running: { label: "Выполняется", className: "text-accent" },
  completed: { label: "Завершён", className: "text-emerald-300" },
  failed: { label: "Ошибка", className: "text-red-200" },
  interrupted: { label: "Прерван", className: "text-red-200" },
};

const CALL_STATUS: Record<OrchestrationCall["status"], { label: string; className: string }> = {
  running: { label: "Выполняется", className: "text-accent" },
  ok: { label: "Выполнен", className: "text-emerald-300" },
  error: { label: "Ошибка", className: "text-red-200" },
};

function formatUtc(value: string): string {
  return `${value.replace("T", " ").replace(/\.\d{3}Z$/, "")} UTC`;
}

function ServerCard({ server, status }: { server: RegisteredServerView; status: McpServerStatus | undefined }) {
  const url = new URL(server.url);
  const hidden = status?.status === "available" ? status.tools.filter((tool) => !server.allowedTools.includes(tool)) : [];
  const missing = status?.status === "available" ? server.allowedTools.filter((tool) => !status.tools.includes(tool)) : [];
  return (
    <li className="min-w-0 space-y-2 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{server.name}</h4>
        <span className={`text-xs ${status?.status === "available" ? "text-emerald-300" : status ? "text-red-200" : "text-muted"}`}>
          {status?.status === "available" ? "Доступен" : status ? "Недоступен" : "Ещё не проверялся"}
        </span>
      </div>
      <p className="font-mono text-xs text-muted">
        {server.id} · {url.host}{url.pathname}
      </p>
      <p className="text-xs leading-relaxed">{server.role}.</p>
      <p className="text-xs text-muted">Доступ: {AUTH_LABEL[server.auth]}</p>
      {status?.status === "unavailable" && <p className="text-xs leading-relaxed text-red-200">{status.error}</p>}
      <ul aria-label={`Разрешённые инструменты ${server.name}`} className="flex flex-wrap gap-1.5">
        {server.allowedTools.map((tool) => (
          <li key={tool} className={`rounded-lg border px-2 py-1 font-mono text-[11px] ${missing.includes(tool) ? "border-red-300/30 text-red-200 line-through" : "border-accent/25 bg-accent/5"}`}>
            {tool}
          </li>
        ))}
      </ul>
      {hidden.length > 0 && (
        <p className="text-xs leading-relaxed text-muted">Скрыты от модели: <span className="font-mono">{hidden.join(", ")}</span></p>
      )}
    </li>
  );
}

export function OrchestrationPanel({
  servers, run, profileName,
}: {
  servers: RegisteredServerView[];
  run: OrchestrationRun | null;
  profileName: string;
}) {
  const router = useRouter();
  const headingId = useId();
  const [refreshing, startTransition] = useTransition();

  useEffect(() => {
    function refreshOnFocus() {
      startTransition(() => router.refresh());
    }
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [router]);

  const serverName = (id: string) => servers.find((server) => server.id === id)?.name ?? id;
  const runStatus = run ? RUN_STATUS[run.status] : null;

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-4 border-b border-line p-4 [overflow-wrap:anywhere]">
      <header className="flex items-start gap-3">
        <GraphIcon size={22} className="mt-1 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-accent">Оркестрация MCP</p>
          <h2 id={headingId} className="mt-1 text-base font-semibold">Серверы и маршрут</h2>
          <p className="mt-1 text-xs text-muted">Профиль: {profileName}</p>
        </div>
      </header>
      <p className="text-xs leading-relaxed text-muted">
        Агент видит общий каталог инструментов вида <span className="font-mono">сервер__инструмент</span> и сам выбирает,
        на какой сервер отправить каждый шаг. Токены уходят только своему серверу; DeepWiki получает лишь имя репозитория и вопрос.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Маршрут последнего запуска</h3>
        <button
          type="button"
          className={BUTTON_CLASS}
          aria-disabled={refreshing}
          onClick={() => { if (!refreshing) startTransition(() => router.refresh()); }}
        >
          {refreshing ? "Обновляем…" : "Обновить"}
        </button>
      </div>
      <p role="status" className="text-xs leading-relaxed text-muted">
        {refreshing ? "Читаем журнал маршрутизации…" : "Журнал обновляется после ответа, при возврате на страницу или по кнопке. Время — UTC."}
      </p>
      {!run || !runStatus ? (
        <div className="rounded-xl border border-dashed border-line p-4 text-sm leading-relaxed text-muted">
          Запусков пока нет. Отправьте в чат длинную задачу: поиск, проверка лидера, вопрос DeepWiki, отчёт и мониторинг.
        </div>
      ) : (
        <article className="min-w-0 space-y-3 rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className={`font-medium ${runStatus.className}`}>{runStatus.label}</span>
            <time dateTime={run.createdAt} className="text-muted">{formatUtc(run.createdAt)}</time>
          </div>
          <blockquote className="border-l-2 border-accent/40 pl-3 text-xs leading-relaxed text-muted">{run.request}</blockquote>
          {run.error && <p className="text-xs leading-relaxed text-red-200">{run.error}</p>}
          {run.calls.length === 0 ? (
            <p className="text-xs text-muted">Агент не вызывал инструменты в этом запуске.</p>
          ) : (
            <ol aria-label="Шаги маршрута" className="space-y-2">
              {run.calls.map((call) => (
                <li key={call.step} className="min-w-0 rounded-lg border border-line bg-background/60 p-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                    <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 font-semibold text-accent">
                      {call.step}
                    </span>
                    <span className="sr-only">Шаг {call.step}:</span>
                    <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">{serverName(call.serverId)}</span>
                    <span className={`ml-auto ${CALL_STATUS[call.status].className}`}>{CALL_STATUS[call.status].label}</span>
                  </div>
                  <p className="mt-1.5 break-all font-mono text-xs">{call.tool}</p>
                  <details className="min-w-0">
                    <summary className={DETAILS_SUMMARY_CLASS}>Аргументы шага {call.step}</summary>
                    <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-surface p-2 font-mono text-xs leading-relaxed">
                      {JSON.stringify(call.arguments, null, 2)}
                    </pre>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </article>
      )}

      <h3 className="text-sm font-semibold">Зарегистрированные серверы · {servers.length}</h3>
      <p className="text-xs leading-relaxed text-muted">
        Реестр задан в коде. Доступность — по подключению в последнем запуске; модель видит только разрешённые инструменты.
      </p>
      <ul className="space-y-3">
        {servers.map((server) => (
          <ServerCard key={server.id} server={server} status={run?.servers?.find((status) => status.id === server.id)} />
        ))}
      </ul>
    </section>
  );
}
