# Day 7: постоянный контекст

- Страница `/day-7` поддерживает несколько независимых диалогов, desktop sidebar и mobile drawer.
- История хранится в `data/chat.sqlite` через встроенный `node:sqlite`; SQLite, WAL и SHM исключены из git.
- `SqliteConversationStore` хранит `conversations` и `messages` в STRICT-таблицах с foreign keys и `ON DELETE CASCADE`.
- `PersistentChatAgent` восстанавливает историю перед вызовом существующего `ChatAgent` и сохраняет только полностью завершённую пару `user + assistant`.
- Оборванный или ошибочный stream не изменяет сохранённую историю.
- `/api/conversations` и вложенные маршруты обслуживают list, create, detail, delete и send. Day 6 продолжает использовать `/api/chat` без изменений.
- Практическая проверка подтвердила: после полного рестарта Next.js агент вспомнил кодовое слово из SQLite; удалённый диалог после следующего рестарта не восстановился.
- Постоянные тесты запускаются командой `npm run test:persistence`.
