import { z } from "zod";
import { CODE_REVIEW_CONFIG as CONFIG } from "./code-review-config";

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const repository = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const eventSchema = z.object({
  number: z.number().int().positive(), repository: z.object({ full_name: repository }),
  pull_request: z.object({
    number: z.number().int().positive(),
    base: z.object({ sha, repo: z.object({ full_name: repository }) }), head: z.object({ sha }),
  }),
});

export type ReviewEvent = { repository: string; number: number; baseSha: string; headSha: string };

export class CodeReviewGithubError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "CodeReviewGithubError"; }
}

export function parseReviewEvent(input: unknown, expectedRepository: string): ReviewEvent {
  const event = eventSchema.parse(input);
  if (event.repository.full_name !== expectedRepository || event.pull_request.base.repo.full_name !== expectedRepository || event.number !== event.pull_request.number) {
    throw new CodeReviewGithubError("Событие PR не соответствует текущему репозиторию или номеру PR.");
  }
  return { repository: expectedRepository, number: event.number, baseSha: event.pull_request.base.sha, headSha: event.pull_request.head.sha };
}

export async function publishReviewComment(event: ReviewEvent, body: string, token: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<"created" | "updated" | "stale"> {
  if (!token.trim()) throw new CodeReviewGithubError("Не задан GITHUB_TOKEN для комментария PR.");
  repository.parse(event.repository); sha.parse(event.baseSha); sha.parse(event.headSha);
  if (!Number.isSafeInteger(event.number) || event.number < 1) throw new CodeReviewGithubError("Некорректный номер PR.");
  const root = `https://api.github.com/repos/${event.repository}`;
  async function request(path: string, method = "GET", data?: unknown): Promise<unknown> {
    const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(CONFIG.githubTimeoutMs)]);
    let response: Response;
    try {
      response = await fetcher(`${root}${path}`, {
        method, redirect: "error", signal: requestSignal,
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": CONFIG.githubApiVersion, "Content-Type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    } catch (cause) { throw new CodeReviewGithubError("Не удалось выполнить запрос к GitHub.", { cause }); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CodeReviewGithubError(`GitHub вернул HTTP ${response.status}. Проверьте права Actions и состояние API.`);
    }
    try { return await response.json(); }
    catch (cause) { throw new CodeReviewGithubError("GitHub вернул некорректный JSON.", { cause }); }
  }
  async function isCurrent(): Promise<boolean> {
    const current = z.object({ state: z.string(), head: z.object({ sha }), base: z.object({ sha }) }).parse(await request(`/pulls/${event.number}`));
    return current.state === "open" && current.head.sha === event.headSha && current.base.sha === event.baseSha;
  }
  if (!await isCurrent()) return "stale";
  const commentsSchema = z.array(z.object({
    id: z.number().int().positive(), body: z.string().nullable(), user: z.object({ login: z.string(), type: z.string() }).nullable(),
  }));
  let commentId: number | undefined;
  for (let page = 1; page <= CONFIG.maxCommentPages; page++) {
    const comments = commentsSchema.parse(await request(`/issues/${event.number}/comments?per_page=100&page=${page}`));
    commentId = comments.find((comment) => comment.user?.login === "github-actions[bot]" && comment.user.type === "Bot" && comment.body?.startsWith(CONFIG.commentMarker))?.id;
    if (commentId || comments.length < 100) break;
    if (page === CONFIG.maxCommentPages) throw new CodeReviewGithubError("Лимит страниц комментариев исчерпан; новый комментарий не создан во избежание дубля.");
  }
  // Пока шёл поиск комментария, PR мог получить новые коммиты.
  if (!await isCurrent()) return "stale";
  await request(commentId ? `/issues/comments/${commentId}` : `/issues/${event.number}/comments`, commentId ? "PATCH" : "POST", { body });
  return commentId ? "updated" : "created";
}
