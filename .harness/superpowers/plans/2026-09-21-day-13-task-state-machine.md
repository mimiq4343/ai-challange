# Day 13 Task State Machine Implementation Plan

**Goal:** Формализовать состояние задачи как конечный автомат с этапами, шагами
и ожидаемым действием, переживающий паузу и смену диалога; персонализацию Day 12
отключить флагом без удаления кода.

**Spec:** `.harness/superpowers/specs/2026-09-21-day-13-task-state-machine-design.md`

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, Node.js `node:sqlite`,
Tailwind CSS 4, Phosphor Icons, `node:test` через `tsx`.

## Глобальные ограничения

- Работа только в ветке `day-13`, созданной от `main`.
- Маршруты дней 1–12 продолжают отвечать; `/day-12` работает с плашкой вместо
  панели профиля.
- Схему создаёт единственный модуль `memory-schema.ts`; миграции идемпотентны.
- Обмен сохраняется одной транзакцией после полного стрима; сбой роутера не
  откатывает обмен и не двигает автомат.
- Пока задача на паузе, агентские переходы отклоняются с записью в журнал.
- Внешние вызовы без retry; секреты только в `.env.local`.
- Каждый source-файл меньше 800 строк.
- `main` и remote не меняются без отдельной команды пользователя.

## Этапы

### 1. Флаг персонализации

- `src/lib/feature-flags.ts` — `FEATURES.personalization = false`.
- `PersonalizedChatAgent` получает опцию `personalization` со значением по
  умолчанию из флага; при `false` блок профиля не строится и записи слоя
  `profile` не применяются.
- `memory-router.ts` — правила слоя `profile` в системном промпте только при
  включённом флаге; парсер отбрасывает такие записи при выключенном.
- `/api/profiles/*` — 404 «Персонализация отключена» при выключенном флаге.
- `/day-12` — плашка вместо `ProfilePanel`.

### 2. Автомат и хранилище

- `src/lib/task-machine.ts` — `TASK_STAGES`, таблица переходов, `canTransition`,
  `isTerminalStage`, `defaultExpectation(stage)`.
- `src/lib/task-types.ts` — `TaskRun`, `TaskStep`, `TaskEvent`, `TaskStateUpdate`.
- `memory-schema.ts` — таблицы `task_runs`, `task_steps`, `task_events` и
  частичный уникальный индекс живой задачи.
- `src/lib/task-store.ts` — `SqliteTaskStore`: `getActiveRun`, `createRun`,
  `transition`, `pause`, `resume`, `addStep`, `updateStep`, `deleteStep`,
  `applyAgentUpdate`, `listEvents`.
- `tests/task-machine.test.ts`, `tests/task-store.test.ts`.

### 3. Промпт и агент

- `memory-composer.ts` — `renderTaskBlock`, `taskBlock` в `ComposedMemoryPrompt`,
  `taskTokens` в разбивке, тумблер `task`.
- `memory-router.ts` — объект `taskState` в контракте и парсере.
- `personalized-chat-agent.ts` — снимок задачи, блок в промпте, применение
  `taskState` через `SqliteTaskStore` после сохранения обмена.
- `tests/task-agent.test.ts` — блок задачи в промпте, пауза отклоняет переходы,
  выключенный слой стоит ноль токенов, выключенная персонализация не добавляет
  блок профиля.

### 4. API и интерфейс

- Роуты `/api/tasks`, `/api/tasks/[id]/transition`, `/pause`, `/resume`,
  `/steps`, `/steps/[stepId]`, `/api/conversations/[id]/task-messages`.
- `src/components/task-state-panel.tsx` — цепочка этапов, пауза, блокировка,
  отмена, шаги со статусами, ожидаемое действие, журнал.
- `src/components/day13-workspace.tsx` — состояние задачи, слои, телеметрия,
  переиспользование `MemoryInspector` и `MemoryTelemetryBar`.
- `src/app/day-13/page.tsx`, ссылка `Day 13` в `site-header.tsx`.

### 5. Проверка и документация

- `package.json` — скрипт `test:tasks`.
- Все наборы тестов, targeted ESLint, `npx tsc --noEmit`, `npm run build`.
- Браузер: `/day-13` на десктопе и мобильной ширине; сценарий паузы и
  продолжения в новом диалоге; отклонённый переход в журнале.
- README ветки, `.harness/memory/day-13.md`, обновление индексов.
