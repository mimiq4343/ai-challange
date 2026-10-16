# MCP в Flash Chat

Проект и подключается к MCP-серверам как клиент, и сам поднимает собственные
серверы. Используется `@modelcontextprotocol/sdk` 1.30.1, инструменты
описываются схемами `zod/v4`.

## Собственные серверы

### HTTP-сервер `npm run mcp:server`

`scripts/mcp-server.ts` поднимает один Node.js HTTP-процесс (по умолчанию
`127.0.0.1:3001`, переменные `MCP_HOST` и `MCP_PORT`) с транспортом Streamable
HTTP без сессий. Публичный адрес — `https://mcp.yees.ai` (Caddy,
`deploy/mcp.Caddyfile`). Для круглосуточной работы есть systemd-юнит
`deploy/flash-mcp.service`. Пути:

| Путь | Фабрика | Инструменты | Авторизация |
| --- | --- | --- | --- |
| `/mcp` | `createDemoMcpServer` (`mcp-demo-server.ts`) | `add`, `get_current_time`, `get_repository_info` | нет |
| `/mcp/scheduler` | `createSchedulerMcpServer` | `create_repository_schedule`, `list_repository_schedules`, `stop_repository_schedule`, `get_repository_summary` | `MCP_SCHEDULER_TOKEN` |
| `/mcp/pipeline` | `createPipelineMcpServer` | `search_repositories`, `summarize_repositories`, `save_to_file` | `MCP_PIPELINE_TOKEN` |

Защищённые пути требуют `Authorization: Bearer <token>` и заголовок
`X-Flash-Profile-Id` с ID существующего профиля (`mcp-auth.ts`, сравнение
токена за постоянное время). Сервер проверяет `Host` и `Origin` на HTTP-границе
и принимает только `POST`. Каждый запрос ограничен абсолютным дедлайном.

### MCP-сервер проекта (stdio) — Day 31

`scripts/project-mcp-server.ts` → `createProjectMcpServer` в
`src/lib/project-mcp-server.ts`. Сервер не слушает порт: Next.js запускает его
дочерним процессом на один запрос `/help` (`withProjectMcpTools` в
`src/lib/project-mcp-client.ts`) и общается через stdin/stdout. Процесс видит
только рабочую копию, в которой запущен dev-сервер. От родителя он получает
лишь безопасный минимум окружения SDK (`PATH`, `HOME`, …), без ключей LLM.

Все инструменты только читают:

| Инструмент | Аргументы | Результат |
| --- | --- | --- |
| `search_docs` | `query`, `limit` 1–8 (по умолчанию 5) | фрагменты документации с id `S1…`, `indexId`, флаг `stale` |
| `git_branch` | — | ветка, detached, HEAD (12 символов), upstream, ahead/behind, последний коммит |
| `git_status` | — | изменённые, переименованные, конфликтные и неотслеживаемые файлы (до 200) |
| `list_files` | `path` | подкаталоги с числом отслеживаемых файлов и файлы каталога (до 300 записей) |
| `git_diff` | `path` | `--stat` и патч относительно `HEAD`, обрезанный до 12 000 символов |

Git вызывается через `execFile` без shell, с `--literal-pathspecs`,
`GIT_OPTIONAL_LOCKS=0`, `--no-ext-diff` и `--no-textconv`. Пути проверяются
схемой: относительные, без `..`, без ведущих `:`, `-` и управляющих символов.
`list_files` и `git_diff` видят только отслеживаемые файлы, поэтому
`.env.local` и `data/*.sqlite` в результаты не попадают.

## Клиенты и агенты

- `src/lib/mcp-client.ts` — `withMcpTools(endpoint, signal, operation)`:
  Streamable HTTP, проверка URL (`mcp-network.ts`) и лимит ответа 2 МБ.
  Получение списка инструментов с пагинацией и валидация `structuredContent`
  по `outputSchema`. Discovery ограничен 15 с, вся сессия — 300 с.
- `src/lib/mcp-router.ts` — `withMcpRouter` Day 20. Параллельно подключает
  серверы реестра `ORCHESTRATION_SERVERS` (`orchestration-config.ts`), в том
  числе внешний DeepWiki, и даёт инструментам имена `server__tool`.
  Недоступный сервер исключается из каталога.
- `src/lib/mcp-tool-chat-agent.ts` — `McpToolChatAgent`, общий tool-loop
  поверх OpenAI-совместимого API с `tools`/`tool_calls`. Режимы:
  - `repository` — Day 17;
  - `scheduler` — Day 18;
  - `pipeline` — Day 19, строгий порядок трёх шагов;
  - `orchestration` — Day 20;
  - `project` — Day 31, stdio-сервер проекта.

  Аргументы каждого вызова проверяются zod-схемой до отправки на сервер.
  Результаты инструментов считаются недоверенными данными. Действуют лимиты
  на раунды, число вызовов и размер результата. В режимах `orchestration` и
  `project` последний раунд идёт без инструментов, чтобы модель подвела итог.

Лимиты tool-loop задаются в коде: `MCP_TOOL_CHAT_LIMITS` в `mcp-config.ts`,
`ORCHESTRATION_LIMITS` и `DEV_ASSISTANT_LIMITS` в `dev-assistant-config.ts`.

## Сохранённые серверы Day 16

Таблица `mcp_servers` хранит `name` и `url` для каждого профиля. URL с логином,
паролем, query или фрагментом запрещены; частные адреса сети недоступны, кроме
точного origin `https://mcp.yees.ai`. Статус «подключён» не хранится:
инструменты получаются живым запросом `POST /api/mcp-servers/:id/discover`.
