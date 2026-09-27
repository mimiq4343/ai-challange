import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { SqliteProfileStore } from "../src/lib/profile-store";
import { PipelineNotFoundError, SqlitePipelineStore } from "../src/lib/pipeline-store";
import { pipelineReportResponse } from "../src/lib/pipeline-http";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "flash-pipeline-"));
  const path = join(directory, "chat.sqlite");
  const reports = join(directory, "reports");
  const profiles = new SqliteProfileStore(path);
  const store = new SqlitePipelineStore(path, reports);
  const stores = [store];
  t.after(async () => { stores.forEach((item) => item.close()); profiles.close(); await rm(directory, { recursive: true, force: true }); });
  return { path, reports, profiles, store, stores, profileId: profiles.getActiveProfile().id };
}

const markdown = "  # Обзор\n\nНичего не найдено.\n\n";

test("immutable snapshots and exact UTF8 reports survive reopen and repeated save", async (t) => {
  const f = await fixture(t);
  const search = f.store.saveSearch(f.profileId, "несуществующий", []);
  const summary = f.store.saveSummary(f.profileId, search.searchResultId, markdown);
  const report = f.store.saveReport(f.profileId, summary.summaryId);
  assert.deepEqual(await readFile(join(f.reports, report.fileName)), Buffer.from(markdown));
  f.store.close();
  f.profiles.close();
  const reopened = new SqlitePipelineStore(f.path, f.reports);
  f.stores.push(reopened);
  assert.deepEqual(reopened.getSearch(f.profileId, search.searchResultId), search);
  assert.deepEqual(reopened.getSummary(f.profileId, summary.summaryId), summary);
  assert.deepEqual(reopened.saveReport(f.profileId, summary.summaryId), report);
  assert.deepEqual(reopened.listReports(f.profileId), [report]);
  const response = pipelineReportResponse(f.profileId, report.reportId, reopened);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.match(response.headers.get("Content-Disposition")!, /^attachment;/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(markdown));
});

test("foreign and unknown IDs cannot summarize, save, read or download", async (t) => {
  const { store, profiles, profileId } = await fixture(t);
  const foreign = profiles.createProfile({ name: "Другой" });
  const search = store.saveSearch(profileId, "test", []);
  const summary = store.saveSummary(profileId, search.searchResultId, markdown);
  const report = store.saveReport(profileId, summary.summaryId);
  for (const [owner, searchId, summaryId, reportId] of [
    [foreign.id, search.searchResultId, summary.summaryId, report.reportId],
    [profileId, randomUUID(), randomUUID(), randomUUID()],
  ] as const) {
    assert.equal(store.getSearch(owner, searchId), null);
    assert.equal(store.getSummary(owner, summaryId), null);
    assert.throws(() => store.saveSummary(owner, searchId, markdown), PipelineNotFoundError);
    assert.throws(() => store.saveReport(owner, summaryId), PipelineNotFoundError);
    assert.equal(store.getReportDownload(owner, reportId), null);
    assert.equal(pipelineReportResponse(owner, reportId, store).status, 404);
  }
  assert.deepEqual(store.listReports(foreign.id), []);
  assert.equal(pipelineReportResponse(profileId, "../chat.sqlite", store).status, 404);
  profiles.deleteProfile(profileId);
  assert.equal(store.getSearch(profileId, search.searchResultId), null);
  assert.equal(store.getSummary(profileId, summary.summaryId), null);
  assert.equal(store.getReportDownload(profileId, report.reportId), null);
});

test("report listing is newest first and bounded to twenty", async (t) => {
  const { store, profileId } = await fixture(t);
  const reports = [];
  for (let index = 0; index < 22; index++) {
    const search = store.saveSearch(profileId, `query-${index}`, []);
    const summary = store.saveSummary(profileId, search.searchResultId, markdown);
    reports.push(store.saveReport(profileId, summary.summaryId));
  }
  assert.deepEqual(store.listReports(profileId), reports.slice(2).reverse());
});

test("missing or modified report files cause explicit errors rather than false success", async (t) => {
  const { store, reports, profileId } = await fixture(t);
  const search = store.saveSearch(profileId, "test", []);
  const summary = store.saveSummary(profileId, search.searchResultId, markdown);
  const report = store.saveReport(profileId, summary.summaryId);
  const file = join(reports, report.fileName);
  await writeFile(file, "чужой текст");
  assert.throws(() => store.saveReport(profileId, summary.summaryId), /файл|Файл/);
  assert.throws(() => store.getReportDownload(profileId, report.reportId), /файл|Файл/);
  assert.equal(await readFile(file, "utf8"), "чужой текст");
  await unlink(file);
  assert.throws(() => store.saveReport(profileId, summary.summaryId));
});

test("empty and oversized summaries cannot become saved reports", async (t) => {
  const { store, profileId } = await fixture(t);
  const search = store.saveSearch(profileId, "test", []);
  for (const value of ["", "   ", "я".repeat(7000)]) {
    assert.throws(() => store.saveSummary(profileId, search.searchResultId, value));
  }
  assert.deepEqual(store.listReports(profileId), []);
});

test("filesystem failure leaves no successful report and does not overwrite an unrelated file", async (t) => {
  const { store, reports, profileId } = await fixture(t);
  const search = store.saveSearch(profileId, "test", []);
  const summary = store.saveSummary(profileId, search.searchResultId, markdown);
  await writeFile(reports, "чужой файл");
  assert.throws(() => store.saveReport(profileId, summary.summaryId));
  assert.deepEqual(store.listReports(profileId), []);
  assert.equal(await readFile(reports, "utf8"), "чужой файл");
  assert.deepEqual(store.getSummary(profileId, summary.summaryId), summary);
});
