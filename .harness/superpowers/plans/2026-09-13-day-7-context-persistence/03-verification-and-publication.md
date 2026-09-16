# Этап 3. Документация, рестарт и публикация

**Цель:** Документировать Day 7 и доказать сохранение контекста полным рестартом приложения.

**Вход:** Завершённый [`02-api-and-interface.md`](./02-api-and-interface.md).

**Результат:** Все проверки проходят; агент вспоминает кодовое слово после остановки и нового запуска процесса; удалённый диалог не возвращается.

## Задача 5. README Day 7

**Файл:** Modify `README.md`.

- [ ] **1. Обновить branch README**

Сохранить автора и AI Advent Challenge #9. Описать:

```text
Browser → conversation API → PersistentChatAgent → SQLite history
                                      │
                                      └→ ChatAgent → LLM
```

Указать:

- Node.js >=22.13;
- `npm install`, `.env.local`, `npm run dev`;
- страницу `http://localhost:3000/day-7`;
- файл `data/chat.sqlite` и его gitignored-статус;
- `npm run test:persistence`;
- пять API-операций;
- атомарное сохранение законченного обмена;
- практический сценарий остановки и повторного запуска.

- [ ] **2. Проверить и закоммитить README**

```bash
git diff --check
git add README.md
git commit -m "docs(day-7): document persistent conversations"
```

## Задача 6. Полное доказательство восстановления

- [ ] **1. Запустить статические и постоянные проверки**

```bash
npm run test:persistence
npm run lint -- src/lib/conversation-types.ts src/lib/conversation-store.ts src/lib/persistent-chat-agent.ts src/app/api/conversations/route.ts src/app/api/conversations/[id]/route.ts src/app/api/conversations/[id]/messages/route.ts src/components/conversation-sidebar.tsx src/components/conversation-workspace.tsx src/app/day-7/page.tsx src/components/site-header.tsx
npx tsc --noEmit
git diff --check
```

Ожидается: все tests PASS; lint, typecheck и whitespace check — exit 0.

- [ ] **2. Начать проверочный диалог**

Запустить `npm run dev` через managed process. Открыть `http://localhost:3000/day-7` при 1440×1000. Создать диалог и отправить:

```text
Запомни кодовое слово: КЕДР. Ответь только «Запомнил».
```

Дождаться конца stream. В UI должны быть user-сообщение и законченный assistant-ответ. Фокусированным Node/SQLite-запросом подтвердить две строки в БД выбранного диалога.

- [ ] **3. Полностью перезапустить приложение**

Остановить managed Next.js process и убедиться, что прежний process завершён. Запустить новый `npm run dev`. Открыть `/day-7` в новой browser page. Sidebar должен содержать прежний диалог, чат — оба сообщения без повторного ввода.

- [ ] **4. Доказать восстановленный LLM-контекст**

Отправить:

```text
Какое кодовое слово я просил запомнить? Ответь одним словом.
```

Дождаться ответа и проверить наличие `КЕДР`. Это доказывает, что история загружена в LLM-вызов, а не только нарисована в UI.

- [ ] **5. Проверить удаление через второй рестарт**

Удалить активный диалог через confirmation UI. Убедиться, что он исчез. Ещё раз остановить и запустить Next.js; после reload удалённые ID и title не должны вернуться.

- [ ] **6. Проверить responsive и accessibility**

При 375×812:

- `document.documentElement.scrollWidth === document.documentElement.clientWidth`;
- drawer открывается menu-button;
- выбор строки закрывает drawer;
- Escape закрывает drawer и confirmation;
- create/delete/menu controls имеют accessible names;
- bounding boxes интерактивных кнопок не меньше 44×44 px.

При 1440×1000 sidebar и чат видим одновременно. Сделать визуальные screenshots до и после ответа, проверить отсутствие наложений и обрезанного текста.

- [ ] **7. Финальная проверка репозитория**

```bash
git status --short
git diff --check
```

Удалить временные screenshots и тестовые БД вне `data/*.sqlite*`. Runtime-БД оставить локально и gitignored. Если проверка потребовала исправление, повторить затронутые команды и создать отдельный scoped commit; пустой commit не создавать.

- [ ] **8. Опубликовать ветку по запросу владельца**

Перед push повторно выполнить проверки шага 1. Затем:

```bash
git push -u origin day-7
```

Ссылку ветки формировать из фактического `git remote get-url origin` и подтверждать через `git ls-remote --heads origin day-7`.
