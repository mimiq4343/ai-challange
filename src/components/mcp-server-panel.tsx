"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";

import type { McpDiscoveryResult, McpServerConfig } from "@/lib/mcp-types";

type ServerCheck = {
  checking: boolean;
  discovery?: McpDiscoveryResult;
  error?: string;
};

const BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line px-3 text-xs font-medium transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";
const INPUT_CLASS =
  "min-h-11 w-full min-w-0 rounded-xl border border-line bg-background px-3 py-2 text-base text-foreground placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 sm:text-sm";

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload && typeof payload === "object" && typeof payload.error === "string"
        ? payload.error
        : `Сервер вернул ${response.status}.`,
    );
  }
  if (payload === null) throw new Error("Сервер вернул некорректный ответ.");
  return payload as T;
}

export function McpServerPanel({ initialServers }: { initialServers: McpServerConfig[] }) {
  const [servers, setServers] = useState(initialServers);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [mutation, setMutation] = useState<"create" | number | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [checks, setChecks] = useState<Record<number, ServerCheck>>({});
  const serversRef = useRef(initialServers);
  const mutationRef = useRef<AbortController | null>(null);
  const discoveryRefs = useRef(new Map<number, AbortController>());
  const formId = useId();

  useEffect(() => {
    const discoveries = discoveryRefs.current;
    return () => {
      mutationRef.current?.abort();
      mutationRef.current = null;
      for (const controller of discoveries.values()) controller.abort();
      discoveries.clear();
    };
  }, []);

  function replaceServers(next: McpServerConfig[]) {
    const ids = new Set(next.map((server) => server.id));
    for (const [id, controller] of discoveryRefs.current) {
      if (!ids.has(id)) {
        controller.abort();
        discoveryRefs.current.delete(id);
      }
    }
    serversRef.current = next;
    setServers(next);
    setChecks((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => ids.has(Number(id))),
    ));
  }

  async function addServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationRef.current) return;
    const controller = new AbortController();
    mutationRef.current = controller;
    setMutation("create");
    setMutationError(null);
    setNotice("");
    try {
      const result = await readResponse<{ servers: McpServerConfig[] }>(await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), url: url.trim() }),
        signal: controller.signal,
      }));
      if (controller.signal.aborted || mutationRef.current !== controller) return;
      replaceServers(result.servers);
      setName("");
      setUrl("");
      setNotice("Сервер сохранён. Запустите проверку, чтобы получить инструменты.");
    } catch (error) {
      if (!controller.signal.aborted && mutationRef.current === controller) {
        setMutationError(error instanceof Error ? error.message : "Не удалось добавить сервер.");
      }
    } finally {
      if (mutationRef.current === controller) {
        mutationRef.current = null;
        setMutation(null);
      }
    }
  }

  async function deleteServer(server: McpServerConfig) {
    if (mutationRef.current) return;
    const controller = new AbortController();
    mutationRef.current = controller;
    setMutation(server.id);
    setMutationError(null);
    setNotice("");
    try {
      const result = await readResponse<{ servers: McpServerConfig[] }>(await fetch(`/api/mcp-servers/${server.id}`, {
        method: "DELETE",
        signal: controller.signal,
      }));
      if (controller.signal.aborted || mutationRef.current !== controller) return;
      replaceServers(result.servers);
      setNotice(`Сервер «${server.name}» удалён.`);
    } catch (error) {
      if (!controller.signal.aborted && mutationRef.current === controller) {
        setMutationError(error instanceof Error ? error.message : "Не удалось удалить сервер.");
      }
    } finally {
      if (mutationRef.current === controller) {
        mutationRef.current = null;
        setMutation(null);
      }
    }
  }

  async function discoverServer(server: McpServerConfig) {
    if (discoveryRefs.current.has(server.id)) return;
    const controller = new AbortController();
    discoveryRefs.current.set(server.id, controller);
    setChecks((current) => ({
      ...current,
      [server.id]: { ...current[server.id], checking: true, error: undefined },
    }));
    try {
      const { discovery } = await readResponse<{ discovery: McpDiscoveryResult }>(await fetch(`/api/mcp-servers/${server.id}/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: controller.signal,
      }));
      if (controller.signal.aborted || discoveryRefs.current.get(server.id) !== controller) return;
      if (!serversRef.current.some((item) => item.id === server.id)) return;
      setChecks((current) => ({ ...current, [server.id]: { checking: false, discovery } }));
    } catch (error) {
      if (!controller.signal.aborted && discoveryRefs.current.get(server.id) === controller) {
        setChecks((current) => ({
          ...current,
          [server.id]: {
            ...current[server.id],
            checking: false,
            error: error instanceof Error ? error.message : "Не удалось проверить сервер.",
          },
        }));
      }
    } finally {
      if (discoveryRefs.current.get(server.id) === controller) discoveryRefs.current.delete(server.id);
    }
  }

  return (
    <section aria-labelledby={`${formId}-heading`} className="flex min-w-0 flex-col gap-3 border-b border-line px-4 py-4">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Model Context Protocol</p>
        <h2 id={`${formId}-heading`} className="mt-1 text-base font-semibold tracking-tight">MCP-серверы</h2>
      </header>
      <p className="text-xs leading-relaxed text-muted">
        Сохраните адрес и отдельно проверьте соединение: handshake и tools/list.
        Инструменты только отображаются — агент их не вызывает.
      </p>
      <form aria-label="Добавить MCP-сервер" onSubmit={(event) => void addServer(event)} className="flex min-w-0 flex-col gap-3">
        <div>
          <label htmlFor={`${formId}-name`} className="mb-1.5 block text-xs font-medium">Название сервера</label>
          <input
            id={`${formId}-name`}
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={mutation === "create"}
            placeholder="Мой MCP-сервер"
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor={`${formId}-url`} className="mb-1.5 block text-xs font-medium">HTTPS-адрес MCP</label>
          <input
            id={`${formId}-url`}
            name="url"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={mutation === "create"}
            placeholder="https://mcp.yees.ai/mcp"
            aria-describedby={`${formId}-url-hint`}
            className={INPUT_CLASS}
          />
          <p id={`${formId}-url-hint`} className="mt-1.5 text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
            Пример: https://mcp.yees.ai/mcp. Только HTTPS, без логина, пароля и фрагмента #.
          </p>
        </div>
        <button type="submit" disabled={mutation !== null || !name.trim() || !url.trim()} className={`${BUTTON_CLASS} border-accent/30 bg-accent/10 text-accent`}>
          <PlusIcon size={16} weight="bold" aria-hidden />
          {mutation === "create" ? "Сохраняем сервер…" : "Добавить сервер"}
        </button>
      </form>
      {mutationError && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-xs leading-relaxed text-red-200 [overflow-wrap:anywhere]">{mutationError}</p>}
      <p role="status" className="text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">{notice}</p>
      {servers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-3 text-xs leading-relaxed text-muted">Серверов пока нет. Добавьте MCP-сервер по HTTPS-адресу.</p>
      ) : (
        <ul aria-label="Сохранённые MCP-серверы" className="flex min-w-0 flex-col gap-3">
          {servers.map((server) => {
            const check = checks[server.id];
            const discovery = check?.discovery;
            return (
              <li key={server.id} className="min-w-0 rounded-xl border border-line p-3">
                <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">{server.name}</h3>
                <p className="mt-1 font-mono text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">{server.url}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void discoverServer(server)}
                    disabled={Boolean(check?.checking) || mutation !== null}
                    aria-label={`Проверить сервер «${server.name}»`}
                    className={`${BUTTON_CLASS} flex-1 text-accent`}
                  >
                    {check?.checking ? "Проверяем…" : "Проверить"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteServer(server)}
                    disabled={mutation !== null}
                    aria-label={`Удалить сервер «${server.name}»`}
                    className={`${BUTTON_CLASS} text-muted`}
                  >
                    <TrashIcon size={16} aria-hidden />
                    {mutation === server.id ? "Удаляем…" : "Удалить"}
                  </button>
                </div>
                <p role="status" className="mt-2 text-xs leading-relaxed text-muted">
                  {check?.checking ? "Выполняются handshake и tools/list…" : !discovery ? (check?.error ? "Проверка не выполнена." : "Ещё не проверен.") : "Последняя успешная проверка:"}
                </p>
                {check?.error && <p role="alert" className="mt-2 rounded-lg border border-red-400/30 bg-red-400/10 p-2 text-xs leading-relaxed text-red-200 [overflow-wrap:anywhere]">{check.error}</p>}
                {discovery && (
                  <div className="mt-2 min-w-0 border-t border-line pt-3">
                    <p className="text-xs font-medium [overflow-wrap:anywhere]">{discovery.server.name} · версия {discovery.server.version}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      Проверено: <time dateTime={discovery.checkedAt}>{new Date(discovery.checkedAt).toLocaleString("ru-RU")}</time>
                    </p>
                    <p className="mt-3 text-xs font-semibold">Инструменты: {discovery.tools.length}</p>
                    {discovery.tools.length === 0 ? (
                      <p className="mt-2 text-xs leading-relaxed text-muted">Сервер не объявил инструментов.</p>
                    ) : (
                      <ul className="mt-2 flex min-w-0 flex-col gap-3">
                        {discovery.tools.map((tool) => (
                          <li key={tool.name} className="min-w-0 rounded-lg border border-line p-2">
                            <h4 className="font-mono text-xs font-semibold text-accent [overflow-wrap:anywhere]">{tool.name}</h4>
                            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">{tool.description || "Описание не указано."}</p>
                            <details className="mt-2 min-w-0">
                              <summary className="min-h-11 cursor-pointer rounded-lg py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [overflow-wrap:anywhere]">
                                Схема входных данных · {tool.name}
                              </summary>
                              <pre className="mt-1 max-w-full whitespace-pre-wrap rounded-lg bg-background p-2 font-mono text-[11px] leading-relaxed [overflow-wrap:anywhere]">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                            </details>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
