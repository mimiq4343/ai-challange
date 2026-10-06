# День 24: цитаты, источники и анти-галлюцинации

Реальный прогон: `2026-10-06T17:50:28.655Z`. Модель: `deepseek-v4-flash`.
Эмбеддинги: `Xenova/multilingual-e5-small`; индекс: `704cbc82-6152-4baf-aea1-3e717e0de440`.
Хеш корпуса: `ca840342cd19fb00bf59971981308b6eb23255c192810900b660a48a15a8867d`.

Настройки: 20 кандидатов, до 5 фрагментов в контексте, включительный порог
релевантности 6/10. Использован прежний снимок индекса Day 22 без переиндексации.
Пути, разделы, строки и chunk_id относятся к этому снимку; текущий README уже
может отличаться. Эталоны не передаются rewrite, reranker или генератору.

## Результаты

- Источники с source, section и chunkId: **10/10** ответов по корпусу.
- Непустые цитаты: **10/10** ответов по корпусу.
- Дословное совпадение с указанным чанком: **10/10**.
- Смысл ответа подтверждён цитатами по оценке судьи: **10/10**.
- Контрольный фрагмент найден среди использованных источников: **8/10**.
- Корректное «Не знаю» с уточнением вне корпуса: **2/2**.
- В обоих отказах источники и цитаты пустые; вызов генерации пропущен.
- Всего **167677 provider tokens**, включая проверку смысла.

| Вопрос | Источники | Цитаты | Дословно | Смысл подтверждён | Контрольный фрагмент |
| --- | ---: | ---: | --- | --- | --- |
| `sqlite-wal` | 2 | 2 | да | да | да |
| `sqlite-release` | 1 | 1 | да | да | да |
| `chat-history` | 1 | 1 | да | да | нет |
| `chat-completion` | 1 | 1 | да | да | нет |
| `summary-window` | 1 | 1 | да | да | да |
| `summary-request` | 1 | 1 | да | да | да |
| `token-count` | 1 | 1 | да | да | да |
| `task-approval` | 4 | 4 | да | да | да |
| `task-pause` | 2 | 2 | да | да | да |
| `mcp-auth` | 1 | 1 | да | да | да |
| `outside-delivery` | 0 | 0 | отказ | честный отказ | вне корпуса |
| `outside-harvest` | 0 | 0 | отказ | честный отказ | вне корпуса |

## Что гарантирует проверка

Сервер принимает только завершённый JSON с обязательными полями answer, status,
clarification, sources и quotes. Для содержательного ответа требуются ссылки
на известные источники и хотя бы одна дословная цитата из каждого указанного
чанка. Пути, разделы и chunkId должны совпадать с отобранным контекстом.
Выдуманные источники, изменённые цитаты, неизвестные ссылки, дубликаты, пустые
подтверждения, оборванные потоки и отсутствующий provider usage дают явную ошибку.

Если ни один кандидат не достиг порога, сервер возвращает «Не знаю» и просьбу
уточнить без генерации ответа. Если уже отобранный контекст не подтверждает
ответ, модель также может вернуть unknown с уточнением и пустыми подтверждениями.
Отклонённые фрагменты не используются как запасной контекст.

## Ограничения

Дословность и принадлежность цитат проверяются детерминированно. Семантическую
поддержку оценивает та же LLM, которая переписывает вопрос, ранжирует и отвечает;
это ориентировочная оценка, а не доказательство отсутствия любых галлюцинаций.
В обычном запросе проверка смысла отдельным судьёй не выполняется; она есть
в прогоне вопросов. Строгий формат сам по себе не доказывает смысловую связь.

На chat-history и chat-completion поиск не нашёл контрольный фрагмент реализации.
Ответы опираются на описание PersistentChatAgent в README и подтверждены им,
но не раскрывают вызов store.getMessages(conversationId) и механизмы ожидания
полного stream. Поэтому наличие источников и цитат не равно полноте ответа.
Для функций сжатия в чанках отсутствуют отдельные значения констант; ответы
сохраняют имена констант, не придумывая числа.

## Проверки реализации

- `npm run test:rag`: 45 тестов, включая прежние дни и новый контракт.
- ESLint всех изменённых TypeScript-файлов и `npx tsc --noEmit` прошли.
- Реальный CLI-прогон завершил 10 вопросов и 2 отрицательных контроля.
- Chromium: /day-24 на 1280×720 и 390×844, раскрытие источников и цитат,
  проверка несовместимых top-K, отправка через Ctrl+Enter, ответ и честный отказ.
- Отмена начатого через кнопку NDJSON-прогона проверена после HTTP 200 и
  появления блокировки: предыдущий отчёт не изменился побайтно, блокировка
  удалена, кнопки снова доступны.
- Проверенные элементы не меньше 44×44 px; горизонтального переполнения нет.
  При отправке вопроса не зарегистрировано ошибок страницы.
- /day-7: desktop и mobile, открытие панели диалогов, Escape и возврат фокуса;
  горизонтального переполнения нет.
- Browser Automation сначала был недоступен: отсутствовали библиотеки Chromium
  и шрифты. Временный runtime позволил завершить проверку в том же плагине;
  системные пакеты и зависимости проекта не устанавливались.
- Production build прошёл перед одобренным merge Day 23. Для Day 24 build
  не запускался: эта ветка пока не интегрируется в main.
- Advisor был вызван, но отключён в окружении и не выполнил ревью.
  Независимое ревью другим агентом выявило ссылки в clarification без источников
  и отмену во время фиксации отчёта. Обе проблемы воспроизведены падающими тестами
  и исправлены: уточнение проходит проверку ссылок, отменённая фиксация
  восстанавливает прежние байты или удаляет первый несостоявшийся отчёт.
  Повторная проверка этих исправлений замечаний не выявила.

## Ответы, источники и цитаты

### 1. Как в Flash Chat настроены внешние ключи и журнал SQLite при открытии базы?

Статус: `answered`. Контрольный ID: `sqlite-wal`.

При открытии базы в Flash Chat создаётся новый экземпляр DatabaseSync с timeout 5 000, после чего выполняются настройки: PRAGMA foreign_keys = ON и PRAGMA journal_mode = WAL [S1]. В README также указано, что SQLite работает в WAL-режиме и foreign keys включены [S2]. Кроме того, таблицы conversations и messages связаны через ON DELETE CASCADE [S2].

Источник [S1]: `src/lib/sqlite-database.ts` · раздел `openChatDatabase`.
chunk_id: `e1445723caaef61d55a3ed57a5e9b296ed58ad4584d61bfecc2cc63c20214d77`.

````text
  const database = new DatabaseSync(key, { timeout: 5_000 });
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
  `);
````

Источник [S2]: `README.md` · раздел `AI Advent Challenge #9 / SQLite и API Day 7–21`.
chunk_id: `1ab610497027486923d10a5073947fffe075be5b608d951f556ee836d5ffca9a`.

````text
История создаётся автоматически в `data/chat.sqlite`. SQLite работает в
WAL-режиме, foreign keys включены. Таблицы `conversations` и `messages` связаны
через `ON DELETE CASCADE`. SQLite, WAL и SHM исключены из git.
````

Проверка смысла: Все фактические утверждения ответа подтверждаются цитатами. S1 содержит `new DatabaseSync(key, { timeout: 5_000 })` и блок `PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;`, что подтверждает создание экземпляра с timeout 5000 и обе настройки PRAGMA. S2 подтверждает, что SQLite работает в WAL-режиме, foreign keys включены, а таблицы conversations и messages связаны через ON DELETE CASCADE. Ссылки на источники соответствуют процитированным фрагментам; противоречий, неверных отрицаний или чисел нет.

### 2. Когда в Flash Chat закрывается общее соединение SQLite после освобождения хранилища?

Статус: `answered`. Контрольный ID: `sqlite-release`.

Общее соединение SQLite закрывается при вызове `releaseChatDatabase`, когда после уменьшения числа владельцев не остаётся ни одного: тогда ключ удаляется из пула и вызывается `shared.database.close()` [S1].

Источник [S1]: `src/lib/sqlite-database.ts` · раздел `releaseChatDatabase`.
chunk_id: `ea423d28e95dc24d385cc649791be08abc7c3e848ccd7c16384e472d64eba445`.

````text


/**
 * Освобождает ссылку на соединение и закрывает его, когда владельцев не
 * осталось.
 */
export function releaseChatDatabase(databasePath: string): void {
  const pool = globalForDatabase.chatDatabases;
  const key = resolve(databasePath);
  const shared = pool?.get(key);
  if (!pool || !shared) return;

  shared.references -= 1;
  if (shared.references > 0) return;

  pool.delete(key);
  shared.database.close();
}

````

Проверка смысла: Цитата S1 подтверждает все утверждения ответа: в releaseChatDatabase число ссылок shared.references уменьшается на 1; если после этого references > 0, происходит возврат без закрытия; иначе ключ удаляется из пула (pool.delete(key)) и вызывается shared.database.close(). Формулировка ответа соответствует коду.

### 3. Откуда PersistentChatAgent в Flash Chat загружает историю перед отправкой нового сообщения модели?

Статус: `answered`. Контрольный ID: `chat-history`.

`PersistentChatAgent` перед каждым вызовом загружает сообщения выбранного диалога из SQLite [S1].

Источник [S1]: `README.md` · раздел `AI Advent Challenge #9 / Хронология / Day 7 · Сохранение контекста — страница `/day-7``.
chunk_id: `892fe4861c4c93e639a7498f53b6e5f02ea487aad1e440fb4247ea32ad8c24ea`.

````text
`PersistentChatAgent` перед каждым вызовом загружает сообщения выбранного
диалога из SQLite. Только после штатного завершения stream он одной транзакцией
сохраняет пару `user + assistant`; оборванный ответ не оставляет половину обмена.
````

Проверка смысла: Цитата S1 прямо подтверждает, что PersistentChatAgent перед каждым вызовом загружает сообщения выбранного диалога из SQLite. Ответ не содержит дополнительных неподтверждённых утверждений.

### 4. Как PersistentChatAgent в Flash Chat дожидается полного ответа LLM перед сохранением пары сообщений?

Статус: `answered`. Контрольный ID: `chat-completion`.

`PersistentChatAgent` перед каждым вызовом загружает сообщения выбранного диалога из SQLite, а пару `user + assistant` сохраняет только после штатного завершения stream — одной транзакцией; при оборванном ответе половина обмена не сохраняется [S1].

Источник [S1]: `README.md` · раздел `AI Advent Challenge #9 / Хронология / Day 7 · Сохранение контекста — страница `/day-7``.
chunk_id: `892fe4861c4c93e639a7498f53b6e5f02ea487aad1e440fb4247ea32ad8c24ea`.

````text
`PersistentChatAgent` перед каждым вызовом загружает сообщения выбранного
диалога из SQLite. Только после штатного завершения stream он одной транзакцией
сохраняет пару `user + assistant`; оборванный ответ не оставляет половину обмена.
````

Проверка смысла: Цитата S1 подтверждает все утверждения ответа: PersistentChatAgent перед каждым вызовом загружает сообщения выбранного диалога из SQLite; пару `user + assistant` сохраняет только после штатного завершения stream, одной транзакцией; при оборванном ответе половина обмена не сохраняется. Неподтверждённых фактических утверждений в ответе нет.

### 5. Как selectCompressionWindow в Flash Chat выбирает сообщения для сжатия и сохраняет хвост?

Статус: `answered`. Контрольный ID: `summary-window`.

В предоставленном фрагменте `selectCompressionWindow` принимает `messagesAfterCursor` и сначала вычисляет `minimumTailStart` как `Math.max(0, messagesAfterCursor.length - RAW_TAIL_MESSAGES)` [S1]. Если `minimumTailStart < SUMMARY_BATCH_MESSAGES`, функция возвращает пустой `batch` и `rawTail`, равный всему `messagesAfterCursor.slice()` [S1]. Иначе она формирует `batch` из первых `SUMMARY_BATCH_MESSAGES` сообщений через `messagesAfterCursor.slice(0, SUMMARY_BATCH_MESSAGES)` и `rawTail` из сообщений начиная с `minimumTailStart` через `messagesAfterCursor.slice(minimumTailStart)` [S1]. Таким образом, для сжатия выбирается `batch`, а хвост сохраняется в `rawTail` [S1].

Источник [S1]: `src/lib/history-compression.ts` · раздел `selectCompressionWindow`.
chunk_id: `c2de79095e55914a47beb40452333eea9631919c61abe254600ed3cca4b83835`.

````text


export function selectCompressionWindow(
  messagesAfterCursor: readonly StoredMessage[],
): CompressionWindow {
  const minimumTailStart = Math.max(
    0,
    messagesAfterCursor.length - RAW_TAIL_MESSAGES,
  );
  if (minimumTailStart < SUMMARY_BATCH_MESSAGES) {
    return { batch: [], rawTail: messagesAfterCursor.slice() };
  }

  return {
    batch: messagesAfterCursor.slice(0, SUMMARY_BATCH_MESSAGES),
    rawTail: messagesAfterCursor.slice(minimumTailStart),
  };
}
````

Проверка смысла: Ответ точно описывает код из цитаты S1: selectCompressionWindow принимает messagesAfterCursor, вычисляет minimumTailStart через Math.max(0, length - RAW_TAIL_MESSAGES), при minimumTailStart < SUMMARY_BATCH_MESSAGES возвращает пустой batch и rawTail = весь messagesAfterCursor.slice(), иначе формирует batch как первые SUMMARY_BATCH_MESSAGES сообщений и rawTail от minimumTailStart. Утверждение, что batch используется для сжатия, а rawTail сохраняет хвост, соответствует назначению возвращаемых полей. Числовые значения констант в ответе не утверждаются.

### 6. Как buildSummaryRequest в Flash Chat формирует запрос из предыдущего summary и пачки сообщений?

Статус: `answered`. Контрольный ID: `summary-request`.

`buildSummaryRequest` принимает `previousSummary: string | null` и `batch: readonly ChatMessage[]`, проверяет, что длина `batch` равна `SUMMARY_BATCH_MESSAGES`, и при несовпадении выбрасывает `RangeError` [S1]. Затем каждое сообщение из `batch` сериализуется через `JSON.stringify({ role, content })` [S1]. Возвращается строка, собранная через `join("\n")` из последовательности: строка `"PREVIOUS SUMMARY"`, `JSON.stringify(previousSummary)`, пустая строка, строка вида `` `NEXT ${SUMMARY_BATCH_MESSAGES} ORIGINAL MESSAGES` ``, затем сериализованные сообщения [S1].

Источник [S1]: `src/lib/history-compression.ts` · раздел `buildSummaryRequest`.
chunk_id: `881945d13c280c0b8d93640a165e18b44138628aaeddfa919e8dabb9023bdb4b`.

````text
export function buildSummaryRequest(
  previousSummary: string | null,
  batch: readonly ChatMessage[],
): string {
  if (batch.length !== SUMMARY_BATCH_MESSAGES) {
    throw new RangeError(`Summary batch должен содержать ${SUMMARY_BATCH_MESSAGES} сообщений.`);
  }

  const serializedMessages = batch.map(({ role, content }) =>
    JSON.stringify({ role, content }),
  );

  return [
    "PREVIOUS SUMMARY",
    JSON.stringify(previousSummary),
    "",
    `NEXT ${SUMMARY_BATCH_MESSAGES} ORIGINAL MESSAGES`,
    ...serializedMessages,
  ].join("\n");
}
````

Проверка смысла: Цитата S1 содержит полный код buildSummaryRequest. Все утверждения ответа соответствуют ей: сигнатура функции с previousSummary: string | null и batch: readonly ChatMessage[]; проверка batch.length !== SUMMARY_BATCH_MESSAGES с выбрасыванием RangeError; сериализация каждого сообщения через JSON.stringify({ role, content }); возврат join("\n") последовательности из "PREVIOUS SUMMARY", JSON.stringify(previousSummary), пустой строки, шаблона `NEXT ${SUMMARY_BATCH_MESSAGES} ORIGINAL MESSAGES` и сериализованных сообщений. Неподтверждённых фактов нет.

### 7. Как countTextTokens в Flash Chat считает токены текста без специальных токенов?

Статус: `answered`. Контрольный ID: `token-count`.

countTextTokens — асинхронная функция, которая принимает текст и имя токенизатора (по умолчанию DEEPSEEK_FLASH_PROFILE.tokenizer), получает токенизатор через getTokenizer, а затем возвращает длину результата tokenizer.encode(text, { add_special_tokens: false }), то есть считает токены без специальных токенов [S1].

Источник [S1]: `src/lib/token-counter.ts` · раздел `countTextTokens`.
chunk_id: `21584bf496f2733c950b130f44badf87f87c2d92a918613c1450b212384bda89`.

````text


export async function countTextTokens(
  text: string,
  tokenizerName: string = DEEPSEEK_FLASH_PROFILE.tokenizer,
): Promise<number> {
  const tokenizer = await getTokenizer(tokenizerName);
  return tokenizer.encode(text, { add_special_tokens: false }).length;
}
````

Проверка смысла: Цитата S1 содержит исходный код функции countTextTokens. В ней функция объявлена как async, принимает text и tokenizerName со значением по умолчанию DEEPSEEK_FLASH_PROFILE.tokenizer, получает токенизатор через await getTokenizer(tokenizerName) и возвращает длину результата tokenizer.encode(text, { add_special_tokens: false }). Все утверждения ответа соответствуют приведённому фрагменту, включая подсчёт токенов без специальных токенов.

### 8. Как автомат задач Flash Chat запрещает переход planning → execution без утверждённого плана?

Статус: `answered`. Контрольный ID: `task-approval`.

При переходе `planning → execution` автомат проверяет предусловие: в `checkPrecondition` для этой пары сначала проверяется условие `context.totalSteps === 0`, и при его выполнении возвращается причина «Плана нет: сначала составьте шаги задачи.» [S1]. Если шаги есть, но `context.planApproved` равно false, возвращается причина «План не утверждён: реализация начинается после утверждения.» [S1]. Эти данные приходят в автомат через `TransitionContext`, в котором есть поля `planApproved` и `totalSteps` [S5]. В `checkTransition` вызывается `checkPrecondition(...)`, и если предусловие вернуло непустую строку, переход получает `{ allowed: false, reason: precondition }`, то есть запрещается [S4]. В README предусловие этого перехода описано как «план непуст и утверждён человеком», а причины отказа — «Плана нет» / «План не утверждён» [S2].

Источник [S1]: `src/lib/task-machine.ts` · раздел `checkPrecondition`.
chunk_id: `fccdd42554d2945f492783128c268236ea50528ae85e66d8438d9e2f7ce47c6e`.

````text
  if (from === "planning" && to === "execution") {
    if (context.totalSteps === 0) {
      return "Плана нет: сначала составьте шаги задачи.";
    }
    if (!context.planApproved) {
      return "План не утверждён: реализация начинается после утверждения.";
    }
  }
````

Источник [S4]: `src/lib/task-machine.ts` · раздел `checkTransition`.
chunk_id: `f02bb60e615bafaf395eae5d55244dbe5000d1a0253334824a6c289dfed03cfc`.

````text
  const precondition = checkPrecondition(input.from, input.to, input.origin, input.context);
  if (precondition) return { allowed: false, reason: precondition };
````

Источник [S5]: `src/lib/task-machine.ts` · раздел `TransitionContext`.
chunk_id: `6852bfb72ea1f4bd684d4ce5cd8922dfa06734e17ec82bf21fc7b97d5bcd6527`.

````text
export type TransitionContext = {
  planApproved: boolean;
  totalSteps: number;
  openSteps: number;
};
````

Источник [S2]: `README.md` · раздел `AI Advent Challenge #9 / Хронология / Day 15 · Контролируемые переходы — страница `/day-15``.
chunk_id: `227eb7a590f928909632f0cc3bbf06e2dceaab4f28db8de71cf644ab1fdf602e`.

````text
| `планирование → выполнение` | план непуст и утверждён человеком | «Плана нет» / «План не утверждён» |
````

Проверка смысла: Все фактические утверждения подтверждаются цитатами. S1 дословно содержит ветку `if (from === "planning" && to === "execution")` с проверкой `context.totalSteps === 0` → «Плана нет: сначала составьте шаги задачи.» и затем `if (!context.planApproved)` → «План не утверждён: реализация начинается после утверждения.». S5 подтверждает, что `TransitionContext` содержит поля `planApproved` и `totalSteps`. S4 подтверждает вызов `checkPrecondition(...)` и возврат `{ allowed: false, reason: precondition }` при непустой строке-предусловии. S2 (README) подтверждает формулировки предусловия «план непуст и утверждён человеком» и причин отказа «Плана нет» / «План не утверждён». Утверждение «сначала проверяется totalSteps» корректно отражает порядок ветвей в S1. Нет неподтверждённых утверждений, отрицаний или чисел вне цитат.

### 9. Может ли агент Flash Chat менять этап задачи, пока человек поставил её на паузу?

Статус: `answered`. Контрольный ID: `task-pause`.

Нет, агент Flash Chat не может менять этап задачи, пока человек поставил её на паузу [S1][S2]. В проверке перехода при `paused` и origin агента возвращается запрет с причиной «Задача на паузе: переходы агента не применяются» [S1]. В описании указано, что пока задача приостановлена, любые переходы агента отклоняются, и двигать автомат снова может только человек [S2].

Источник [S1]: `src/lib/task-machine.ts` · раздел `checkTransition`.
chunk_id: `f02bb60e615bafaf395eae5d55244dbe5000d1a0253334824a6c289dfed03cfc`.

````text
  if (input.paused && input.origin === "agent") {
    return {
      allowed: false,
      reason: "Задача на паузе: переходы агента не применяются.",
    };
  }
````

Источник [S2]: `README.md` · раздел `AI Advent Challenge #9 / Хронология / Day 13 · Состояние задачи — страница `/day-13``.
chunk_id: `090a09df602a5402f68539b6eae7365fb0a84a4abc30789935b4d09f3bbfa52c`.

````text
Ключевая инварианта паузы: пока задача приостановлена, любые переходы агента
отклоняются — двигать автомат снова может только человек.
````

Проверка смысла: Утверждение ответа подтверждается цитатами: в S1 показан код checkTransition, который при input.paused и input.origin === "agent" возвращает allowed: false с причиной «Задача на паузе: переходы агента не применяются». В S2 прямо указано, что пока задача приостановлена, любые переходы агента отклоняются и двигать автомат снова может только человек. Ответ не содержит иных неподтверждённых фактов, чисел или условий.

### 10. Как Flash Chat проверяет Bearer-токен MCP-запроса и идентификатор профиля?

Статус: `answered`. Контрольный ID: `mcp-auth`.

Согласно контексту, проверка MCP-запроса выполняется функцией authorizeMcpRequest [S1]. Сначала проверяется expectedToken: если он отсутствует или не соответствует регулярному выражению /^[A-Za-z0-9_-]{32,256}$/, возвращается статус 503 с сообщением "MCP credentials are not configured" [S1]. Затем берётся заголовок authorization; ожидаемое значение — Buffer.from(`Bearer ${expectedToken}`) [S1]. Если authorization не является строкой, возвращается 401 "Unauthorized"; если длины не совпадают или timingSafeEqual(actual, expected) возвращает false, также возвращается 401 "Unauthorized" [S1]. Идентификатор профиля читается из заголовка x-flash-profile-id [S1]. Он должен быть строкой, соответствовать регулярному выражению /^[1-9]\d*$/ и значение Number(profile) должно быть безопасным целым числом; иначе возвращается 400 с сообщением "A valid profile identifier is required" [S1]. При успешной проверке возвращается объект { status: 200, profileId: Number(profile) } [S1].

Источник [S1]: `src/lib/mcp-auth.ts` · раздел `authorizeMcpRequest`.
chunk_id: `f4b4b94f925e7ab3c1747151781a0a0fad4a81304187250a676685e715081868`.

````text
export function authorizeMcpRequest(
  headers: IncomingHttpHeaders,
  expectedToken: string | undefined,
): McpAuthorization {
  if (!expectedToken || !/^[A-Za-z0-9_-]{32,256}$/.test(expectedToken)) {
    return { status: 503, message: "MCP credentials are not configured" };
  }
  const authorization = headers.authorization;
  const expected = Buffer.from(`Bearer ${expectedToken}`);
  if (typeof authorization !== "string") return { status: 401, message: "Unauthorized" };
  const actual = Buffer.from(authorization);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { status: 401, message: "Unauthorized" };
  }
  const profile = headers["x-flash-profile-id"];
  if (typeof profile !== "string" || !/^[1-9]\d*$/.test(profile) || !Number.isSafeInteger(Number(profile))) {
    return { status: 400, message: "A valid profile identifier is required" };
  }
  return { status: 200, profileId: Number(profile) };
}

````

Проверка смысла: Все утверждения ответа соответствуют приведённому фрагменту src/lib/mcp-auth.ts: проверка expectedToken и статус 503, сравнение заголовка authorization с Buffer.from(`Bearer ${expectedToken}`) и статус 401, проверка x-flash-profile-id по строке, регулярному выражению и Number.isSafeInteger с ошибкой 400, а также успешный возврат { status: 200, profileId: Number(profile) }. Неподтверждённых фактов нет.

### 11. Как в Flash Chat реализован расчёт стоимости доставки через DHL?

Статус: `unknown`. Контрольный ID: `outside-delivery`.

Не знаю: релевантность найденных фрагментов ниже порога.

Уточните, о какой функции, файле или сценарии Flash Chat идёт речь?

Источники и цитаты отсутствуют: корректный отказ.

Проверка смысла: Ответ имеет статус unknown и содержит отказ: «Не знаю» с просьбой уточнить, о какой функции, файле или сценарии Flash Chat идёт речь. Он не утверждает, что в корпусе есть или нет реализация расчёта доставки DHL, не приводит тарифы, API или алгоритм доставки. Цитат нет, но для честного отказа при status=unknown отсутствие источников и цитат допустимо. Фраза о релевантности найденных фрагментов ниже порога не является содержательным утверждением о реализации DHL и не требует подтверждения цитатами; неподтверждённых фактов об реализации нет.

### 12. Как Flash Chat прогнозирует урожай пшеницы на следующий год?

Статус: `unknown`. Контрольный ID: `outside-harvest`.

Не знаю: релевантность найденных фрагментов ниже порога.

Уточните, о какой функции, файле или сценарии Flash Chat идёт речь?

Источники и цитаты отсутствуют: корректный отказ.

Проверка смысла: Ответ имеет статус unknown, прямо сообщает «Не знаю» и просит уточнить, о какой функции, файле или сценарии Flash Chat идёт речь. В нём нет утверждений о наличии у Flash Chat модели, данных или алгоритма прогнозирования урожая пшеницы. Упоминание о низкой релевантности найденных фрагментов не является содержательным утверждением о проекте и не требует подтверждения цитатами. Отсутствие источников и цитат для честного отказа допускается.
