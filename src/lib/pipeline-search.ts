import * as z from "zod/v4";
import type { GitHubRepositoryInfo } from "./github-repository-tool";
import { createMcpDispatcher, limitMcpResponse } from "./mcp-network";
import { PIPELINE_LIMITS } from "./pipeline-config";
import { pipelineRepositoriesSchema, pipelineToolSchemas } from "./pipeline-tool-schemas";

// https://docs.github.com/en/rest/search/search#search-repositories
const GITHUB_API_VERSION = "2026-03-10";
const repository = pipelineRepositoriesSchema.element.shape;
const upstreamSearch = z.object({
  incomplete_results: z.literal(false),
  total_count: z.number().int().nonnegative(),
  items: z.array(z.object({
    private: z.literal(false), full_name: repository.fullName,
    description: repository.description, language: repository.language,
    stargazers_count: repository.stars, forks_count: repository.forks, html_url: repository.url,
  })).max(PIPELINE_LIMITS.maxRepositories),
});

type SearchErrorCode = "INVALID_ARGUMENTS" | "RATE_LIMIT" | "HTTP_ERROR" | "REDIRECT"
  | "INVALID_RESPONSE" | "TIMEOUT" | "CANCELLED" | "NETWORK_ERROR";

export class PipelineSearchError extends Error {
  constructor(readonly code: SearchErrorCode, message: string, options?: ErrorOptions) {
    super(`[${code}] ${message}`, options);
    this.name = "PipelineSearchError";
  }
}

export async function fetchPipelineRepositories(query: string, callerSignal?: AbortSignal): Promise<GitHubRepositoryInfo[]> {
  const parsed = pipelineToolSchemas.search_repositories.safeParse({ query });
  if (!parsed.success) {
    throw new PipelineSearchError("INVALID_ARGUMENTS", "Укажите непустой поисковый запрос длиной до 200 символов без управляющих символов.", { cause: parsed.error });
  }
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `${parsed.data.query} is:public`);
  url.searchParams.set("per_page", String(PIPELINE_LIMITS.maxRepositories));
  url.searchParams.set("page", "1");
  const dispatcher = createMcpDispatcher(url);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("Истёк срок поиска GitHub.")), PIPELINE_LIMITS.searchTimeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline.signal]) : deadline.signal;
  try {
    signal.throwIfAborted();
    const init: RequestInit & { dispatcher: typeof dispatcher } = {
      method: "GET", redirect: "manual", credentials: "omit", signal, dispatcher,
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": GITHUB_API_VERSION, "User-Agent": "flash-mcp" },
    };
    const response = await fetch(url, init);
    if (response.status >= 300 && response.status < 400) {
      throw new PipelineSearchError("REDIRECT", "GitHub перенаправил поиск; перенаправления не разрешены.");
    }
    if (response.status === 429 || (response.status === 403
      && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))) {
      throw new PipelineSearchError("RATE_LIMIT", `Достигнут лимит поиска GitHub (HTTP ${response.status}). Повторите позже.`);
    }
    if (response.status !== 200) {
      throw new PipelineSearchError("HTTP_ERROR", `GitHub отклонил поиск (HTTP ${response.status}). Проверьте запрос или повторите позже.`);
    }
    let payload: unknown;
    try {
      payload = await limitMcpResponse(response).json();
    } catch (cause) {
      throw new PipelineSearchError("INVALID_RESPONSE", "GitHub вернул повреждённый или слишком большой ответ.", { cause });
    }
    signal.throwIfAborted();
    const validated = upstreamSearch.safeParse(payload);
    if (!validated.success) {
      throw new PipelineSearchError("INVALID_RESPONSE", "GitHub вернул неполные результаты или некорректные метаданные. Сводка не создана.", { cause: validated.error });
    }
    return validated.data.items.map((item) => ({
      fullName: item.full_name, description: item.description, language: item.language,
      stars: item.stargazers_count, forks: item.forks_count, url: item.html_url,
    }));
  } catch (cause) {
    if (signal.aborted) {
      const timedOut = deadline.signal.aborted && signal.reason === deadline.signal.reason;
      throw new PipelineSearchError(timedOut ? "TIMEOUT" : "CANCELLED", timedOut
        ? "GitHub не ответил за отведённое время." : "Поиск GitHub отменён.", { cause: signal.reason });
    }
    if (cause instanceof PipelineSearchError) throw cause;
    throw new PipelineSearchError("NETWORK_ERROR", "Не удалось выполнить поиск GitHub.", { cause });
  } finally {
    clearTimeout(timer);
    deadline.abort();
    await dispatcher.destroy();
  }
}
