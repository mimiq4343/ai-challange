/* global browser */
// Выполняется через bb browser-automation run после открытия /day-31 нужной ширины.
// Отправляет справку /help, один вопрос с LLM и проверяет вывод, фокус и раскладку.
const page = await browser.getPage("main");
if (new URL(page.url()).pathname !== "/day-31") throw new Error("Откройте /day-31 перед проверкой.");
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const layout = () => page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - window.innerWidth,
  small: [...document.querySelectorAll("button, a, textarea, summary")]
    .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44); })
    .map((element) => (element.getAttribute("aria-label") || element.textContent).trim().slice(0, 40)),
}));

async function replaceInput(text) {
  await page.focus("textarea[aria-label='Команда ассистенту']");
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.type(text);
}

async function waitForExchange(count) {
  await page.waitForFunction((expected) => {
    const items = document.querySelectorAll("ol[aria-live] > li article");
    return items.length >= expected && !document.querySelector("[aria-label='Остановить запрос']");
  }, { timeout: 110_000 }, count);
  return page.evaluate(() => {
    const article = [...document.querySelectorAll("ol[aria-live] > li article")].at(-1);
    return {
      text: article.textContent.slice(0, 300),
      error: article.querySelector("[role=alert]")?.textContent ?? null,
      sources: article.querySelectorAll("section[aria-label='Источники из документации'] details").length,
      unknown: /Ссылки без найденного фрагмента/.test(article.textContent),
      tools: article.closest("li").querySelectorAll("[aria-label='Вызовы MCP-инструментов'] details").length,
    };
  });
}

await page.waitForFunction(() => /day-31|detached/.test(document.querySelector("[aria-label='Текущая git-ветка по MCP']")?.textContent ?? ""), { timeout: 20_000 });
const branch = await page.evaluate(() => document.querySelector("[aria-label='Текущая git-ветка по MCP']").textContent);
const initial = await layout();

await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent === "/help").click());
const overview = await waitForExchange(1);
check(!overview.error && /Flash Dev/.test(overview.text) && overview.tools === 1 && !overview.unknown, `Справка /help: ${JSON.stringify(overview)}`);

await replaceInput("просто текст");
await page.keyboard.press("Enter");
const hint = await page.evaluate(() => document.querySelector("#assistant-input-hint").textContent);
const sent = await page.evaluate(() => document.querySelectorAll("ol[aria-live] > li article").length);
check(/Поддерживается команда \/help/.test(hint) && sent === 1, `Подсказка о команде: ${hint}; обменов ${sent}`);

await replaceInput("/help Какие таблицы SQLite хранят историю диалогов?");
await page.keyboard.press("Enter");
const answer = await waitForExchange(2);
check(!answer.error && answer.sources > 0 && answer.tools > 0 && !answer.unknown, `Ответ с источниками: ${JSON.stringify(answer)}`);
const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
check(focused === "Команда ассистенту", `Фокус после ответа: ${focused}`);
const final = await layout();
check(initial.overflow <= 0 && final.overflow <= 0, `Горизонтальная прокрутка: ${initial.overflow}/${final.overflow}`);
check(final.small.length === 0, `Цели меньше 44 px: ${final.small.join(", ")}`);
check(errors.length === 0, `Ошибки страницы: ${errors.join("; ")}`);
await page.shot({ type: "jpeg", maxEdge: 1280, quality: 70 });
return JSON.stringify({ branch, overview: overview.tools, answer, viewport: page.viewport() });
