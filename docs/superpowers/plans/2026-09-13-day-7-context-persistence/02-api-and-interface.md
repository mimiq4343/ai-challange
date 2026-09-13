# Этап 2. API и многодиалоговый интерфейс

**Цель:** Открыть persistent-agent через REST API и построить responsive workspace со списком диалогов.

**Вход:** Завершённый [`01-storage-and-agent.md`](./01-storage-and-agent.md).

**Результат:** `/day-7` создаёт, переключает и удаляет диалоги; запросы идут с server-side SQLite-контекстом.

## Задача 3. Conversation API

**Файлы:**

- Create: `src/app/api/conversations/route.ts`
- Create: `src/app/api/conversations/[id]/route.ts`
- Create: `src/app/api/conversations/[id]/messages/route.ts`

- [ ] **1. Реализовать список и создание**

`GET /api/conversations`:

```ts
return Response.json({ conversations: store.listConversations() });
```

`POST /api/conversations`:

```ts
return Response.json(
  { conversation: store.createConversation() },
  { status: 201 },
);
```

Не подменять ошибку БД пустым списком. На boundary вернуть HTTP 500 с явным сообщением.

- [ ] **2. Реализовать detail и delete**

Next.js 16 передаёт dynamic params как Promise:

```ts
export async function GET(
  _request: Request,
  context: RouteContext<"/api/conversations/[id]">,
) {
  const { id } = await context.params;
}
```

При отсутствующем диалоге вернуть `404 { error: "Диалог не найден." }`. `GET` возвращает `{ conversation, messages }`. `DELETE` удаляет через store и возвращает `new Response(null, { status: 204 })`.

- [ ] **3. Реализовать message route**

Принять `{ content }`; нестроковое или пустое после trim значение — HTTP 400. Вызвать:

```ts
const agent = PersistentChatAgent.fromEnvironment();
const stream = await agent.respond(id, content.trim(), request.signal);
```

Ответ:

```ts
return new Response(stream, {
  headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});
```

`ConversationNotFoundError` → 404, configuration error → 500, provider error → 502, `AbortError` пробрасывается.

- [ ] **4. Проверить API типы**

Запустить LSP diagnostics для трёх route-файлов, затем:

```bash
npx tsc --noEmit
```

Ожидается: без diagnostics, exit 0.

- [ ] **5. Зафиксировать API**

```bash
git add src/app/api/conversations
git commit -m "feat(day-7): expose conversation API"
```

## Задача 4. Sidebar и workspace

**Файлы:**

- Create: `src/components/conversation-sidebar.tsx`
- Create: `src/components/conversation-workspace.tsx`
- Create: `src/app/day-7/page.tsx`
- Modify: `src/components/site-header.tsx`

**Sidebar contract:**

```ts
type ConversationSidebarProps = {
  conversations: ConversationSummary[];
  activeId: string | null;
  disabled: boolean;
  open: boolean;
  onClose(): void;
  onCreate(): void;
  onSelect(id: string): void;
  onDelete(id: string): void;
};
```

- [ ] **1. Реализовать responsive sidebar**

Desktop: `w-72 shrink-0`, кнопка «Новый диалог», список по `updatedAt`, активный row, подпись «SQLite · автосохранение».

Mobile: fixed drawer + backdrop + кнопка закрытия. Escape закрывает drawer. Использовать Phosphor `Plus`, `Trash`, `Database`, `X`; без emoji.

Каждый row и icon-button — минимум 44 px. Delete button имеет `aria-label={\`Удалить диалог «${title}»\`}` и не вызывает выбор строки.

Подтверждение удаления содержит название, «Отмена» и destructive «Удалить». Строка исчезает только после успешного HTTP 204.

- [ ] **2. Реализовать состояние workspace**

`ConversationWorkspace` принимает `initialConversations`, `initialDetail`, `model`. Начальный fetch в `useEffect` запрещён: данные уже пришли из Server Component.

Точные операции:

```ts
createConversation(): Promise<ConversationSummary>
loadConversation(id: string): Promise<ConversationDetail>
deleteConversation(id: string): Promise<void>
refreshConversations(): Promise<ConversationSummary[]>
send(content: string): Promise<void>
```

`send` при пустом списке сначала создаёт диалог, затем POST-ит только `{ content }`. UI оптимистично добавляет user и пустой assistant bubble, читает text stream и обновляет только последний assistant bubble. После завершения обновляет sidebar с сервера.

При ошибке повторно получает активный detail из SQLite, возвращает input и показывает явную ошибку. `AbortController` отменяется на unmount. Во время stream создание, выбор и удаление disabled; stop остаётся доступен.

Сохранить Markdown через `react-markdown` + `remark-gfm`, auto-scroll, Enter-to-send, Shift+Enter, textarea resize и focus states из `Chat`.

- [ ] **3. Реализовать Server Component `/day-7`**

```ts
const store = getConversationStore();
const initialConversations = store.listConversations();
const active = initialConversations[0] ?? null;
const initialDetail = active
  ? { conversation: active, messages: store.getMessages(active.id) }
  : null;
```

Передать данные в workspace. Добавить metadata, компактный заголовок Day 7 и full-height рабочую область. Не создавать диалог во время server render.

- [ ] **4. Добавить Day 7 в навигацию**

Сначала LSP references для `SiteHeader`, затем добавить:

```ts
{ href: "/day-7", label: "Day 7" }
```

Предыдущие ссылки сохранить.

- [ ] **5. Проверить интерфейс статически**

```bash
npm run lint -- src/components/conversation-sidebar.tsx src/components/conversation-workspace.tsx src/app/day-7/page.tsx src/components/site-header.tsx
npx tsc --noEmit
```

Ожидается: обе команды exit 0.

- [ ] **6. Зафиксировать интерфейс**

```bash
git add src/components/conversation-sidebar.tsx src/components/conversation-workspace.tsx src/app/day-7/page.tsx src/components/site-header.tsx
git commit -m "feat(day-7): add persistent chat workspace"
```
