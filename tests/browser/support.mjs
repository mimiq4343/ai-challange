/* global browser */
// Запуск через bb browser-automation run на /day-33 при нужной ширине окна.
const page = await browser.getPage("main");
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
const check = (condition, message) => { if (!condition) throw new Error(message); };
await page.waitForFunction(() => !!document.querySelector("textarea[aria-label='Вопрос поддержке']"));
const initial = await page.evaluate(() => ({
  count: document.querySelectorAll("ol[aria-label='История переписки'] > li").length,
  ticket: document.querySelector("section[aria-label='Переписка по тикету'] h2")?.textContent,
}));
await page.focus("textarea[aria-label='Вопрос поддержке']");
await page.keyboard.type("Почему это происходит и что делать дальше?");
await page.keyboard.press("Enter");
await page.waitForFunction(count => !document.querySelector("[aria-label='Остановить запрос']") &&
  (document.querySelectorAll("ol[aria-label='История переписки'] > li").length > count || !!document.querySelector("section[aria-label='Переписка по тикету'] [role='alert']")), { timeout: 110_000 }, initial.count);
const result = await page.evaluate(() => {
  const last = [...document.querySelectorAll("ol[aria-label='История переписки'] > li")].at(-1);
  return { answer: last?.querySelector("article .prose")?.textContent,
    sources: last?.querySelectorAll("section[aria-label='Источники ответа'] details").length,
    error: document.querySelector("section[aria-label='Переписка по тикету'] [role='alert']")?.textContent,
    tools: [...document.querySelectorAll("details[aria-label='Вызовы MCP-инструментов'] details summary")].map(element => element.textContent),
    focus: document.activeElement?.getAttribute("aria-label"),
    overflow: document.documentElement.scrollWidth - innerWidth,
    small: [...document.querySelectorAll("button, a, textarea, summary")].filter(element => {
      if (element.closest("nextjs-portal")) return false;
      const box = element.getBoundingClientRect();
      return element.getClientRects().length > 0 && box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
    }).map(element => element.getAttribute("aria-label") || element.textContent.slice(0, 50)),
  };
});
check(!result.error, `Ошибка ответа: ${result.error}`);
check(result.answer && result.sources > 0, "Нет ответа с источниками");
check(result.tools.some(text => text.includes("get_ticket")) && result.tools.some(text => text.includes("search_knowledge")), "Нет вызовов MCP");
check(result.focus === "Вопрос поддержке", `Фокус: ${result.focus}`);
check(result.overflow <= 0, `Горизонтальная прокрутка: ${result.overflow}`);
check(result.small.length === 0, `Маленькие элементы: ${result.small.join(", ")}`);
check(errors.length === 0, errors.join("; "));
await page.reload();
await page.waitForFunction(count => document.querySelectorAll("ol[aria-label='История переписки'] > li").length > count, { timeout: 20_000 }, initial.count);
return JSON.stringify({ ...result, ticket: initial.ticket, restoredAfterReload: true, viewport: page.viewport() });
