import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { CODE_REVIEW_CONFIG as CONFIG } from "./code-review-config";
import { CodeReviewGithubError, type ReviewEvent } from "./code-review-github";

const execFileAsync = promisify(execFile);
const repositorySchema = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const pullRequestSchema = z.object({ number: z.number().int().positive(),
  base: z.object({ sha, repo: z.object({ full_name: repositorySchema }) }), head: z.object({ sha }),
});

export async function readReviewPullRequest(repository: string, number: number, signal: AbortSignal, token?: string, fetcher: typeof fetch = fetch): Promise<ReviewEvent> {
  repositorySchema.parse(repository); z.number().int().positive().parse(number);
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetcher(`https://api.github.com/repos/${repository}/pulls/${number}`, {
      redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(CONFIG.githubTimeoutMs)]),
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": CONFIG.githubApiVersion,
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch (cause) {
    signal.throwIfAborted();
    throw new CodeReviewGithubError("Не удалось получить PR из GitHub. Проверьте доступ сервера к GitHub.", { cause });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new CodeReviewGithubError(`GitHub вернул HTTP ${response.status}. Проверьте номер PR и доступ; для закрытого репозитория нужен серверный GITHUB_TOKEN.`);
  }
  let pr: z.infer<typeof pullRequestSchema>;
  try { pr = pullRequestSchema.parse(await response.json()); }
  catch (cause) { throw new CodeReviewGithubError("GitHub вернул некорректные данные PR.", { cause }); }
  if (pr.number !== number || pr.base.repo.full_name.toLowerCase() !== repository.toLowerCase()) {
    throw new CodeReviewGithubError("PR не соответствует выбранному репозиторию проекта.");
  }
  return { repository, number, baseSha: pr.base.sha, headSha: pr.head.sha };
}

/** Загружает только immutable Git-объекты; ветки, HEAD и FETCH_HEAD не меняются. */
export async function fetchReviewPullRequest(root: string, pr: ReviewEvent, signal: AbortSignal, token?: string): Promise<void> {
  repositorySchema.parse(pr.repository); sha.parse(pr.baseSha); sha.parse(pr.headSha);
  signal.throwIfAborted();
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0",
    ...(token ? { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` } : {}) };
  try {
    await execFileAsync("git", ["-C", root, "fetch", "--no-tags", "--no-recurse-submodules", "--no-write-fetch-head",
      `https://github.com/${pr.repository}.git`, pr.baseSha, pr.headSha], {
      signal, env, timeout: CONFIG.gitTimeoutMs, maxBuffer: CONFIG.gitMaxBufferBytes,
    });
  } catch (cause) {
    signal.throwIfAborted();
    throw new CodeReviewGithubError("Не удалось загрузить коммиты PR. Проверьте доступ Git к репозиторию и серверный GITHUB_TOKEN для приватного проекта.", { cause });
  }
}
