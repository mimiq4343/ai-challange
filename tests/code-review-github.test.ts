import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReviewEvent, publishReviewComment } from "../src/lib/code-review-github";
import { CODE_REVIEW_CONFIG } from "../src/lib/code-review-config";

const event = { repository: "owner/repo", number: 32, baseSha: "a".repeat(40), headSha: "b".repeat(40) };
const payload = {
  number: 32, repository: { full_name: "owner/repo" },
  pull_request: { number: 32, base: { sha: event.baseSha, repo: { full_name: "owner/repo" } }, head: { sha: event.headSha } },
};
const current = { state: "open", head: { sha: event.headSha }, base: { sha: event.baseSha } };

test("event validation rejects mismatched repositories, PR numbers and refs instead of full SHAs", () => {
  assert.deepEqual(parseReviewEvent(payload, "owner/repo"), event);
  assert.throws(() => parseReviewEvent(payload, "attacker/repo"));
  assert.throws(() => parseReviewEvent({ ...payload, number: 33 }, "owner/repo"));
  assert.throws(() => parseReviewEvent({ ...payload, pull_request: { ...payload.pull_request, head: { sha: "main" } } }, "owner/repo"));
});

test("publication paginates and updates only this bot's existing review comment", async () => {
  let changed: { method: string; url: string; body: string } | undefined;
  const fetcher: typeof fetch = async (input, options) => {
    const url = String(input);
    assert.equal(new Headers(options?.headers).get("X-GitHub-Api-Version"), "2026-03-10");
    if (url.endsWith("/pulls/32")) return Response.json(current);
    if (new URL(url).searchParams.get("page") === "1") return Response.json(Array.from({ length: 100 }, (_, i) => ({
      id: i + 1, body: CODE_REVIEW_CONFIG.commentMarker, user: { login: "someone", type: "User" },
    })));
    if (new URL(url).searchParams.get("page") === "2") return Response.json([{ id: 101, body: `${CODE_REVIEW_CONFIG.commentMarker}\nold`, user: { login: "github-actions[bot]", type: "Bot" } }]);
    changed = { method: options!.method!, url, body: options!.body as string };
    return Response.json({ id: 101 });
  };
  assert.equal(await publishReviewComment(event, "new review", "fixture-token", fetcher), "updated");
  assert.deepEqual(changed, { method: "PATCH", url: "https://api.github.com/repos/owner/repo/issues/comments/101", body: '{"body":"new review"}' });
});

test("a first review creates one comment and newer heads or closed PRs are never overwritten", async () => {
  let created = 0;
  const fetcher: typeof fetch = async (input, options) => {
    if (String(input).endsWith("/pulls/32")) return Response.json(current);
    if (options?.method === "POST") { created++; return Response.json({ id: 1 }); }
    return Response.json([]);
  };
  assert.equal(await publishReviewComment(event, "review", "fixture-token", fetcher), "created");
  assert.equal(created, 1);
  for (const newer of [{ ...current, head: { sha: "c".repeat(40) } }, { ...current, state: "closed" }, { ...current, base: { sha: "c".repeat(40) } }]) {
    const staleFetcher: typeof fetch = async () => Response.json(newer);
    assert.equal(await publishReviewComment(event, "stale", "fixture-token", staleFetcher), "stale");
  }
});

test("GitHub failures and timeouts propagate without including credentials or response bodies", async () => {
  const rejected: typeof fetch = async () => new Response("sensitive provider body", { status: 403 });
  await assert.rejects(publishReviewComment(event, "review", "fixture-token", rejected), (error: Error) => {
    assert.match(error.message, /403/);
    assert.equal(error.message.includes("sensitive"), false);
    assert.equal(error.message.includes("fixture-token"), false);
    return true;
  });
  const timeout: typeof fetch = async () => { throw new DOMException("upstream timeout", "TimeoutError"); };
  await assert.rejects(publishReviewComment(event, "review", "fixture-token", timeout), /GitHub/);
});
