# Day 8: токены и переполнение контекста

- Страница `/day-8` переиспользует постоянный чат Day 7 и добавляет token analytics rail на desktop и bottom sheet на mobile.
- `@huggingface/transformers` загружает только закоммиченные official tokenizer assets из `tokenizers/`; `env.allowRemoteModels = false`.
- Локальный preflight считает system, history, request и резерв ответа 4 096 токенов. Локальная разбивка — estimate; provider `prompt_tokens` и `completion_tokens` — источник истины.
- `ChatAgent` запрашивает provider usage через `stream_options.include_usage`; `PersistentChatAgent` атомарно сохраняет завершённый обмен и usage.
- SQLite содержит STRICT-таблицы `exchange_usage` и `overflow_runs`. Legacy-обмены Day 7 рассчитываются при чтении как `estimated` и не записываются обратно.
- Стоимость хранится целым числом micro-USD. Неизвестный cache split считается cache miss.
- Реальный overflow использует один запрос без retry к OpenRouter Embeddings, модель `nvidia/nemotron-3-embed-1b:free`, лимит 32 768 и детерминированный input больше лимита. Большой input и embedding vector не сохраняются и не логируются.
- Для overflow нужен только server-side `OPENROUTER_API_KEY` в `.env.local`; значение не должно попадать в логи или git.
- Проверенные реальные диалоги: short — provider prompt 92, completion 186; long follow-up — local history 4 882, суммарно provider prompt 9 942, completion 128, cost 1 744 micro-USD.
- Полный рестарт Next.js сохранил оба provider usage обмена длинного диалога и `historyTokens = 4 882`.
- Постоянные проверки: `npm run test:tokens` и `npm run test:persistence`.
