# Этап 1. SQLite и persistent-agent

**Цель:** Создать проверяемое постоянное хранилище и агента, который восстанавливает историю перед LLM-вызовом.

**Вход:** [`00-overview.md`](./00-overview.md), утверждённая [спецификация](../../specs/2026-09-13-day-7-context-persistence-design.md).

**Результат:** Store переживает закрытие и повторное открытие БД; агент сохраняет только полностью завершённые обмены.

## Задача 1. SQLite conversation store

**Файлы:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `src/lib/conversation-types.ts`
- Create: `src/lib/conversation-store.ts`
- Create: `tests/conversation-store.test.ts`

- [ ] **1. Добавить совместимые Node typings и TypeScript test runner**

В `package.json` добавить `engines.node: ">=22.13.0"`, поднять `@types/node` до `^24`, добавить dev-зависимость `tsx` и команду:

```json
"test:persistence": "tsx --test tests/conversation-store.test.ts"
```

Команда:

```bash
npm install --save-dev @types/node@^24 tsx
```

Не обновлять остальные зависимости.

- [ ] **2. Исключить runtime-БД из git**

```gitignore
# Локальная история диалогов Day 7
data/*.sqlite
data/*.sqlite-shm
data/*.sqlite-wal
```

- [ ] **3. Создать общие типы**

Создать `src/lib/conversation-types.ts` с точными контрактами из `00-overview.md`.

- [ ] **4. Написать failing test восстановления**

`tests/conversation-store.test.ts` использует `mkdtemp`, `tmpdir` и `after` для очистки. Сценарий:

```ts
const first = new SqliteConversationStore(databasePath);
const conversation = first.createConversation();
first.saveExchange(
  conversation.id,
  "Запомни кодовое слово: КЕДР",
  "Запомнил кодовое слово: КЕДР",
);
first.close();

const restored = new SqliteConversationStore(databasePath);
assert.equal(restored.getConversation(conversation.id)?.title, "Запомни кодовое слово: КЕДР");
assert.deepEqual(
  restored.getMessages(conversation.id).map(({ role, content }) => ({ role, content })),
  [
    { role: "user", content: "Запомни кодовое слово: КЕДР" },
    { role: "assistant", content: "Запомнил кодовое слово: КЕДР" },
  ],
);
assert.equal(restored.deleteConversation(conversation.id), true);
assert.equal(restored.getConversation(conversation.id), null);
assert.deepEqual(restored.getMessages(conversation.id), []);
restored.close();
```

Запустить `npm run test:persistence`. Ожидается FAIL: модуль store ещё отсутствует.

- [ ] **5. Реализовать store**

`SqliteConversationStore` открывает `DatabaseSync(databasePath, { timeout: 5_000 })`, создаёт каталог через `mkdirSync(dirname(databasePath), { recursive: true })` и выполняет:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS messages_conversation_id_id
  ON messages(conversation_id, id);
```

Все значения связывать prepared statements. `saveExchange`:

```ts
this.database.exec("BEGIN IMMEDIATE");
try {
  insertMessage.run(conversationId, "user", userContent, timestamp);
  insertMessage.run(conversationId, "assistant", assistantContent, timestamp);
  updateConversation.run(title, timestamp, conversationId);
  this.database.exec("COMMIT");
} catch (error) {
  this.database.exec("ROLLBACK");
  throw error;
}
```

До транзакции проверить диалог и бросить `ConversationNotFoundError`. Заголовок: схлопнуть whitespace, `slice(0, 60)`, менять только при текущем названии «Новый диалог».

Production singleton:

```ts
const globalForStore = globalThis as typeof globalThis & {
  conversationStore?: SqliteConversationStore;
};

export function getConversationStore() {
  globalForStore.conversationStore ??= new SqliteConversationStore(
    join(process.cwd(), "data", "chat.sqlite"),
  );
  return globalForStore.conversationStore;
}
```


- [ ] **6. Проверить green и типы**

```bash
npm run test:persistence
npx tsc --noEmit
```

Ожидается: store-test PASS, TypeScript exit 0.

- [ ] **7. Зафиксировать store**

```bash
git add package.json package-lock.json .gitignore src/lib/conversation-types.ts src/lib/conversation-store.ts tests/conversation-store.test.ts
git commit -m "feat(day-7): persist conversations in SQLite"
```

## Задача 2. PersistentChatAgent

**Файлы:**

- Modify: `package.json`
- Create: `src/lib/persistent-chat-agent.ts`
- Create: `tests/persistent-chat-agent.test.ts`

- [ ] **1. Написать failing tests границы сохранения**

Тест A: fake LLM отдаёт `"КЕ"` и `"ДР"`; после полного чтения store содержит `user` и `assistant: "КЕДР"`.

Тест B: fake stream отдаёт `"КЕ"`, затем `controller.error(new Error("stream failed"))`; чтение отклоняется, `getMessages()` возвращает `[]`.

После создания файла обновить команду:

```json
"test:persistence": "tsx --test tests/conversation-store.test.ts tests/persistent-chat-agent.test.ts"
```

Запустить `npm run test:persistence`. Ожидается FAIL: `persistent-chat-agent.ts` отсутствует.

- [ ] **2. Реализовать PersistentChatAgent**

Конструктор принимает store и `Pick<ChatAgent, "respond">`. `respond` загружает сообщения, отображает их в `ChatMessage[]`, добавляет текущий user-ввод и вызывает LLM.

Ответ оборачивается `TransformStream`: каждый `Uint8Array` копируется в массив и передаётся клиенту; `flush` объединяет чанки одним выделением памяти, декодирует UTF-8 и вызывает `store.saveExchange`. Пустой полный ответ — ошибка, не запись.

```ts
const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
const merged = new Uint8Array(total);
let offset = 0;
for (const chunk of chunks) {
  merged.set(chunk, offset);
  offset += chunk.byteLength;
}
```

`fromEnvironment` композиционно использует `getConversationStore()` и `ChatAgent.fromEnvironment()`.

- [ ] **3. Проверить green**

```bash
npm run test:persistence
npx tsc --noEmit
```

Ожидается: оба файла тестов PASS; TypeScript exit 0.

- [ ] **4. Зафиксировать persistent-agent**

```bash
git add package.json src/lib/persistent-chat-agent.ts tests/persistent-chat-agent.test.ts
git commit -m "feat(day-7): restore context before LLM calls"
```
