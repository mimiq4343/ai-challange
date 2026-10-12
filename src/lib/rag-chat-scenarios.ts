export type RagChatScenario = { id: string; title: string; goal: string; turns: { content: string; requirements: string[]; expectUnknown: boolean }[] };

const historyGoal = "Проверить надёжность истории диалога Day 7";
const ragGoal = "Разобраться в RAG Flash Chat и подготовке контекста";

export const RAG_CHAT_SCENARIOS: readonly RagChatScenario[] = [
  { id: "history", title: "История: цель, ограничения и исправление термина", goal: historyGoal, turns: [
    { content: `Цель: ${historyGoal}. Откуда PersistentChatAgent загружает прошлые сообщения перед ответом?`, requirements: [], expectUnknown: false },
    { content: "Область разбора — только Day 7. Объясни, где хранится история и как включаются внешние ключи SQLite.", requirements: ["Область — Day 7"], expectUnknown: false },
    { content: "Ограничение: без замены SQLite и без новых зависимостей. Как openChatDatabase настраивает журнал?", requirements: ["Day 7", "Сохранить SQLite", "Без новых зависимостей"], expectUnknown: false },
    { content: "Зафиксируй термин: «обмен» пока означает одно сообщение пользователя. Когда сохраняется ответ PersistentChatAgent?", requirements: ["Day 7", "SQLite", "Без новых зависимостей", "обмен = одно сообщение пользователя"], expectUnknown: false },
    { content: "А при обрыве ответа?", requirements: ["Day 7", "SQLite", "Без новых зависимостей", "обмен = одно сообщение пользователя"], expectUnknown: false },
    { content: "Исправление термина: «обмен» означает пару user + assistant, а не одно сообщение. Как обеспечивается атомарность такого обмена?", requirements: ["Day 7", "SQLite", "Без новых зависимостей", "обмен = user + assistant"], expectUnknown: false },
    { content: "Теперь о соединении: когда releaseChatDatabase действительно закрывает общую базу?", requirements: ["Day 7", "SQLite", "Без новых зависимостей", "обмен = user + assistant"], expectUnknown: false },
    { content: "Уточнение: несколько хранилищ используют один WAL-файл. Что происходит, пока счётчик references больше нуля?", requirements: ["Day 7", "SQLite", "Без новых зависимостей", "обмен = user + assistant", "Несколько хранилищ используют один WAL-файл"], expectUnknown: false },
    { content: "Ненадолго отвлечёмся: какая погода завтра на Марсе?", requirements: ["Сохранить исходную цель при отвлечении", "обмен = user + assistant"], expectUnknown: true },
    { content: "Вернись к исходной цели. Что будет с сообщениями, если удалить диалог Day 7?", requirements: ["Day 7", "SQLite", "Без новых зависимостей", "обмен = user + assistant"], expectUnknown: false },
    { content: "Как проверить восстановление истории после перезапуска приложения? Только по имеющимся сведениям, без выдуманных результатов теста.", requirements: ["Day 7", "SQLite", "Без новых зависимостей", "обмен = user + assistant", "Не выдумывать результаты теста"], expectUnknown: false },
    { content: "Подведи итог нашей исходной цели: загрузка истории, завершение обмена, обрыв и удаление. Учитывай зафиксированные ограничения и исправленное определение обмена.", requirements: ["Day 7", "SQLite", "Без новых зависимостей", "обмен = user + assistant"], expectUnknown: false },
  ] },
  { id: "rag", title: "RAG: контекст, короткие продолжения и сохранение цели", goal: ragGoal, turns: [
    { content: `Цель: ${ragGoal}. Что делает режим RAG на странице Day 22 и откуда берёт сведения?`, requirements: [], expectUnknown: false },
    { content: "Ограничение: только сведения из документов Flash Chat, без внешних знаний. Чем отличается ответ с RAG от ответа без RAG?", requirements: ["Только документы Flash Chat", "Без внешних знаний"], expectUnknown: false },
    { content: "Зафиксируй термин: «контекст» — найденные фрагменты документов. Для чего ответы содержат ссылки на источники?", requirements: ["Документы Flash Chat", "контекст = найденные фрагменты"], expectUnknown: false },
    { content: "А если фрагменты не отвечают на вопрос?", requirements: ["Документы Flash Chat", "контекст = найденные фрагменты"], expectUnknown: false },
    { content: "Ограничение: эмбеддинги локальные, не предлагаем платный embedding API. Какая модель используется в Day 22?", requirements: ["Документы Flash Chat", "Локальные эмбеддинги", "Без платного embedding API"], expectUnknown: false },
    { content: "Уточнение: интересует подготовка контекста длинного диалога. Как selectCompressionWindow выбирает сообщения и оставляет хвост?", requirements: ["Сохранить цель RAG", "Документы Flash Chat", "Локальные эмбеддинги"], expectUnknown: false },
    { content: "Исправление определения: «контекст» здесь означает найденные фрагменты вместе с памятью задачи, а не весь архив сообщений. Как buildSummaryRequest использует предыдущий summary?", requirements: ["контекст = фрагменты + память задачи", "Не весь архив", "Документы Flash Chat"], expectUnknown: false },
    { content: "Как countTextTokens считает токены без специальных токенов?", requirements: ["контекст = фрагменты + память задачи", "Документы Flash Chat"], expectUnknown: false },
    { content: "Отвлечёмся: назови точную температуру на поверхности Марса завтра в полдень.", requirements: ["Сохранить цель RAG", "контекст = фрагменты + память задачи"], expectUnknown: true },
    { content: "Вернись к нашей цели. Что в сравнении Day 22 помогает понять пользу поиска по документам?", requirements: ["Цель RAG", "Документы Flash Chat", "Локальные эмбеддинги", "контекст = фрагменты + память задачи"], expectUnknown: false },
    { content: "Нужно ли считать любое косинусное сходство доказательством корректности ответа?", requirements: ["Документы Flash Chat", "Локальные эмбеддинги", "контекст = фрагменты + память задачи"], expectUnknown: false },
    { content: "Сформулируй итог по исходной цели: поиск, источники и подготовка контекста. Сохрани наши ограничения и актуальное значение термина «контекст».", requirements: ["Цель RAG", "Документы Flash Chat", "Локальные эмбеддинги", "Без платного embedding API", "контекст = фрагменты + память задачи"], expectUnknown: false },
  ] },
];
