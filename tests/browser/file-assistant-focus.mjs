/* global browser */
// Контролируемые ответы проверяют клавиатуру и интерфейс без повторных вызовов LLM.
const page = await browser.getPage("main");
const results = [];
for (const width of [1440, 390]) {
  await page.setViewport({ width, height: 900 });
  await page.goto("http://127.0.0.1:3000/day-34");
  await page.waitForFunction(() => !!document.querySelector("textarea"));
  await page.evaluate(() => {
    const original = window.fetch;
    const proposal = { id: "10000000-0000-4000-8000-000000000001", path: "docs/focus-check.md", baseHash: null,
      patch: "--- /dev/null\n+++ b/docs/focus-check.md\n@@ -0,0 +1 @@\n+# Проверка\n", status: "pending",
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    window.fetch = async (url, options) => {
      if (String(url) === "/api/file-assistant") {
        const events = [
          { type: "tool-start", callId: "focus", name: "propose_file", arguments: { path: proposal.path, baseHash: null, content: "# Проверка\n" } },
          { type: "tool-result", callId: "focus", result: { content: [], structuredContent: proposal, isError: false } },
          { type: "text", delta: "Документ подготовлен." }, { type: "done" },
        ];
        return new Response(events.map(event => JSON.stringify(event)).join("\n") + "\n");
      }
      if (String(url) === "/api/file-assistant/apply") return Response.json({ ...proposal, status: "applied" });
      return original(url, options);
    };
  });
  await page.focus("textarea"); await page.keyboard.type("Подготовь документ"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector("[aria-label='Остановить запрос']") && !!document.querySelector("section[aria-label='Изменение docs/focus-check.md']"));
  await page.focus("section[aria-label='Изменение docs/focus-check.md'] button");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("section[aria-label='Изменение docs/focus-check.md']")?.textContent.includes("Файл записан на диск"));
  const result = await page.evaluate(() => ({
    focus: document.activeElement?.textContent,
    overflow: document.documentElement.scrollWidth - innerWidth,
    small: [...document.querySelectorAll("button,a,textarea,summary")].filter(element => {
      if (element.closest("nextjs-portal")) return false;
      const box = element.getBoundingClientRect();
      return element.getClientRects().length > 0 && box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
    }).map(element => element.textContent.slice(0, 50)),
  }));
  if (result.focus !== "Файл записан на диск") throw new Error(`Фокус потерян после применения: ${result.focus?.slice(0, 100)}`);
  if (result.overflow > 0 || result.small.length) throw new Error(JSON.stringify(result));
  results.push({ width, ...result });
}
return results;
