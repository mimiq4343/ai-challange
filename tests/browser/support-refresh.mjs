/* global browser */
// Управляемая задержка HTTP проверяет гонку refresh/отправки без вызова LLM.
const page = await browser.getPage("main");
await page.goto("http://127.0.0.1:3000/day-33?ticket=SUP-101");
await page.waitForFunction(() => !!document.querySelector("textarea"));
await page.evaluate(async () => {
  const original = window.fetch;
  const state = await (await original("/api/support/tickets/SUP-101")).json();
  let posts = 0, gets = 0;
  window.__supportOriginalFetch = original;
  window.fetch = async (url, options) => {
    if (String(url).endsWith("/SUP-101/messages") && options?.method === "POST") {
      posts++;
      if (posts === 1) return Response.json({ error: "Контролируемый сбой для проверки обновления" }, { status: 503 });
      return new Response('{"type":"text","delta":"Новый ответ"}\n{"type":"done"}\n', { headers: { "Content-Type": "application/x-ndjson" } });
    }
    if (String(url).endsWith("/tickets/SUP-101")) {
      gets++;
      if (gets === 1) return new Promise(resolve => { window.__supportReleaseRefresh = () => resolve(Response.json(state)); });
      return Response.json({ ...state, exchanges: [...state.exchanges, {
        id: (state.exchanges.at(-1)?.id ?? 0) + 1, question: "Новый вопрос после обновления", answer: "Новый ответ", sources: [], createdAt: new Date().toISOString(),
      }] });
    }
    return original(url, options);
  };
});
try {
  await page.focus("textarea"); await page.keyboard.type("Контролируемая ошибка"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => !!document.querySelector("section [role='alert'] button"));
  await page.evaluate(() => document.querySelector("section [role='alert'] button").click());
  await page.waitForFunction(() => typeof window.__supportReleaseRefresh === "function");
  await page.focus("textarea");
  await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
  await page.keyboard.type("Новый вопрос после обновления"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector("[aria-label='Остановить запрос']") && document.querySelector("ol[aria-label='История переписки']")?.textContent.includes("Новый вопрос после обновления"));
  await page.evaluate(async () => {
    window.__supportReleaseRefresh();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const retained = await page.evaluate(() => document.querySelector("ol[aria-label='История переписки']")?.textContent.includes("Новый вопрос после обновления"));
  if (!retained) throw new Error("Запоздалый refresh перезаписал новый сохранённый обмен");
  return { delayedRefreshIgnored: retained };
} finally {
  await page.evaluate(() => { window.fetch = window.__supportOriginalFetch; delete window.__supportOriginalFetch; delete window.__supportReleaseRefresh; });
  await page.reload();
}
