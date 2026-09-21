# Day 14 Invariants Implementation Plan

**Goal:** Свод инвариантов профиля, который хранится отдельно от диалога, входит
в промпт первым блоком и приводит к детерминированному отказу, когда запрос
требует его нарушить.

**Spec:** `.harness/superpowers/specs/2026-09-21-day-14-invariants-design.md`

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, Node.js `node:sqlite`,
Tailwind CSS 4, Phosphor Icons, `node:test` через `tsx`.

## Глобальные ограничения

- Работа только в ветке `day-14`, созданной от `main`.
- Маршруты дней 1–13 сохраняют поведение.
- Схему создаёт `memory-schema.ts`; миграции идемпотентны.
- Guard не вызывается при пустом своде правил и при выключенном слое.
- Сбой или нечитаемый ответ guard трактуется как `allow` и логируется один раз.
- Обмен сохраняется одной транзакцией, включая обмен с отказом.
- Внешние вызовы без retry; секреты только в `.env.local`.
- Каждый source-файл меньше 800 строк.
- `main` и remote не меняются без отдельной команды пользователя.

## Этапы

### 1. Хранилище

- `src/lib/invariant-types.ts` — `Invariant`, `InvariantCategory`,
  `InvariantProposal`, `InvariantEvent`, `GuardVerdict`.
- `memory-schema.ts` — таблицы `memory_invariants`,
  `memory_invariant_proposals`, `memory_invariant_events`.
- `src/lib/invariant-store.ts` — `SqliteInvariantStore`: `listActive`, `listAll`,
  `create`, `update`, `retire`, `restore`, `listProposals`, `saveProposals`,
  `acceptProposal`, `discardProposal`, `recordViolation`, `listEvents`.
- `tests/invariant-store.test.ts`.

### 2. Промпт и guard

- `memory-composer.ts` — `renderInvariantBlock`, `invariantBlock` в
  `ComposedMemoryPrompt`, `invariantTokens`, тумблер `invariants`, правило отказа
  в системном промпте.
- `src/lib/invariant-guard.ts` — системный промпт проверки, разбор вердикта,
  сборка текста отказа (цитата, причина, альтернатива).
- `memory-router.ts` — поле `invariantProposals` в контракте и парсере.
- `personalized-chat-agent.ts` — опция `invariants`, проверка перед генерацией,
  стрим отказа вместо вызова чат-модели, запись события и `blocked_count`.
- `tests/invariant-guard.test.ts`, дополнения в `tests/task-agent.test.ts` или
  новый `tests/invariant-agent.test.ts`.

### 3. API и интерфейс

- Роуты `/api/invariants`, `/api/invariants/[id]`, `.../retire`, `.../restore`,
  `/api/invariants/proposals/[id]`, `.../accept`,
  `/api/conversations/[id]/invariant-messages`.
- `src/components/invariant-panel.tsx`, `src/components/day14-workspace.tsx`,
  `src/app/day-14/page.tsx`, ссылка `Day 14` в `site-header.tsx`.
- `memory-telemetry-bar.tsx` — сегмент `INV`.

### 4. Проверка и документация

- `package.json` — скрипт `test:invariants`.
- Все наборы тестов, targeted ESLint, `npx tsc --noEmit`, `npm run build`.
- Браузер: `/day-14` на десктопе и мобильной ширине; конфликт, объяснение
  отказа, снятие правила и повторный проход запроса.
- README ветки, `.harness/memory/day-14.md`, обновление индексов.
