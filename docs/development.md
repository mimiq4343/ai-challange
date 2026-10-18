# Разработка

## Окружение

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Нужен Node.js 22.13 или новее. Переменные `.env.local` читаются только сервером.
Файл не коммитится; на общем сервере ограничьте его права (`chmod 600`).

| Переменная | Для чего |
| --- | --- |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | основной OpenAI-совместимый провайдер (DeepSeek Flash) |
| `GROQ_BASE_URL`, `GROQ_API_KEY` | второй провайдер Day 5 |
| `OPENROUTER_API_KEY` | overflow-тест Day 8 и индексация Day 21 |
| `MCP_SCHEDULER_TOKEN`, `MCP_PIPELINE_TOKEN` | секреты защищённых MCP-путей Day 18–20 |
| `MCP_HOST`, `MCP_PORT` | адрес HTTP MCP-сервера, по умолчанию `127.0.0.1:3001` |

Если приложение открывают по сетевому адресу машины, этот адрес должен быть в
`allowedDevOrigins` файла `next.config.ts`. Иначе Next 16 блокирует dev-ресурсы,
и страница не гидрируется.

## Команды npm

| Команда | Назначение |
| --- | --- |
| `npm run dev` | dev-сервер Next.js |
| `npm run build`, `npm start` | production-сборка и запуск |
| `npm run lint -- <files>` | ESLint по изменённым файлам |
| `npm run documents:index` | индекс Day 21 (OpenRouter Nemotron) |
| `npm run rag:index` | локальный E5-индекс Недели 6; первый запуск скачивает модель |
| `npm run dev-assistant:index` | индекс документации проекта Day 31 |
| `npm run review:pr -- --base <SHA> --head <SHA> --repository owner/repo` | локальное AI-ревью изменений Day 32 |
| `npm run rag:benchmark`, `rag:refinement-benchmark`, `rag:grounding-benchmark`, `rag:chat-benchmark` | бенчмарки Day 22–25 |
| `npm run mcp:server`, `npm run mcp:list` | HTTP MCP-сервер и вывод его инструментов |
| `npm run scheduler:worker`, `npm run scheduler:install` | фоновый worker Day 18 и установка systemd-юнитов |

Тесты запускаются встроенным `node --test` через `tsx` с условием
`react-server`, поэтому модули с `import "server-only"` загружаются и вне Next:

| Команда | Что проверяет |
| --- | --- |
| `npm run test:persistence` | хранилище диалогов и `PersistentChatAgent` |
| `npm run test:tokens`, `test:compression`, `test:context-strategies` | Day 8–10 |
| `npm run test:memory`, `test:profiles`, `test:tasks`, `test:invariants` | Day 11–15 |
| `npm run test:mcp`, `test:scheduler`, `test:pipeline`, `test:orchestration` | Day 16–20 |
| `npm run test:documents`, `test:rag` | Day 21–25 |
| `npm run test:dev-assistant` | Day 31: MCP-сервер проекта, git, команда `/help` |
| `npm run test:files` | Day 34: реальные файлы, границы доступа, diff, stdio MCP и HTTP |
| `npm run test:release` | Day 35: refs и теги Git, GitHub Actions, AI-контракт, HTTP-поток и предложения файлов |
| `npm run test:code-review` | Day 32: снимок PR, RAG, ответы LLM, CLI и комментарий GitHub |

## Проверки перед сдачей

Минимальный набор для изменений API и хранилищ:

```bash
npm run test:persistence
npm run lint -- <изменённые файлы>
npx tsc --noEmit
```

Для интерфейса страницу проверяют в настоящем браузере на ширине десктопа и
телефона. Смотрят drawer, фокус с клавиатуры, цели 44×44 px и отсутствие
горизонтальной прокрутки. Перед вливанием дня в `main` дополнительно:

```bash
npm run build
git diff --check
```

## Ветки и коммиты

- Каждый день разрабатывается в ветке `day-N` от `main` и вливается в `main`
  только после согласования.
- Корневой README в `main` ведёт хронологию всех дней, включая ещё не влитые.
- Коммиты — Conventional Commits: `feat(day-31): …`, `docs(readme): …`,
  `fix(chat): …`.
- В git не попадают `.env.local`, ключи, `data/*.sqlite*`, модели в
  `data/models/` и JSON-отчёты бенчмарков.

## Правила кода

- Новая возможность — отдельный модуль; прежние маршруты и API продолжают
  работать.
- Не добавлять второе соглашение рядом с существующим: например, новые
  обработчики NDJSON используют `McpChatEvent` и `consumeMcpChatStream`.
- Обязательные данные не получают значений по умолчанию. Отсутствующий ключ
  или ID — явная ошибка.
- Сохранять можно только полностью завершённый обмен `user + assistant`.
  Частичный или оборванный поток не сохраняется.
- Тексты интерфейса и документация — на русском, идентификаторы — на английском.
