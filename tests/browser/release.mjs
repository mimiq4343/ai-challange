/* global browser */
// Ответы контролируются: повторная проверка интерфейса не вызывает LLM и не пишет файлы.
const page = await browser.getPage("main");
const results = [];
for (const width of [1440, 390]) {
  await page.setViewport({ width, height: 1000 });
  await page.goto("http://127.0.0.1:3000/day-35");
  await page.waitForFunction(() => document.querySelector("select")?.options.length > 0);
  await page.evaluate(() => {
    const original = window.fetch;
    window.__releaseMode = "result";
    const proposal = { id: "10000000-0000-4000-8000-000000000035", path: "docs/releases/browser-check.md", baseHash: null,
      patch: "--- /dev/null\n+++ b/docs/releases/browser-check.md\n@@ -0,0 +1 @@\n+# Релиз\n", status: "pending",
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const report = {
      snapshot: { repository: "owner/repo", baseRef: "main", headRef: "HEAD", baseSha: "a".repeat(40), headSha: "b".repeat(40),
        totalFiles: 1, commitsTruncated: false, commits: [{ id: "C1", sha: "b".repeat(40), subject: "Изменение" }],
        files: [{ id: "F1", path: "src/store.ts", status: "M", side: "head", line: 1, patch: "@@ -1 +1 @@\n-old\n+new\n" }], skipped: [] },
      ci: { state: "missing", message: "Проверки не подтверждены.", checkedAt: new Date().toISOString(), runs: [] },
      analysis: { features: [{ text: "Изменение", sourceIds: ["F1"] }], fixes: [], other: [], risks: [], checks: [{ text: "Проверить", sourceIds: ["F1"] }], limitations: [] },
      model: "test", markdown: "# Релиз\n\n## Изменения\n\nОписание реального diff.\n", createdAt: new Date().toISOString(), proposal, proposalError: null,
    };
    window.fetch = async (url, options) => {
      if (String(url) === "/api/release") {
        if (window.__releaseMode === "pending") return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true }));
        if (window.__releaseMode === "truncated") return new Response(JSON.stringify({ type: "progress", message: "Начало" }) + "\n");
        if (window.__releaseMode === "oversized") return new Response(JSON.stringify({ type: "result", report: { ...report,
          proposal: null, proposalError: "Markdown превышает лимит предложения файла.", markdown: "# Релиз\n\n" + "Длинный отчёт. ".repeat(6_000),
        } }) + "\n");
        return new Response(JSON.stringify({ type: "result", report }) + "\n");
      }
      if (String(url) === "/api/file-assistant/apply") return Response.json({ ...proposal, status: "applied" });
      return original(url, options);
    };
    const select = document.querySelector("[aria-label='База релиза']");
    select.value = "refs/heads/day-33";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.focus("button[type=submit]"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[role=status]")?.textContent === "Отчёт подготовлен");
  const focusAfterRun = await page.evaluate(() => document.activeElement?.textContent);
  if (focusAfterRun !== "Отчёт подготовлен") throw new Error(`Фокус после подготовки: ${focusAfterRun}`);
  await page.focus("section[aria-label='Изменение docs/releases/browser-check.md'] button");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("section[aria-label='Изменение docs/releases/browser-check.md'] [role=status]")?.textContent === "Файл записан на диск");
  const dimensions = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth, focus: document.activeElement?.textContent,
    small: [...document.querySelectorAll("main button,main select,main summary,nav button,nav a")].filter(element => {
      const box = element.getBoundingClientRect();
      return element.getClientRects().length > 0 && box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
    }).map(element => element.textContent.slice(0, 50)),
  }));
  if (dimensions.overflow > 0 || dimensions.small.length || dimensions.focus !== "Файл записан на диск") throw new Error(JSON.stringify(dimensions));
  await page.evaluate(() => { window.__releaseMode = "truncated"; });
  await page.focus("button[type=submit]"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("main [role=alert]")?.textContent.includes("оборвался"));
  await page.evaluate(() => { window.__releaseMode = "pending"; });
  await page.focus("button[type=submit]"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll("main button")].some(button => button.textContent === "Остановить"));
  await page.focus("form > button[type=button]"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[role=status]")?.textContent.includes("остановлена"));
  await page.evaluate(() => { window.__releaseMode = "oversized"; });
  await page.focus("button[type=submit]"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("main [role=alert]")?.textContent.includes("лимит"));
  const downloadable = await page.evaluate(() => {
    const link = document.querySelector("main a[download]");
    return !!link && decodeURIComponent(link.getAttribute("href")).length > 64_000 && !document.querySelector("section[aria-label^='Изменение docs/releases/']");
  });
  if (!downloadable) throw new Error("Большой отчёт потерян вместо скачивания без Apply");
  results.push({ width, ...dimensions, truncated: "explicit error", cancel: "stopped", oversized: "downloadable without Apply" });
}
console.log(results);
