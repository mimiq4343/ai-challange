import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseReleaseAnalysis, renderReleaseMarkdown, runRelease } from "../src/lib/release-agent";
import { applyFileProposal } from "../src/lib/file-assistant-files";
import { releaseAnalysis, releaseCi, releaseRepository, releaseSnapshot } from "./helpers/release";
import type { ReleaseEvent } from "../src/lib/release-types";

test("AI output rejects unknown evidence, behavior claims based only on commit titles, and empty analysis", () => {
  for (const analysis of [
    { ...releaseAnalysis, fixes: [{ text: "Change", sourceIds: ["F999"] }] },
    { ...releaseAnalysis, fixes: [{ text: "Change", sourceIds: ["C1"] }] },
    { ...releaseAnalysis, fixes: [], risks: [], checks: [] },
  ]) assert.throws(() => parseReleaseAnalysis(JSON.stringify(analysis), releaseSnapshot));
  assert.deepEqual(parseReleaseAnalysis(JSON.stringify(releaseAnalysis), releaseSnapshot), releaseAnalysis);
});

test("release markdown keeps CI evidence separate from AI recommendations and discloses skipped sources", () => {
  const text = renderReleaseMarkdown(releaseSnapshot, releaseCi, releaseAnalysis, "test-model", "2026-10-18T00:00:00.000Z");
  assert.match(text, /\[F1: src\/store\.ts\]/);
  assert.ok(text.includes(`https://github.com/owner/repo/blob/${"b".repeat(40)}/src/store.ts#L2`));
  assert.match(text, /\[ \] Проверить атомарное/);
  assert.match(text, /large\.json/); assert.match(text, /1\/2/);
  assert.match(text, /Проверки не подтверждены/);
});

test("completed release produces a guarded diff, and only Apply writes its exact markdown", async t => {
  const { root, git } = await releaseRepository(t);
  const events: ReleaseEvent[] = [];
  const report = await runRelease(root, { baseRef: "refs/heads/main", headRef: "HEAD" }, AbortSignal.timeout(10_000), event => events.push(event), {
    llm: { model: "test-model", respond: async () => ({ stream: new Response(JSON.stringify(releaseAnalysis)).body!, usage: Promise.resolve(null), finishReason: Promise.resolve("stop") }) },
    fetcher: async () => new Response(null, { status: 403 }),
  });
  assert.equal(report.ci.state, "unavailable");
  assert.equal(events.some(event => event.type === "ci"), true);
  assert.ok(report.proposal); assert.equal(report.proposalError, null);
  assert.equal(existsSync(join(root, report.proposal.path)), false);
  assert.equal(report.snapshot.headSha, git("rev-parse", "HEAD"));
  const applied = applyFileProposal(root, report.proposal.id);
  assert.equal(applied.status, "applied");
  assert.equal(readFileSync(join(root, applied.path), "utf8"), report.markdown);
});

test("unfinished model responses never create a release proposal", async t => {
  const { root } = await releaseRepository(t);
  await assert.rejects(runRelease(root, { baseRef: "refs/heads/main", headRef: "HEAD" }, AbortSignal.timeout(10_000), () => {}, {
    llm: { model: "test-model", respond: async () => ({ stream: new Response(JSON.stringify(releaseAnalysis)).body!, usage: Promise.resolve(null), finishReason: Promise.resolve("length") }) },
    fetcher: async () => Response.json({ total_count: 0, workflow_runs: [] }),
  }), /заверш/);
  assert.equal(existsSync(join(root, "data/file-assistant.sqlite")), false);
});

test("changing checkout during analysis preserves the report but prevents a proposal on the new branch", async t => {
  const { root, git } = await releaseRepository(t);
  const report = await runRelease(root, { baseRef: "refs/heads/main", headRef: "HEAD" }, AbortSignal.timeout(10_000), () => {}, {
    llm: { model: "test-model", respond: async () => {
      git("switch", "-qc", "other");
      return { stream: new Response(JSON.stringify(releaseAnalysis)).body!, usage: Promise.resolve(null), finishReason: Promise.resolve("stop") };
    } },
    fetcher: async () => Response.json({ total_count: 0, workflow_runs: [] }),
  });
  assert.match(report.markdown, /Подготовка релиза/);
  assert.equal(report.proposal, null); assert.match(report.proposalError!, /HEAD изменились/);
  assert.equal(existsSync(join(root, "data/file-assistant.sqlite")), false);
});

test("cancellation after model completion prevents all release file proposals", async t => {
  const { root } = await releaseRepository(t);
  const controller = new AbortController();
  await assert.rejects(runRelease(root, { baseRef: "refs/heads/main", headRef: "HEAD" }, controller.signal, () => {}, {
    llm: { model: "test-model", respond: async () => {
      controller.abort();
      return { stream: new Response(JSON.stringify(releaseAnalysis)).body!, usage: Promise.resolve(null), finishReason: Promise.resolve("stop") };
    } },
    fetcher: async () => Response.json({ total_count: 0, workflow_runs: [] }),
  }));
  assert.equal(existsSync(join(root, "data/file-assistant.sqlite")), false);
});

test("oversized generated Markdown remains downloadable when it exceeds the file proposal limit", async t => {
  const { root, git } = await releaseRepository(t);
  for (let index = 0; index < 8; index++) writeFileSync(join(root, `src/${"x".repeat(200)}-${index}.ts`), `export const value${index} = true;\n`);
  git("add", "."); git("commit", "-qm", "feat: files with long names");
  const items = Array.from({ length: 10 }, () => ({ text: "Изменение требует проверки.", sourceIds: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"] }));
  const analysis = { features: items, fixes: items, other: items, risks: items, checks: items, limitations: [] };
  const report = await runRelease(root, { baseRef: "refs/heads/main", headRef: "HEAD" }, AbortSignal.timeout(10_000), () => {}, {
    llm: { model: "test-model", respond: async () => ({ stream: new Response(JSON.stringify(analysis)).body!, usage: Promise.resolve(null), finishReason: Promise.resolve("stop") }) },
    fetcher: async () => Response.json({ total_count: 0, workflow_runs: [] }),
  });
  assert.ok(report.markdown.length > 64_000);
  assert.equal(report.proposal, null); assert.match(report.proposalError!, /лимит/);
  assert.equal(report.analysis.features.length, 10);
  assert.equal(existsSync(join(root, "data/file-assistant.sqlite")), false);
});
