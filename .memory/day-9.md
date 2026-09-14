# Day 9: сжатие истории

- `/day-9` использует отдельный `CompressedChatAgent`; Day 7/8 остаются на full-history `PersistentChatAgent`.
- Полные `messages` неизменяемо остаются source of truth в SQLite. Summary checkpoints хранятся отдельно в `conversation_summaries`.
- `deepseek-v4-flash` обновляет summary блоками ровно по 10 сообщений с output limit 512. Ошибка summary останавливает основной запрос.
- Последние 10 сообщений гарантированно остаются несжатыми. Между checkpoint-ами raw buffer временно содержит до 19 сообщений, чтобы ни одно сообщение не выпадало из контекста.
- Provider usage — источник истины для operational savings. Summary overhead учитывается отдельно; judge usage не входит в net savings.
- Benchmark использует фиксированную историю из 20 сообщений и ровно четыре последовательных LLM-вызова без retry: summary, full, compressed, blind judge.
- Judge получает случайные A/B labels и обязан вернуть строгий JSON без Markdown и дополнительных ключей.
- Реальный benchmark: full prompt 403, compressed prompt 350, gross savings 53, summary overhead 574, net savings −521; judge выбрал compressed.
- Постоянные проверки: `npm run test:compression`, `npm run test:tokens`, `npm run test:persistence`, `npx tsc --noEmit`.
