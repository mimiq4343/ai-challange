import "server-only";
import { z } from "zod";
import { RELEASE_CONFIG as CONFIG } from "./release-config";
import { releaseWorkspaceSchema, type ReleaseCi } from "./release-types";

const runSchema = z.object({
  id: z.number().int().positive(), workflow_id: z.number().int().positive(), name: z.string().nullable(),
  head_sha: z.string(), status: z.string(), conclusion: z.string().nullable(), event: z.string(), html_url: z.url(),
});
const responseSchema = z.object({ total_count: z.number().int().nonnegative(), workflow_runs: z.array(runSchema) });

/** Отсутствие CI или отказ GitHub сохраняются как явный пробел в проверках. */
export async function readReleaseCi(repository: string, headSha: string, signal: AbortSignal, token?: string, fetcher: typeof fetch = fetch): Promise<ReleaseCi> {
  releaseWorkspaceSchema.shape.repository.parse(repository);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(headSha)) throw new Error("Нужен SHA релиза.");
  signal.throwIfAborted();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(CONFIG.githubTimeoutMs)]);
  const latest = new Map<string, z.infer<typeof runSchema>>();
  let complete = false;
  try {
    for (let page = 1; page <= CONFIG.maxCiPages; page++) {
      const response = await fetcher(`https://api.github.com/repos/${repository}/actions/runs?head_sha=${headSha}&per_page=100&page=${page}`, {
        signal: deadline, redirect: "error", headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": CONFIG.githubApiVersion,
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { state: "unavailable", message: `GitHub Actions недоступен: HTTP ${response.status}. Проверьте доступ; для закрытого репозитория нужен GITHUB_TOKEN с Actions: read.`, checkedAt: new Date().toISOString(), runs: [] };
      }
      const data = responseSchema.parse(await response.json());
      for (const run of data.workflow_runs) {
        if (run.head_sha !== headSha) continue;
        const url = new URL(run.html_url);
        if (url.origin !== "https://github.com" || url.pathname !== `/${repository}/actions/runs/${run.id}`) throw new Error("Неожиданный адрес запуска CI.");
        const key = `${run.workflow_id}:${run.event}`;
        const previous = latest.get(key);
        if (!previous || run.id > previous.id) latest.set(key, run);
      }
      if (page * 100 >= data.total_count || data.workflow_runs.length < 100) { complete = page * 100 >= data.total_count; break; }
    }
  } catch (cause) {
    signal.throwIfAborted();
    console.error("release_ci_failed", { repository, headSha, error: cause instanceof Error ? cause.name : "UnknownError" });
    return { state: "unavailable", message: deadline.aborted ? "Истёк таймаут GitHub Actions; результаты CI неизвестны." : "Не удалось получить корректные результаты GitHub Actions; проверки не подтверждены.", checkedAt: new Date().toISOString(), runs: [] };
  }
  const runs = [...latest.values()].sort((a, b) => b.id - a.id).map(run => ({ id: run.id, name: run.name ?? `Workflow ${run.workflow_id}`, url: run.html_url, status: run.status, conclusion: run.conclusion }));
  const failed = runs.some(run => run.status === "completed" && ["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"].includes(run.conclusion ?? ""));
  const state = failed ? "failed" : !complete ? "partial" : !runs.length ? "missing"
    : runs.some(run => run.status !== "completed") ? "pending" : runs.every(run => run.conclusion === "success") ? "success" : "partial";
  const messages = {
    failed: "Есть неуспешные запуски GitHub Actions для этого SHA.", partial: "CI подтверждён не полностью: есть пропуски, неизвестные результаты или достигнут лимит списка.",
    missing: "Запусков GitHub Actions для этого SHA нет. Проверки не подтверждены.", pending: "GitHub Actions ещё выполняется или ожидает запуска.",
    success: "Полученные запуски GitHub Actions для этого SHA успешны. Это не подтверждает полноту проверок релиза.",
  };
  return { state, message: messages[state], checkedAt: new Date().toISOString(), runs };
}
