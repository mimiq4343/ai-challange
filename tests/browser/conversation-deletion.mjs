/* global browser */
// Выполняется через bb browser-automation run после открытия /day-7 или /day-25.
// Создаёт и удаляет только собственные пустые диалоги. Остальные DELETE блокируются.
const page = await browser.getPage("main");
const url = page.url();
if (!/\/day-(7|25)$/.test(new URL(url).pathname)) throw new Error("Откройте /day-7 или /day-25 перед проверкой.");

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function click(label, activeOnly = false) {
  const snapshot = await page.snapshot();
  const candidates = snapshot.split("\n").filter((line) => line.includes(`button "${label}"`));
  for (const line of candidates) {
    const ref = line.match(/\[ref=(e\d+)\]/)?.[1];
    if (!ref) continue;
    if (activeOnly && !await (await page.ref(ref)).evaluate((element) => Boolean(element.closest("li")?.querySelector('[aria-current="page"]')))) continue;
    try {
      await page.click(`ref/${ref}`);
    } catch (cause) {
      const box = await (await page.ref(ref)).evaluate((element) => element.getBoundingClientRect().toJSON());
      throw new Error(`Кнопка «${label}» недоступна для клика: ${JSON.stringify(box)}`, { cause });
    }
    return;
  }
  throw new Error(`Не найдена кнопка: ${label}`);
}

async function createFixture() {
  return page.evaluate(async () => {
    const response = await fetch("/api/conversations", { method: "POST" });
    if (!response.ok) throw new Error(`Создание тестового диалога: ${response.status}`);
    return (await response.json()).conversation.id;
  });
}

async function beginFixture(id) {
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate((id) => {
    window.deletionTest = { id, mode: "live", errors: [], originalFetch: window.fetch.bind(window) };
    window.addEventListener("unhandledrejection", (event) => window.deletionTest.errors.push(String(event.reason)));
    window.fetch = async (input, init) => {
      const test = window.deletionTest;
      if (init?.method === "DELETE") {
        if (new URL(String(input), location.href).pathname !== `/api/conversations/${test.id}`) throw new Error("Удаление чужого диалога заблокировано тестом.");
        if (test.mode === "server") return Response.json({ error: "Не удалось удалить тестовый диалог." }, { status: 500 });
        if (test.mode === "network") throw new TypeError("Failed to fetch");
      }
      if (test.mode === "next" && !init?.method && new URL(String(input), location.href).pathname.startsWith("/api/conversations/")) {
        return Response.json({ error: "Не удалось загрузить следующий тестовый диалог." }, { status: 500 });
      }
      return test.originalFetch(input, init);
    };
  }, id);
  if (await page.evaluate(() => innerWidth < 1024)) {
    await click("Открыть список диалогов");
    await page.waitForFunction(() => document.getElementById("conversation-sidebar")?.getBoundingClientRect().left === 0, { timeout: 3_000 });
    check(await page.evaluate(() => document.activeElement === document.getElementById("conversation-sidebar").querySelector("button:not([disabled])")), "Drawer не передал фокус первой кнопке.");
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    check(await page.evaluate(() => document.activeElement === [...document.getElementById("conversation-sidebar").querySelectorAll("button:not([disabled])")].at(-1)), "Shift+Tab вышел за границы drawer.");
    await page.keyboard.press("Tab");
    check(await page.evaluate(() => document.activeElement === document.getElementById("conversation-sidebar").querySelector("button:not([disabled])")), "Tab не вернулся к первой кнопке drawer.");
  }
}

async function finishFixture(id) {
  await page.evaluate(async (id) => {
    if (window.deletionTest) window.fetch = window.deletionTest.originalFetch;
    const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new Error(`Очистка тестового диалога: ${response.status}`);
  }, id);
  await page.goto(url, { waitUntil: "networkidle0" });
}

async function confirm(expectedError = null) {
  await click("Удалить");
  await page.waitForFunction((expectedError) => {
    if (window.deletionTest.errors.length > 0) return true;
    if (expectedError === null) return !document.querySelector('[role="dialog"]');
    return document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes(expectedError);
  }, { timeout: 10_000 }, expectedError);
  const result = await page.evaluate(() => ({
    errors: window.deletionTest.errors,
    dialog: Boolean(document.querySelector('[role="dialog"]')),
    alert: document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? "",
  }));
  check(result.errors.length === 0, `Необработанная ошибка удаления: ${result.errors.join("; ")}`);
  return result;
}

const staleId = await createFixture();
try {
  await beginFixture(staleId);
  const before = await page.evaluate(() => document.querySelectorAll('[aria-label="Список диалогов"] li').length);
  await page.evaluate(async (id) => {
    const response = await window.deletionTest.originalFetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`Удаление во второй вкладке: ${response.status}`);
  }, staleId);
  await click("Удалить диалог «Новый диалог»", true);
  check(!(await confirm()).dialog, "Уже удалённый диалог остался в окне подтверждения.");
  check(await page.evaluate(() => document.querySelectorAll('[aria-label="Список диалогов"] li').length) === before - 1, "Уже удалённый диалог остался в списке.");
} finally {
  await finishFixture(staleId);
}

const retryId = await createFixture();
try {
  await beginFixture(retryId);
  await click("Удалить диалог «Новый диалог»", true);
  await page.evaluate(() => { window.deletionTest.mode = "server"; });
  const serverFailure = await confirm("Не удалось удалить тестовый диалог.");
  check(serverFailure.dialog && serverFailure.alert.includes("Не удалось удалить тестовый диалог."), "Ошибка сервера должна отображаться внутри открытого окна удаления.");
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    targets: [...document.querySelectorAll('[role="dialog"] button')].map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
  }));
  check(!layout.overflow && layout.targets.every(({ width, height }) => width >= 44 && height >= 44), "Окно ошибки удаления должно помещаться в экран и сохранять кнопки минимум 44×44.");
  await page.evaluate(() => { window.deletionTest.mode = "network"; });
  const networkFailure = await confirm("Проверьте соединение");
  check(networkFailure.dialog && networkFailure.alert.length > 0, "Сетевая ошибка должна позволять повторное удаление.");
  check(await page.evaluate(async (id) => (await window.deletionTest.originalFetch(`/api/conversations/${id}`)).status === 200, retryId), "Неудачная попытка удалила диалог.");
  await page.evaluate(() => { window.deletionTest.mode = "live"; });
  check(!(await confirm()).dialog, "Окно не закрылось после успешного повторного удаления.");
  check(await page.evaluate(async (id) => (await window.deletionTest.originalFetch(`/api/conversations/${id}`)).status === 404, retryId), "Диалог не удалён на сервере.");
} finally {
  await finishFixture(retryId);
}

const nextId = await createFixture();
try {
  await beginFixture(nextId);
  await click("Удалить диалог «Новый диалог»", true);
  await page.evaluate(() => { window.deletionTest.mode = "next"; });
  check(!(await confirm()).dialog, "Сбой загрузки следующего диалога не должен отменять успешное удаление.");
  check(await page.evaluate(() => document.body.innerText.includes("Не удалось загрузить следующий тестовый диалог.")), "Сбой следующего диалога не показан в рабочей области.");
  check(await page.evaluate(async (id) => (await window.deletionTest.originalFetch(`/api/conversations/${id}`)).status === 404, nextId), "Диалог не удалён после сбоя загрузки следующего.");
} finally {
  await finishFixture(nextId);
}

console.log({ route: new URL(url).pathname, viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), staleDelete: "passed", serverFailure: "passed", networkFailure: "passed", retry: "passed", nextLoadFailure: "passed", dialogLayout: "passed" });
