import * as z from "zod/v4";

import { createMcpDispatcher, limitMcpResponse } from "./mcp-network";

// Версия зафиксирована по https://docs.github.com/en/rest/about-the-rest-api/api-versions.
const GITHUB_API_VERSION = "2026-03-10";
// Оставляем запас до десятисекундного дедлайна ответа MCP-сервера.
const GITHUB_TIMEOUT_MS = 8_000;

export const githubRepositoryInputSchema = {
  owner: z.string().min(1).max(39).regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/)
    .describe("Владелец публичного репозитория GitHub: имя пользователя или организации, без URL"),
  repo: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/)
    .refine((value) => value !== "." && value !== "..", "Недопустимое имя репозитория")
    .describe("Имя публичного репозитория GitHub, без владельца, URL и суффикса .git"),
};
const repositoryInput = z.object(githubRepositoryInputSchema);

export const githubRepositoryOutputSchema = {
  fullName: z.string().min(1),
  description: z.string().nullable(),
  language: z.string().nullable(),
  stars: z.number().int().nonnegative(),
  forks: z.number().int().nonnegative(),
  url: z.url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.port
      && !url.username && !url.password && !url.search && !url.hash;
  }, "Ожидается публичный HTTPS URL репозитория на github.com"),
};
const upstreamRepository = z.object({
  full_name: githubRepositoryOutputSchema.fullName,
  description: githubRepositoryOutputSchema.description,
  language: githubRepositoryOutputSchema.language,
  stargazers_count: githubRepositoryOutputSchema.stars,
  forks_count: githubRepositoryOutputSchema.forks,
  html_url: githubRepositoryOutputSchema.url,
});

export type GitHubRepositoryInfo = z.infer<z.ZodObject<typeof githubRepositoryOutputSchema>>;
type GitHubRepositoryErrorCode = "INVALID_ARGUMENTS" | "NOT_FOUND" | "RATE_LIMIT" | "REDIRECT"
  | "HTTP_ERROR" | "INVALID_RESPONSE" | "TIMEOUT" | "CANCELLED" | "NETWORK_ERROR";

export class GitHubRepositoryError extends Error {
  constructor(readonly code: GitHubRepositoryErrorCode, message: string, options?: ErrorOptions) {
    super(`[${code}] ${message}`, options);
    this.name = "GitHubRepositoryError";
  }
}

export async function fetchGitHubRepository(
  input: { owner: string; repo: string },
  callerSignal?: AbortSignal,
): Promise<GitHubRepositoryInfo> {
  const parsed = repositoryInput.safeParse(input);
  if (!parsed.success) {
    throw new GitHubRepositoryError("INVALID_ARGUMENTS", "Укажите допустимые owner и repo, а не URL или путь.", { cause: parsed.error });
  }
  const { owner, repo } = parsed.data;
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  // Повторно используем проверку DNS в момент подключения и лимит распакованного тела.
  const dispatcher = createMcpDispatcher(url);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("Истёк срок запроса GitHub.")), GITHUB_TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline.signal]) : deadline.signal;
  try {
    signal.throwIfAborted();
    const init: RequestInit & { dispatcher: typeof dispatcher } = {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "flash-mcp",
      },
      signal,
      dispatcher,
    };
    const response = await fetch(url, init);
    if (response.status >= 300 && response.status < 400) {
      throw new GitHubRepositoryError("REDIRECT", "GitHub перенаправил запрос. Укажите актуального владельца и имя репозитория.");
    }
    if (response.status === 404) {
      throw new GitHubRepositoryError("NOT_FOUND", "Публичный репозиторий не найден (GitHub HTTP 404); приватные репозитории недоступны без авторизации.");
    }
    if (response.status === 429 || (response.status === 403
      && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))) {
      throw new GitHubRepositoryError("RATE_LIMIT", `Достигнут лимит запросов GitHub (HTTP ${response.status}). Повторите запрос позже.`);
    }
    if (response.status !== 200) {
      throw new GitHubRepositoryError("HTTP_ERROR", `GitHub отклонил запрос (HTTP ${response.status}).`);
    }
    let payload: unknown;
    try {
      payload = await limitMcpResponse(response).json();
    } catch (cause) {
      throw new GitHubRepositoryError("INVALID_RESPONSE", "GitHub вернул некорректный JSON или ответ превышает допустимый размер.", { cause });
    }
    signal.throwIfAborted();
    const validated = upstreamRepository.safeParse(payload);
    if (!validated.success) {
      throw new GitHubRepositoryError("INVALID_RESPONSE", "Ответ GitHub не соответствует схеме данных репозитория.", { cause: validated.error });
    }
    const data = validated.data;
    return {
      fullName: data.full_name,
      description: data.description,
      language: data.language,
      stars: data.stargazers_count,
      forks: data.forks_count,
      url: data.html_url,
    };
  } catch (cause) {
    if (signal.aborted) {
      const timedOut = deadline.signal.aborted && signal.reason === deadline.signal.reason;
      throw new GitHubRepositoryError(timedOut ? "TIMEOUT" : "CANCELLED", timedOut
        ? "GitHub не ответил за отведённое время."
        : "Запрос к GitHub отменён.", { cause: signal.reason });
    }
    if (cause instanceof GitHubRepositoryError) throw cause;
    throw new GitHubRepositoryError("NETWORK_ERROR", "Не удалось получить ответ от GitHub.", { cause });
  } finally {
    clearTimeout(timer);
    // Прерываем непрочитанное тело также при HTTP-ошибках и перенаправлениях.
    deadline.abort();
    await dispatcher.destroy();
  }
}
